import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteRequest } from '../../shared/api';
import { cls, config, intent, MASTER, sec, SECTIONS } from './fixtures';
import { handleTurn, type Deps } from './orchestrator';
import type { SearchResult } from './search';
import type { AeRow, SectionRow, Store, TurnLogRow } from './store';
import { type ConversationState, emptyState, type RawClassification } from './types';

interface Mem {
  states: Map<string, ConversationState & { owner: string | null }>;
  turns: TurnLogRow[];
  ae: AeRow[];
  files: Record<string, string>;
  unapprovedSubtree: Set<string>;
}

const base: SectionRow = {
  section_id: '',
  doc_id: 'JD0300_IF',
  doc_rev: 'r',
  section_path: '',
  title: '',
  markdown: '',
  pages: [],
  approved_flag: true,
  level: 2,
  is_current: true,
  qa_status: 'AUTO',
  char_len: 100,
  parent_section_id: 'd::Ⅳ',
  parent_level: 1,
  part_count: 0,
  is_pseudo: false,
};

const SECTION_TEXT: Record<string, SectionRow> = {
  'd::Ⅴ.5': {
    ...base,
    section_id: 'd::Ⅴ.5',
    doc_rev: '2024年11月改訂（第3版）',
    section_path: 'Ⅴ.5',
    title: '臨床成績',
    markdown: '## 臨床成績\n| a | b |',
    pages: [30, 31],
    approved_flag: false,
    parent_section_id: 'd::Ⅴ',
  },
  'd::Ⅳ.1': {
    ...base,
    section_id: 'd::Ⅳ.1',
    section_path: 'Ⅳ.1',
    title: '製剤の組成',
    markdown: '組成の本文',
    pages: [12],
  },
  'd::Ⅳ.1#2': {
    ...base,
    section_id: 'd::Ⅳ.1#2',
    section_path: 'Ⅳ.1#2',
    title: '〈組成〉',
    markdown: '組成の続き',
    pages: [13],
    level: 3,
    parent_section_id: 'd::Ⅳ.1',
    parent_level: 2,
    is_pseudo: true,
    part_count: 3,
  },
};

interface Faults {
  getState?: boolean;
  section?: boolean;
  lineage?: boolean;
  /** Number of logTurnWithAe calls that fail before one succeeds. */
  aeFailures?: number;
}

function memStore(mem: Mem, faults: Faults = {}): Store & { aeCalls: number } {
  let aeFailures = faults.aeFailures ?? 0;
  const store = {
    aeCalls: 0,
    getState: (id: string, lang: 'ja' | 'en', email: string | null) => {
      if (faults.getState) return Promise.reject(new Error('lakebase down'));
      const row = mem.states.get(id);
      if (!row || (row.owner !== null && row.owner !== email)) return Promise.resolve(emptyState(id, lang));
      return Promise.resolve(row);
    },
    saveState: (s: ConversationState, email: string | null) => {
      mem.states.set(s.conversation_id, { ...s, owner: email });
      return Promise.resolve();
    },
    recentTurns: (id: string) =>
      Promise.resolve(
        mem.turns
          .filter((t) => t.conversation_id === id)
          .map((t) => ({ user_message: t.message, route_id: t.route_id }))
      ),
    masterData: () => Promise.resolve(MASTER),
    templates: () => Promise.resolve([]),
    lineage: () =>
      faults.lineage ? Promise.reject(new Error('lakebase down')) : Promise.resolve(SECTIONS_WITH_PSEUDO),
    section: (id: string) =>
      faults.section ? Promise.reject(new Error('lakebase down')) : Promise.resolve(SECTION_TEXT[id] ?? null),
    breadcrumb: (id: string) => Promise.resolve(id === 'd::Ⅳ.1' || id === 'd::Ⅳ.1#2' ? ['Ⅳ. 製剤に関する項目'] : []),
    subtreeUnapproved: (id: string) => Promise.resolve(mem.unapprovedSubtree.has(id)),
    fileName: (docId: string) => Promise.resolve(mem.files[docId] ?? docId),
    logTurn: (t: TurnLogRow) => {
      mem.turns.push(t);
      return Promise.resolve();
    },
    logAe: (a: AeRow) => {
      mem.ae.push(a);
      return Promise.resolve();
    },
    logTurnWithAe: (t: TurnLogRow, a: AeRow) => {
      store.aeCalls++;
      if (aeFailures > 0) {
        aeFailures--;
        return Promise.reject(new Error('lakebase down'));
      }
      mem.turns.push(t);
      mem.ae.push(a);
      return Promise.resolve();
    },
  };
  return store;
}

