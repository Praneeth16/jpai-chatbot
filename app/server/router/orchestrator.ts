import { randomUUID } from 'node:crypto';
import type {
  Citation,
  Classification,
  RouteId,
  RouteRequest,
  RouteResponse,
  RouteResponseBody,
  Retrieval,
  SectionContext,
  TemplateStatus,
} from '../../shared/api';
import { hasAeKeyword } from './ae-keywords';
import { type ClassifyInput, classify as classifyDefault, safeClassification } from './classify';
import { type RouterConfig, thresholdsOf } from './config';
import { decide, fallbackState, finalize, isAnswerable, type SectionMeta } from './flow';
import { matchMasterData } from './masterdata';
import { mergeClarification } from './merge';
import { precheck } from './precheck';
import { type SearchResult, searchIndex } from './search';
import type { AeRow, SectionRow, Store, TurnLogRow } from './store';
import { resolveTemplate } from './templates';
import { noopTracer, type Tracer } from './trace';
import type { TitleRow } from './title-match';
import { type ConversationState, type Decision, emptyState, type NeedsSearch, type RawClassification } from './types';

export interface Deps {
  store: Store;
  config: RouterConfig;
  tracer?: Tracer;
  classify?: (input: ClassifyInput) => Promise<RawClassification>;
  search?: (need: NonNullable<Decision['needs_search']>, config: RouterConfig) => Promise<SearchResult>;
  /** Pause between the 3 attempts to write ae_queue. Tests set 0. */
  ae_retry_delay_ms?: number;
}

export interface Caller {
  email: string | null;
}

const RECENT_TURNS = 3;
const AE_WRITE_ATTEMPTS = 3;

/** part "k/n" for a section that is one piece of a split section (section_path ends in "#k"). */
export function partOf(s: Pick<SectionRow, 'is_pseudo' | 'section_path' | 'part_count'>): string | null {
  if (!s.is_pseudo || s.part_count < 1) return null;
  const k = /#(\d+)$/.exec(s.section_path)?.[1];
  return k ? `${k}/${s.part_count}` : null;
}

export function contextOf(s: SectionRow, breadcrumb: string[]): SectionContext {
  const hasParent = s.parent_section_id !== null && s.parent_level !== null && s.parent_level >= 2;
  return { breadcrumb, part: partOf(s), parent_section_id: hasParent ? s.parent_section_id : null };
}

export function citationFor(s: SectionRow, fileName: string): Citation {
  return {
    doc_id: s.doc_id,
    file_name: fileName,
    doc_rev: s.doc_rev,
    section_path: s.section_path,
    title: s.title,
    pages: s.pages,
  };
}

/** Why a search route could not return its section (null = it can). Second line of defence behind finalize. */
async function refusal(
  store: Store,
  section: SectionRow | null,
  decision: Decision,
  need: NeedsSearch,
  config: RouterConfig
): Promise<string | null> {
  if (!section) return 'section no longer exists';
  if (!isAnswerable(section, need.filters.approved_flag === true, config))
    return 'section is not answerable (level, current, qa_status or approval)';
  // CONTRACTS section 8: 4.x text contains its sub-sections, so one unapproved child makes the whole section unusable.
  if (
    (decision.route_id === '4.1' || decision.route_id === '4.2') &&
    (await store.subtreeUnapproved(section.section_id))
  ) {
    return 'section contains unapproved sub-sections';
  }
  return null;
}

let titleLoadWarned = false;

/** Title rows of the searched products for the 4.x title match, or null when they cannot be loaded (never fails the turn). */
async function loadTitleRows(store: Store, productCode: string | string[]): Promise<TitleRow[] | null> {
  try {
    return await store.sectionTitles(Array.isArray(productCode) ? productCode : [productCode]);
  } catch (err) {
    if (!titleLoadWarned) {
      titleLoadWarned = true;
      console.warn('[router] section titles unavailable, title matching skipped:', (err as Error).message);
    }
    return null;
  }
}

