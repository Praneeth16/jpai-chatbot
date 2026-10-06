import type { RouteId } from '../../shared/api';
import type { RouterConfig } from './config';
import { hasInjectionKeyword } from './injection-keywords';
import { searchQuery } from './masterdata';
import { TEMPLATE_BY_ROUTE } from './template-ids';
import { bestTitleMatch, titleScore, type TitleRow } from './title-match';
import type { ConversationState, DecideInput, Decision, NeedsSearch, SearchFilters } from './types';

/** A decision before the ae_review flag, which decide() sets once for every outcome. */
type Routed = Omit<Decision, 'ae_review'>;

/**
 * Pure routing decision, CONTRACTS section 6 step 5. No I/O: everything it needs is in the input.
 * Order: AE, injection, no request (small talk), intent.
 * AE: at or above tau_ae_route the turn is answered with route 1. Between tau_ae and tau_ae_route (a question about
 * side effects, not a report) it is routed normally and flagged ae_review so the orchestrator queues it for PV.
 * Injection: the classifier probability or a keyword hit (the 4B model under-scores paraphrased injections).
 * Product: named in the message, else the previous one on a clarification reply, else the previous one when it is
 * one of the products a named study belongs to.
 */
export function decide(input: DecideInput, config: RouterConfig): Decision {
  const aeReview =
    input.precheck_ok &&
    input.classification.adverse_event >= config.tau_ae &&
    input.classification.adverse_event < config.tau_ae_route;
  return { ...decideRoute(input, config), ae_review: aeReview };
}

function decideRoute(input: DecideInput, config: RouterConfig): Routed {
  const { classification: c, masterdata: md, state } = input;

  const product =
    md.product_code ??
    (input.is_clarification ? state.last_product_code : null) ??
    (state.last_product_code && md.product_candidates.includes(state.last_product_code)
      ? state.last_product_code
      : null);
  const study = md.study_ids[0] ?? null;

  const settled = (over: Partial<ConversationState> = {}): ConversationState => ({
    ...state,
    pending_clarification: null,
    pending_question: null,
    off_topic_streak: 0,
    last_product_code: product ?? state.last_product_code,
    ...over,
  });

  const terminal = (route: RouteId, ae = false): Routed => ({
    route_id: route,
    needs_search: null,
    template_id: TEMPLATE_BY_ROUTE[route],
    new_state: settled(),
    ae,
  });

  // 0-a: garbage input. The user is still owed their pending clarification, so that is kept.
  if (!input.precheck_ok) {
    return {
      route_id: '0a',
      needs_search: null,
      template_id: TEMPLATE_BY_ROUTE['0a'],
      new_state: { ...state, off_topic_streak: 0 },
      ae: false,
    };
  }

  if (c.adverse_event >= config.tau_ae_route) return terminal('1', true);
  if (c.injection >= config.tau_inj || hasInjectionKeyword(input.merged_message)) return terminal('0b');

  // CONTRACTS 6.9: wants to report an AE. Same answer as an AE; the queue entry is only written above (ae = true),
  // because here no concrete event was described.
  if (c.intent.choice === 'report_ae' && c.intent.confidence >= config.tau_intent) return terminal('1');

  // CONTRACTS 6.9: asking about the bot itself is small talk even when has_request is high.
  if (c.smalltalk.choice === 'about_bot' && c.smalltalk.confidence >= config.tau_intent) {
    return terminal('0c_about');
  }

  if (c.has_request < config.tau_req) {
    switch (c.smalltalk.choice) {
      case 'greeting':
        return terminal('0c_greeting');
      case 'closing':
        return terminal('0c_closing');
      case 'about_bot':
        return terminal('0c_about');
      default:
        break; // small talk "other" without a request: let the intent decide
    }
  }

  // Off-topic turn: the streak feeds 8.1, then 8.2 (CONTRACTS section 6 step 5).
  const offTopic = (): Routed => {
    const streak = state.off_topic_streak + 1;
    if (streak >= config.off_topic_streak) {
      return { ...terminal('8.2'), new_state: settled({ off_topic_streak: 0 }) };
    }
    return { ...terminal('8.1'), new_state: settled({ off_topic_streak: streak }) };
  };

  // CONTRACTS section 8 loop breaker: asking "which product?" twice in a row counts as off-topic. 7.1 keeps the
  // streak (it is not an answer), otherwise the reset here would stop the streak from ever reaching 8.2.
  const askProduct = (): Routed => {
    if (state.pending_clarification === 'product_focus') return offTopic();
    return {
      route_id: '7.1',
      needs_search: null,
      template_id: TEMPLATE_BY_ROUTE['7.1'],
      new_state: settled({
        pending_clarification: 'product_focus',
        pending_question: input.merged_message,
        off_topic_streak: state.off_topic_streak,
      }),
      ae: false,
    };
  };

  const search = (route: RouteId, filters: SearchFilters, mode: NeedsSearch['mode']): Routed => ({
    route_id: route,
    needs_search: { filters, mode, query: searchQuery(input.merged_message, md) },
    template_id: TEMPLATE_BY_ROUTE[route],
    new_state: settled(),
    ae: false,
  });

  const intent = c.intent;
  if (intent.confidence < config.tau_intent) {
    // Nothing was asked (keyboard mash, a stray word): asking "which product?" makes no sense, so it is off-topic.
    return c.has_request < config.tau_req ? offTopic() : askProduct();
  }

  // A question that names a trial (not an indication that implies one) asks for the trial results: the 4B model
  // often labels "HIMALAYA試験での主な副作用" as drug_info.
  const namedStudy = md.matched_terms.some((t) => t.kind === 'study');
  const choice = intent.choice === 'drug_info' && namedStudy ? 'efficacy_safety' : intent.choice;

  switch (choice) {
    case 'unanswerable':
      return terminal('2');
    case 'patient_materials':
      return terminal('3.1');
    case 'hcp_materials':
      return terminal('3.2');
    case 'website':
      return terminal('6.1');
    case 'contact_az':
      return terminal('6.2');
    case 'ambiguous_az':
      return askProduct();
    case 'drug_info': {
      if (!product) return askProduct();
      const filters: SearchFilters = {
        product_code: product,
        is_current: true,
        audience: input.audience,
        approved_flag: true,
      };
      const conditions =
        c.has_conditions >= config.tau_cond ||
        md.matched_terms.some((t) => t.kind === 'indication' || t.kind === 'study');
      return conditions ? search('4.1', filters, 'subsection') : search('4.2', filters, 'section');
    }
    case 'efficacy_safety': {
      // A study shared by several products (HIMALAYA) names no product, but the study itself is enough to search.
      const candidates = !product && study && md.product_candidates.length > 1 ? md.product_candidates : null;
      if (!product && !candidates) return askProduct();
      if (!study) {
        return {
          route_id: '5.2',
          needs_search: null,
          template_id: TEMPLATE_BY_ROUTE['5.2'],
          new_state: settled({
            pending_clarification: 'target_study',
            pending_question: input.merged_message,
          }),
          ae: false,
        };
      }
      // Clinical study sections are unapproved in the IF; HCP audience may see them under the 5.1 header.
      const filters: SearchFilters = {
        product_code: product ?? candidates ?? [],
        is_current: true,
        audience: input.audience,
        study_id: study,
        // JSHP IF format: chapter Ⅴ.5 (臨床成績) holds the study results; its chunks rarely outrank the chapters that
        // only mention the study, so it is searched first.
        section_prefix: 'Ⅴ.5',
      };
      if (input.audience !== 'HCP') filters.approved_flag = true;
      return search('5.1', filters, 'subsection');
    }
    case 'report_ae': // handled above
    case 'out_of_scope':
      break;
  }

  return offTopic();
}