const SECTIONS_WITH_PSEUDO = [...SECTIONS, sec('d::Ⅳ.1#2', 3, 'd::Ⅳ.1')];

let mem: Mem;
let classify: ReturnType<typeof vi.fn<(i: unknown) => Promise<RawClassification>>>;
let search: ReturnType<typeof vi.fn<() => Promise<SearchResult>>>;

const deps = (over: Partial<Deps> = {}): Deps => ({
  store: memStore(mem),
  config: config(),
  ae_retry_delay_ms: 0,
  classify: classify as unknown as Deps['classify'],
  search: search as unknown as Deps['search'],
  ...over,
});

const turn = (message: string, over: Partial<RouteRequest> = {}, d: Deps = deps()) =>
  handleTurn({ conversation_id: 'c1', message, lang: 'ja', audience: 'HCP', ...over }, { email: 'dr@example.com' }, d);

const hitsFor = (section: string, score = 0.8): SearchResult => ({
  query: 'q',
  filters: { product_code: 'IMJUDO' },
  hits: [{ chunk_id: 'c', section_id: section, section_path: 'p', score }],
});

beforeEach(() => {
  mem = {
    states: new Map(),
    turns: [],
    ae: [],
    files: { JD0300_IF: 'JD0300_IF_v3.pdf' },
    unapprovedSubtree: new Set(),
  };
  classify = vi.fn(() => Promise.resolve(cls()));
  search = vi.fn(() => Promise.resolve(hitsFor('d::Ⅳ.1')));
});