async function withRetries(fn: () => Promise<void>, attempts: number, delayMs: number): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await fn();
      return true;
    } catch (err) {
      console.error(`[router] ae_queue write attempt ${attempt}/${attempts} failed:`, (err as Error).message);
      if (attempt < attempts && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  return false;
}

/** One chatbot turn, CONTRACTS section 6. Never throws for upstream failures: they degrade to route 2. */
export async function handleTurn(req: RouteRequest, caller: Caller, deps: Deps): Promise<RouteResponse> {
  const { store, config } = deps;
  const tracer = deps.tracer ?? noopTracer;
  const classifyFn = deps.classify ?? ((i: ClassifyInput) => classifyDefault(i));
  const searchFn = deps.search ?? ((n, c) => searchIndex(n, c));
  const turnId = randomUUID();
  const started = Date.now();

  return tracer.turn({ conversation_id: req.conversation_id, turn_id: turnId, message: req.message }, async (trace) => {
    // A Lakebase blip must not become an HTTP 500: carry on with a blank state, and answer search routes with 2.
    let state: ConversationState;
    let stateError: string | undefined;
    try {
      state = await store.getState(req.conversation_id, req.lang, caller.email);
    } catch (err) {
      stateError = (err as Error).message;
      console.error('[router] conversation state unavailable:', stateError);
      state = emptyState(req.conversation_id, req.lang);
    }

    const merge = await trace.span('merge', { message: req.message, pending: state.pending_clarification }, () =>
      mergeClarification(state, req.message)
    );
    const pre = await trace.span('precheck', { message: req.message }, () => precheck(req.message));

    // 0a never reaches the model, so a blank or garbage message costs no System One call.
    let raw: RawClassification | null = null;
    if (pre.ok) {
      const recent = await store.recentTurns(req.conversation_id, RECENT_TURNS, caller.email).catch(() => []);
      raw = await trace.span(
        'classify',
        { message: merge.merged, recent_turns: recent, pending_clarification: state.pending_clarification },
        () =>
          classifyFn({
            message: merge.merged,
            recent_turns: recent,
            pending_clarification: state.pending_clarification,
          })
      );
    }

    const masterData = await store.masterData().catch((err: unknown) => {
      console.error('[router] master data unavailable:', (err as Error).message);
      return { synonyms: [], products: [], studies: [] };
    });
    const md = await trace.span('masterdata', { message: merge.merged }, () =>
      matchMasterData(merge.merged, masterData)
    );

    const decision = await trace.span('decide', { classification: raw, masterdata: md, state }, () =>
      decide(
        {
          message: req.message,
          merged_message: merge.merged,
          is_clarification: merge.is_clarification,
          precheck_ok: pre.ok,
          classification: raw ?? safeClassification(),
          masterdata: md,
          state,
          audience: req.audience,
        },
        config
      )
    );

    let routeId: RouteId = decision.route_id;
    let newState = decision.new_state;
    let section: SectionRow | null = null;
    let retrieval: Retrieval | null = null;

    if (decision.needs_search) {
      const need = decision.needs_search;
      let result: SearchResult = { query: need.query, filters: {}, hits: [] };
      let failure: string | undefined;
      if (stateError) {
        failure = `conversation state unavailable: ${stateError}`;
      } else {
        try {
          result = await trace.span(
            'search',
            need,
            () => searchFn(need, config),
            (r) => ({
              hits: r.hits.length,
              top: r.hits[0]?.score ?? null,
            })
          );
        } catch (err) {
          failure = (err as Error).message;
          console.error('[router] search failed:', failure);
        }
      }

      let lineage: SectionMeta[] = [];
      if (!failure && result.hits.length > 0) {
        try {
          lineage = await store.lineage([...new Set(result.hits.map((h) => h.section_id))]);
        } catch (err) {
          failure = `section lookup failed: ${(err as Error).message}`;
          console.error('[router]', failure);
        }
      }
      const sections = new Map(lineage.map((s) => [s.section_id, s]));

      // Only when the search worked, so its error handling is unchanged.
      const titleRows =
        !failure && result.hits.length > 0 && (decision.route_id === '4.1' || decision.route_id === '4.2')
          ? await loadTitleRows(store, need.filters.product_code)
          : null;

      const fin = await trace.span(
        'lookup',
        { hits: result.hits.length, title_rows: titleRows?.length ?? null },
        async () => {
          const f = finalize(decision, result.hits, sections, config, titleRows);
          if (!f.section_id || failure) return { f, found: null as SectionRow | null };
          try {
            const row = await store.section(f.section_id);
            const why = await refusal(store, row, decision, need, config);
            if (why) {
              console.warn(`[router] ${f.section_id} refused: ${why}`);
              return { f, found: null };
            }
            return { f, found: row };
          } catch (err) {
            failure = `section lookup failed: ${(err as Error).message}`;
            console.error('[router]', failure);
            return { f, found: null };
          }
        },
        (r) => ({ selection: r.f.selection, title_score: r.f.title_score, section_id: r.f.section_id })
      );

      section = fin.found;
      if (!section) {
        routeId = '2';
        newState = fallbackState(newState);
      } else {
        routeId = fin.f.route_id;
      }
      retrieval = {
        query: result.query,
        filters: result.filters,
        top_score: fin.f.top_score,
        hits: fin.f.section_scores.map((s) => ({ section_id: s.section_id, score: s.score })),
        selection: fin.f.selection,
        title_score: fin.f.title_score,
        ...(failure ? { error: failure } : {}),
      };
    }

    const templates = await store.templates().catch((err: unknown) => {
      console.error('[router] templates unavailable, using built-in fallback wording:', (err as Error).message);
      return [];
    });
    const templateOnly = (route: RouteId): RouteResponseBody => {
      const tpl = resolveTemplate(templates, route, req.lang);
      return {
        template_id: tpl.template_id,
        template_status: tpl.status as TemplateStatus,
        text: tpl.text,
        header_text: tpl.text,
        section_text: null,
        section_context: null,
        section_ids: [],
        citations: [],
      };
    };

    let response = await trace.span(
      'respond',
      { route_id: routeId, section_id: section?.section_id ?? null },
      async () => {
        if (!section) return templateOnly(routeId);
        const found = section;
        const tpl = resolveTemplate(templates, routeId, req.lang);
        const [crumbs, fileName] = await Promise.all([
          store.breadcrumb(found.section_id).catch(() => [] as string[]),
          store.fileName(found.doc_id).catch(() => found.doc_id),
        ]);
        return {
          template_id: tpl.template_id,
          template_status: tpl.status as TemplateStatus,
          text: `${tpl.text}\n\n${found.markdown}`,
          header_text: tpl.text,
          section_text: found.markdown,
          section_context: contextOf(found, crumbs),
          section_ids: [found.section_id],
          citations: [citationFor(found, fileName)],
        };
      }
    );

    const classification: Classification | null = raw
      ? { ...raw, product_code: md.product_code, study_ids: md.study_ids, thresholds: thresholdsOf(config) }
      : null;

    trace.tag({ route_id: routeId, conversation_id: req.conversation_id, turn_id: turnId });
    const latency = Date.now() - started;
    const traceId = trace.traceId();

    // CONTRACTS section 8: a classified AE is queued as NEW, a possible one (the review band, answered normally)
    // as REVIEW. When the classifier was down the message cannot be judged, so it is queued as UNCLASSIFIED for a
    // human (the keyword hit is kept in model_ids for triage).
    const aeKeywordHit = raw?.degraded ? hasAeKeyword(merge.merged) : null;
    let ae: AeRow | null = null;
    if (raw && (decision.ae || decision.ae_review)) {
      ae = {
        ae_id: randomUUID(),
        turn_id: turnId,
        conversation_id: req.conversation_id,
        message: merge.merged,
        ae_probability: raw.adverse_event,
        status: decision.ae ? 'NEW' : 'REVIEW',
      };
    } else if (raw?.degraded) {
      ae = {
        ae_id: randomUUID(),
        turn_id: turnId,
        conversation_id: req.conversation_id,
        message: merge.merged,
        ae_probability: null,
        status: 'UNCLASSIFIED',
      };
    }

    const turnRow = (): TurnLogRow => ({
      turn_id: turnId,
      conversation_id: req.conversation_id,
      user_email: caller.email,
      message: req.message,
      merged_message: merge.merged,
      route_id: routeId,
      template_id: response.template_id,
      section_ids: response.section_ids,
      classification,
      retrieval,
      model_ids: {
        classifier: raw?.model ?? null,
        service: process.env.MODEL_SERVICE_NAME ?? null,
        degraded: raw?.degraded ?? false,
        ...(aeKeywordHit === null ? {} : { ae_keyword_hit: aeKeywordHit }),
      },
      trace_id: traceId,
      latency_ms: latency,
    });

    // The turn still gets its answer when a write fails, but every failure is loud in the log.
    const logTurnOnly = () =>
      store
        .logTurn(turnRow())
        .catch((e: unknown) => console.error('[router] turn_log write failed:', (e as Error).message));

    let aeLogged = false;
    if (ae) {
      const queued = ae;
      aeLogged = await withRetries(
        () => store.logTurnWithAe(turnRow(), queued),
        AE_WRITE_ATTEMPTS,
        deps.ae_retry_delay_ms ?? 150
      );
      if (!aeLogged && queued.status === 'REVIEW') {
        // Only a possible AE: the turn keeps its answer, but the lost queue entry is loud and the turn is still logged.
        console.error(
          `[router] AE REVIEW QUEUE WRITE FAILED after ${AE_WRITE_ATTEMPTS} attempts, the turn is NOT queued. ` +
            `ae_id=${queued.ae_id} turn_id=${turnId} conversation_id=${req.conversation_id} ` +
            `message=${JSON.stringify(queued.message)}`
        );
        await logTurnOnly();
      } else if (!aeLogged) {
        // The report could not be queued: tell the user to report it themselves (route 1) rather than lose it quietly.
        console.error(
          `[router] AE QUEUE WRITE FAILED after ${AE_WRITE_ATTEMPTS} attempts, the report is NOT queued. ` +
            `status=${queued.status} ae_id=${queued.ae_id} turn_id=${turnId} conversation_id=${req.conversation_id} ` +
            `message=${JSON.stringify(queued.message)}`
        );
        routeId = '1';
        newState = fallbackState(newState);
        response = templateOnly('1');
        await logTurnOnly();
      }
    } else {
      await logTurnOnly();
    }

    await store
      .saveState({ ...newState, lang: req.lang }, caller.email)
      .catch((e: unknown) => console.error('[router] state write failed:', (e as Error).message));

    return {
      turn_id: turnId,
      route_id: routeId,
      response,
      classification,
      retrieval,
      pending_clarification: newState.pending_clarification,
      merged_message: merge.merged,
      ae_logged: aeLogged,
      trace_id: traceId,
      latency_ms: latency,
    };
  });
}