// ---------------------------------------------------------------------------------------------------------------

export interface SearchHit {
  chunk_id: string;
  section_id: string;
  score: number;
}

/** What the lineage query knows about a section and its ancestors. */
export interface SectionMeta {
  section_id: string;
  section_path: string;
  level: number;
  parent_section_id: string | null;
  /** Length of the verbatim markdown; null when unknown (then 4.2 does not climb to it). */
  char_len: number | null;
  is_current: boolean;
  qa_status: string | null;
  approved_flag: boolean;
}

export interface Finalized {
  route_id: RouteId;
  template_id: string | null;
  /** Chosen section, null when falling back to route 2. */
  section_id: string | null;
  top_score: number | null;
  /** Best score per section, descending. */
  section_scores: { section_id: string; score: number }[];
  /** 'title': the section was chosen by its title (4.x), 'search': by the vector hits. */
  selection: 'title' | 'search';
  /** Share of the title covered by the query when selection is 'title'. */
  title_score: number | null;
}

/** Best score per section_id, sorted descending. */
export function groupBySection(hits: SearchHit[]): { section_id: string; score: number }[] {
  const best = new Map<string, number>();
  for (const h of hits) best.set(h.section_id, Math.max(best.get(h.section_id) ?? -Infinity, h.score));
  return [...best.entries()].map(([section_id, score]) => ({ section_id, score })).sort((a, b) => b.score - a.score);
}

/** FRONT is the cover, table of contents and abbreviations. It is never chunked and never answered. */
export const isFront = (sectionPath: string): boolean => /^FRONT(?![A-Za-z0-9])/i.test(sectionPath.trim());

/**
 * JSHP IF format: chapter Ⅴ.5 (臨床成績) holds the clinical study results; other chapters only mention the study.
 * Compared after NFKC, so the Roman numeral Ⅴ (U+2164) and a typed "V" are the same.
 */
export const isClinicalStudyPath = (sectionPath: string): boolean => {
  const p = sectionPath.normalize('NFKC').trim();
  return p === 'V.5' || p.startsWith('V.5.') || p.startsWith('V.5#');
};

type Answerable = Pick<SectionMeta, 'section_path' | 'level' | 'is_current' | 'qa_status' | 'approved_flag'>;