describe('handleTurn', () => {
  it('4.2: header template + verbatim section markdown, citation, turn_log', async () => {
    const r = await turn('イジュドの組成を教えて');
    expect(r.route_id).toBe('4.2');
    expect(r.response.template_id).toBe('T_4X_HEADER');
    expect(r.response.text.endsWith('\n\n組成の本文')).toBe(true);
    expect(r.response.text).toBe(`${r.response.header_text}\n\n${r.response.section_text}`);
    expect(r.response.section_text).toBe('組成の本文');
    expect(r.response.template_status).toBe('FALLBACK');
    expect(r.response.section_context).toEqual({
      breadcrumb: ['Ⅳ. 製剤に関する項目'],
      part: null,
      parent_section_id: null,
    });
    expect(r.response.section_ids).toEqual(['d::Ⅳ.1']);
    expect(r.response.citations[0]).toMatchObject({
      doc_id: 'JD0300_IF',
      file_name: 'JD0300_IF_v3.pdf',
      pages: [12],
      section_path: 'Ⅳ.1',
    });
    expect(r.classification).toMatchObject({ product_code: 'IMJUDO', model: 'system.ai.test' });
    expect(r.classification?.thresholds).toEqual({
      ae: 0.35,
      ae_route: 0.8,
      injection: 0.6,
      has_request: 0.3,
      intent: 0.55,
      conditions: 0.5,
      retrieval: 0,
    });
    expect(r.retrieval?.top_score).toBe(0.8);
    expect(mem.turns).toHaveLength(1);
    expect(mem.turns[0]).toMatchObject({
      turn_id: r.turn_id,
      route_id: '4.2',
      user_email: 'dr@example.com',
      section_ids: ['d::Ⅳ.1'],
    });
  });

  it('5.2 then HIMALAYA: clarification is merged and answered as 5.1', async () => {
    classify.mockResolvedValue(intent('efficacy_safety'));
    const first = await turn('イジュドの有効性を教えて');
    expect(first.route_id).toBe('5.2');
    expect(first.pending_clarification).toBe('target_study');
    expect(first.response.section_ids).toEqual([]);

    search.mockResolvedValue(hitsFor('d::Ⅴ.5'));
    const second = await turn('HIMALAYA');
    expect(second.route_id).toBe('5.1');
    expect(second.merged_message).toBe('イジュドの有効性を教えて HIMALAYA');
    expect(second.pending_clarification).toBeNull();
    expect(second.response.template_id).toBe('T_5_1_HEADER');
    expect(second.response.text).toContain('臨床成績');
    expect(classify).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'イジュドの有効性を教えて HIMALAYA', pending_clarification: 'target_study' })
    );
    expect(mem.turns[1].merged_message).toBe('イジュドの有効性を教えて HIMALAYA');
  });

  it('retrieval below tau_ret falls back to route 2 and clears state', async () => {
    search.mockResolvedValue(hitsFor('d::Ⅳ.1', 0.1));
    const r = await turn('イジュドの組成を教えて', {}, deps({ config: config({ tau_ret: 0.5 }) }));
    expect(r.route_id).toBe('2');
    expect(r.response.section_ids).toEqual([]);
    expect(r.response.template_id).toBe('T_2');
    expect(r.retrieval?.top_score).toBe(0.1);
  });

  it('a failing search degrades to route 2 instead of throwing', async () => {
    search.mockRejectedValue(new Error('index offline'));
    const r = await turn('イジュドの組成を教えて');
    expect(r.route_id).toBe('2');
    expect(r.retrieval?.error).toBe('index offline');
  });

  it('a section that disappeared between search and lookup degrades to route 2', async () => {
    search.mockResolvedValue(hitsFor('d::missing'));
    const r = await turn('イジュドの組成を教えて');
    expect(r.route_id).toBe('2');
    expect(mem.turns[0].route_id).toBe('2');
  });

  it('AE inside a thank-you: route 1 and one ae_queue row', async () => {
    classify.mockResolvedValue(
      cls({ adverse_event: 0.93, has_request: 0.1, smalltalk: { choice: 'closing', confidence: 0.9 } })
    );
    const r = await turn('ありがとう。先日の患者さんが入院しました');
    expect(r.route_id).toBe('1');
    expect(r.ae_logged).toBe(true);
    expect(mem.ae).toHaveLength(1);
    expect(mem.ae[0]).toMatchObject({ turn_id: r.turn_id, ae_probability: 0.93, conversation_id: 'c1' });
    expect(search).not.toHaveBeenCalled();
  });

  it('review band: answered normally, queued as REVIEW with ae_logged true', async () => {
    classify.mockResolvedValue(cls({ adverse_event: 0.5 }));
    const r = await turn('イジュドの組成を教えて');
    expect(r.route_id).toBe('4.2');
    expect(r.ae_logged).toBe(true);
    expect(mem.ae).toHaveLength(1);
    expect(mem.ae[0]).toMatchObject({ status: 'REVIEW', ae_probability: 0.5, turn_id: r.turn_id });
    expect(mem.turns).toHaveLength(1);
  });

  it('review band: a failed REVIEW insert keeps the answer and logs loudly', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = memStore(mem, { aeFailures: 99 });
    classify.mockResolvedValue(cls({ adverse_event: 0.5 }));
    const r = await turn('イジュドの組成を教えて', {}, deps({ store }));
    expect(store.aeCalls).toBe(3);
    expect(r.route_id).toBe('4.2');
    expect(r.ae_logged).toBe(false);
    expect(mem.turns).toHaveLength(1);
    expect(errors.mock.calls.some((c) => String(c[0]).includes('AE REVIEW QUEUE WRITE FAILED'))).toBe(true);
    errors.mockRestore();
  });

  it('a true AE report (>= tau_ae_route) is still queued as NEW', async () => {
    classify.mockResolvedValue(cls({ adverse_event: 0.85 }));
    const r = await turn('患者が発疹を発症しました');
    expect(r.route_id).toBe('1');
    expect(mem.ae[0].status).toBe('NEW');
  });

  it('6.9 report_ae: route 1 but nothing queued when no event was described', async () => {
    classify.mockResolvedValue(
      cls({ adverse_event: 0.05, intent: { choice: 'report_ae', confidence: 0.9, probabilities: {} } })
    );
    const r = await turn('副作用を報告したいです');
    expect(r.route_id).toBe('1');
    expect(r.ae_logged).toBe(false);
    expect(mem.ae).toHaveLength(0);
  });

  it('6.9 an empty message is valid: 0a, no classifier call, logged', async () => {
    for (const message of ['', '   ']) {
      const r = await turn(message);
      expect(r.route_id).toBe('0a');
      expect(r.classification).toBeNull();
    }
    expect(classify).not.toHaveBeenCalled();
    expect(mem.turns).toHaveLength(2);
  });

  it('off-topic three times in a row gives 8.2, then starts over', async () => {
    classify.mockResolvedValue(intent('out_of_scope'));
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await turn('今日の天気は')).route_id);
    expect(ids).toEqual(['8.1', '8.1', '8.2', '8.1']);
  });

  it('System One failure (safe classification) routes to 2 and is flagged', async () => {
    const { safeClassification } = await import('./classify');
    classify.mockResolvedValue(safeClassification('m'));
    const r = await turn('イジュドの組成を教えて');
    expect(r.route_id).toBe('2');
    expect(r.classification?.degraded).toBe(true);
    expect(mem.turns[0].model_ids).toMatchObject({ degraded: true });
  });

  it('a failing store write does not fail the turn', async () => {
    const store = {
      ...memStore(mem),
      logTurn: () => Promise.reject(new Error('db down')),
      saveState: () => Promise.reject(new Error('db down')),
    };
    const r = await turn('イジュドの組成を教えて', {}, deps({ store }));
    expect(r.route_id).toBe('4.2');
  });

  it('runs inside a tracer turn and tags the route', async () => {
    const tags: Record<string, string>[] = [];
    const spans: string[] = [];
    const tracer = {
      turn: async (_m: unknown, fn: (t: never) => Promise<unknown>) =>
        fn({
          span: (name: string, _i: unknown, f: () => unknown) => {
            spans.push(name);
            return Promise.resolve(f());
          },
          tag: (t: Record<string, string>) => tags.push(t),
          traceId: () => 'tr-1',
        } as never),
    };
    const r = await turn('イジュドの組成を教えて', {}, deps({ tracer: tracer as unknown as Deps['tracer'] }));
    expect(spans).toEqual(['merge', 'precheck', 'classify', 'masterdata', 'decide', 'search', 'lookup', 'respond']);
    expect(tags[0]).toMatchObject({ route_id: '4.2', conversation_id: 'c1', turn_id: r.turn_id });
    expect(r.trace_id).toBe('tr-1');
    expect(mem.turns[0].trace_id).toBe('tr-1');
  });

  it('5.1 returns the unapproved clinical section with the 5.1 header', async () => {
    classify.mockResolvedValue(intent('efficacy_safety'));
    search.mockResolvedValue(hitsFor('d::Ⅴ.5'));
    const r = await turn('イジュド HIMALAYA の結果');
    expect(r.route_id).toBe('5.1');
    expect(r.response.template_id).toBe('T_5_1_HEADER');
    expect(r.response.section_text).toContain('臨床成績');
  });
});

describe('CONTRACTS 8: AE safety', () => {
  const degraded = async () => (await import('./classify')).safeClassification('m');

  it('a degraded turn always writes an UNCLASSIFIED ae_queue row; the route stays per flow', async () => {
    classify.mockResolvedValue(await degraded());
    const r = await turn('イジュド投与後に患者が発熱し入院しました');
    expect(r.route_id).toBe('2');
    expect(r.ae_logged).toBe(true);
    expect(mem.ae).toHaveLength(1);
    expect(mem.ae[0]).toMatchObject({
      status: 'UNCLASSIFIED',
      ae_probability: null,
      turn_id: r.turn_id,
      message: 'イジュド投与後に患者が発熱し入院しました',
    });
    expect(mem.turns[0].model_ids).toMatchObject({ degraded: true, ae_keyword_hit: true });
  });

  it('a degraded turn without AE words is queued too and records the keyword miss', async () => {
    classify.mockResolvedValue(await degraded());
    const r = await turn('イジュドの組成を教えて');
    expect(r.ae_logged).toBe(true);
    expect(mem.ae[0].status).toBe('UNCLASSIFIED');
    expect(mem.turns[0].model_ids).toMatchObject({ ae_keyword_hit: false });
  });

  it('turn_log and ae_queue are written together (one logTurnWithAe call)', async () => {
    const store = memStore(mem);
    classify.mockResolvedValue(cls({ adverse_event: 0.9 }));
    const r = await turn('患者が発疹を発症しました', {}, deps({ store }));
    expect(store.aeCalls).toBe(1);
    expect(mem.turns).toHaveLength(1);
    expect(mem.ae[0]).toMatchObject({ status: 'NEW', ae_probability: 0.9, turn_id: r.turn_id });
  });

  it('a healthy classified turn writes no ae_queue row', async () => {
    const r = await turn('イジュドの組成を教えて');
    expect(r.ae_logged).toBe(false);
    expect(mem.ae).toHaveLength(0);
  });

  it('retries the ae_queue write 3 times and succeeds on the last attempt', async () => {
    const store = memStore(mem, { aeFailures: 2 });
    classify.mockResolvedValue(cls({ adverse_event: 0.9 }));
    const r = await turn('患者が発疹を発症しました', {}, deps({ store }));
    expect(store.aeCalls).toBe(3);
    expect(r.route_id).toBe('1');
    expect(r.ae_logged).toBe(true);
    expect(mem.ae).toHaveLength(1);
  });

  it('after 3 failures the turn returns route 1 with ae_logged=false and logs loudly', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = memStore(mem, { aeFailures: 99 });
    classify.mockResolvedValue(await degraded());
    const r = await turn('イジュドの組成を教えて 副作用が心配', {}, deps({ store }));
    expect(store.aeCalls).toBe(3);
    expect(r.route_id).toBe('1');
    expect(r.ae_logged).toBe(false);
    expect(r.response.section_ids).toEqual([]);
    expect(r.response.template_id).toBe('T_1');
    expect(mem.ae).toHaveLength(0);
    // the turn itself is still logged, with the route the user saw
    expect(mem.turns).toHaveLength(1);
    expect(mem.turns[0].route_id).toBe('1');
    expect(errors.mock.calls.some((c) => String(c[0]).includes('AE QUEUE WRITE FAILED'))).toBe(true);
    errors.mockRestore();
  });

  it('a search route whose AE write fails does not return the section', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = memStore(mem, { aeFailures: 99 });
    classify.mockResolvedValue(await degraded());
    const r = await turn('イジュドの組成を教えて', {}, deps({ store }));
    expect(r.route_id).toBe('1');
    vi.restoreAllMocks();
  });
});