/**
 * CONTRACTS section 8: the checks every answer passes, whatever the search index said. Level 1 (chapter) and FRONT
 * are never answered; the section must be current, not REJECTED (APPROVED only with require_qa_approved), and
 * approved unless the route allows unapproved text (5.1 for the HCP audience).
 */
export function isAnswerable(s: Answerable, requireApproved: boolean, config: RouterConfig): boolean {
  if (s.level < 2 || isFront(s.section_path)) return false;
  if (!s.is_current) return false;
  const qa = (s.qa_status ?? '').toUpperCase();
  if (qa === 'REJECTED') return false;
  if (config.require_qa_approved && qa !== 'APPROVED') return false;
  if (requireApproved && !s.approved_flag) return false;
  return true;
}

/**
 * CONTRACTS section 6 steps 5 to 6 plus section 8: below tau_ret (or no answerable hit) the answer is route 2.
 * Hits whose section is unknown or not answerable are skipped before anything else is decided.
 * 4.x with titleRows (the product's sections, only passed when the search worked): a section whose title the query
 * covers by at least tau_title wins over the vector hits (answerable, approved, not a pseudo-section). 4.1 answers
 * with it as is, 4.2 walks up from it. Without a title match the rules below apply unchanged.
 * 4.1: deepest section among hits scoring within depth_margin of the best hit.
 * 4.2: from the best hit walk up to the largest ancestor (level 2 or deeper) that is at most max_verbatim_chars.
 * 5.1: the best hit section inside IF chapter Ⅴ.5 when there is one, else the best hit section (the study filter
 * already guarantees it concerns the study).
 */
export function finalize(
  decision: Decision,
  hits: SearchHit[],
  sections: Map<string, SectionMeta>,
  config: RouterConfig,
  titleRows: TitleRow[] | null = null
): Finalized {
  const scores = groupBySection(hits);
  const fallback = (top: number | null): Finalized => ({
    route_id: '2',
    template_id: TEMPLATE_BY_ROUTE['2'],
    section_id: null,
    top_score: top,
    section_scores: scores,
    selection: 'search',
    title_score: null,
  });

  const need = decision.needs_search;
  if (!need || scores.length === 0) return fallback(null);
  const topOverall = scores[0].score;

  // The lineage of the hits, plus the sections the title match knows (their parents are needed for the 4.2 walk-up).
  const known = titleRows
    ? new Map<string, SectionMeta>([...titleRows.map((r) => [r.section_id, r] as const), ...sections])
    : sections;
  const ok = (id: string): SectionMeta | null => {
    const m = known.get(id);
    return m && isAnswerable(m, need.filters.approved_flag === true, config) ? m : null;
  };
  const walkUp = (from: string): string => {
    let chosen = from;
    for (;;) {
      const parentId = known.get(chosen)?.parent_section_id;
      const parent = parentId ? ok(parentId) : null;
      if (!parent || parent.char_len === null || parent.char_len > config.max_verbatim_chars) return chosen;
      chosen = parent.section_id;
    }
  };
  const done = (section_id: string, selection: 'title' | 'search', title_score: number | null): Finalized => ({
    route_id: decision.route_id,
    template_id: decision.template_id,
    section_id,
    top_score: topOverall,
    section_scores: scores,
    selection,
    title_score,
  });

  if (titleRows && (decision.route_id === '4.1' || decision.route_id === '4.2')) {
    const eligible = titleRows.filter((r) => !r.is_pseudo && isAnswerable(r, true, config));
    const match = bestTitleMatch(need.query, eligible, config.tau_title);
    if (match) {
      const id = decision.route_id === '4.2' ? walkUp(match.section_id) : match.section_id;
      return done(id, 'title', titleScore(need.query, match.title));
    }
  }

  const candidates = scores.filter((s) => ok(s.section_id));
  if (candidates.length === 0) return fallback(topOverall);
  const top = candidates[0];
  if (top.score < config.tau_ret) return fallback(topOverall);

  let chosen = top.section_id;
  if (decision.route_id === '4.2') {
    chosen = walkUp(chosen);
  } else if (decision.route_id === '4.1') {
    const floor = top.score * (1 - config.depth_margin);
    const near = candidates.filter((s) => s.score >= floor);
    near.sort(
      (a, b) => (known.get(b.section_id)?.level ?? 0) - (known.get(a.section_id)?.level ?? 0) || b.score - a.score
    );
    chosen = near[0].section_id;
  } else if (decision.route_id === '5.1') {
    // Candidates are sorted by score, so the first one in Ⅴ.5 is the best one in Ⅴ.5.
    const clinical = candidates.find(
      (s) => s.score >= config.tau_ret && isClinicalStudyPath(known.get(s.section_id)?.section_path ?? '')
    );
    if (clinical) chosen = clinical.section_id;
  }

  return done(chosen, 'search', null);
}

/** State to persist when a search route falls back to 2: nothing is pending and the streak is reset. */
export function fallbackState(decisionState: ConversationState): ConversationState {
  return { ...decisionState, pending_clarification: null, pending_question: null, off_topic_streak: 0 };
}