describe('CONTRACTS 8: lookup re-checks and response shape', () => {
  it('4.x refuses (route 2) a section whose subtree has an unapproved child', async () => {
    mem.unapprovedSubtree.add('d::Ⅳ.1');
    const r = await turn('イジュドの組成を教えて');
    expect(r.route_id).toBe('2');
    expect(r.response.section_text).toBeNull();
    expect(r.response.section_ids).toEqual([]);
  });

  it('refuses a section that the lookup finds REJECTED or no longer current', async () => {
    for (const over of [{ qa_status: 'REJECTED' }, { is_current: false }, { approved_flag: false }, { level: 1 }]) {
      SECTION_TEXT['d::Ⅳ.1'] = { ...SECTION_TEXT['d::Ⅳ.1'], ...over };
      const r = await turn('イジュドの組成を教えて');
      expect(r.route_id, JSON.stringify(over)).toBe('2');
    }
    SECTION_TEXT['d::Ⅳ.1'] = {
      ...SECTION_TEXT['d::Ⅳ.1'],
      qa_status: 'AUTO',
      is_current: true,
      approved_flag: true,
      level: 2,
    };
  });

  it('a split part reports its position and parent', async () => {
    search.mockResolvedValue(hitsFor('d::Ⅳ.1#2'));
    const r = await turn('イジュドの組成の続きを教えて', {}, deps({ config: config({ max_verbatim_chars: 50 }) }));
    expect(r.route_id).toBe('4.2');
    expect(r.response.section_ids).toEqual(['d::Ⅳ.1#2']);
    expect(r.response.section_context).toEqual({
      breadcrumb: ['Ⅳ. 製剤に関する項目'],
      part: '2/3',
      parent_section_id: 'd::Ⅳ.1',
    });
  });

  it('a template-only route has header_text only', async () => {
    classify.mockResolvedValue(intent('website'));
    const r = await turn('サイトはどこ');
    expect(r.route_id).toBe('6.1');
    expect(r.response).toMatchObject({ section_text: null, section_context: null, template_status: 'FALLBACK' });
    expect(r.response.text).toBe(r.response.header_text);
  });

  it('uses the registry file name, and the doc_id when the registry has no row', async () => {
    mem.files = {};
    const r = await turn('イジュドの組成を教えて');
    expect(r.response.citations[0].file_name).toBe('JD0300_IF');
  });
});

describe('CONTRACTS 8: store failures degrade to route 2 instead of throwing', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('getState failing: search routes answer 2 with a clear retrieval.error', async () => {
    const r = await turn('イジュドの組成を教えて', {}, deps({ store: memStore(mem, { getState: true }) }));
    expect(r.route_id).toBe('2');
    expect(r.retrieval?.error).toMatch(/conversation state unavailable: lakebase down/);
    expect(search).not.toHaveBeenCalled();
  });

  it('getState failing does not block safety routes', async () => {
    classify.mockResolvedValue(cls({ adverse_event: 0.9 }));
    const r = await turn('患者が発疹を発症しました', {}, deps({ store: memStore(mem, { getState: true }) }));
    expect(r.route_id).toBe('1');
    expect(r.ae_logged).toBe(true);
  });

  it('section lookup failing degrades to route 2 with retrieval.error', async () => {
    const r = await turn('イジュドの組成を教えて', {}, deps({ store: memStore(mem, { section: true }) }));
    expect(r.route_id).toBe('2');
    expect(r.retrieval?.error).toMatch(/section lookup failed: lakebase down/);
  });

  it('lineage failing degrades to route 2 with retrieval.error', async () => {
    const r = await turn('イジュドの組成を教えて', {}, deps({ store: memStore(mem, { lineage: true }) }));
    expect(r.route_id).toBe('2');
    expect(r.retrieval?.error).toMatch(/section lookup failed/);
  });
});

describe('CONTRACTS 8: conversation state belongs to one user', () => {
  it("ignores another user's pending clarification", async () => {
    classify.mockResolvedValue(intent('efficacy_safety'));
    const first = await turn('イジュドの有効性を教えて');
    expect(first.pending_clarification).toBe('target_study');

    // Same conversation_id, different user: the pending question is not merged
    const other = await handleTurn(
      { conversation_id: 'c1', message: 'HIMALAYA', lang: 'ja', audience: 'HCP' },
      { email: 'eve@example.com' },
      deps()
    );
    expect(other.merged_message).toBe('HIMALAYA');
    expect(other.pending_clarification).not.toBe('target_study');
  });

  it('the owner still gets their state back', async () => {
    classify.mockResolvedValue(intent('efficacy_safety'));
    await turn('イジュドの有効性を教えて');
    const again = await turn('HIMALAYA');
    expect(again.merged_message).toBe('イジュドの有効性を教えて HIMALAYA');
  });
});
