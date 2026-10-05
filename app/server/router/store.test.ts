import { describe, expect, it, vi } from 'vitest';
import type { Db, Queryable, Row } from '../types';
import { createStore, type AeRow, type TurnLogRow } from './store';

type Handler = (text: string, params: unknown[] | undefined) => Row[];

function fakeDb(handler: Handler) {
  const calls: { text: string; params?: unknown[] }[] = [];
  const query: Queryable['query'] = (text, params) => {
    calls.push({ text, params });
    return Promise.resolve({ rows: handler(text, params) });
  };
  return { db: { query } as Db, calls };
}

const stateRow = (owner: string | null): Row => ({
  user_email: owner,
  lang: 'ja',
  pending_clarification: 'target_study',
  pending_question: 'q',
  off_topic_streak: 1,
  last_product_code: 'IMJUDO',
});

const turn: TurnLogRow = {
  turn_id: 't1',
  conversation_id: 'c1',
  user_email: 'a@x.com',
  message: 'm',
  merged_message: 'm',
  route_id: '1',
  template_id: 'T_1',
  section_ids: [],
  classification: null,
  retrieval: null,
  model_ids: {},
  trace_id: null,
  latency_ms: 5,
};
const ae: AeRow = {
  ae_id: 'a1',
  turn_id: 't1',
  conversation_id: 'c1',
  message: 'm',
  ae_probability: null,
  status: 'UNCLASSIFIED',
};

describe('store: conversation state is bound to the user', () => {
  it('returns the state to its owner (case-insensitive)', async () => {
    const { db } = fakeDb(() => [stateRow('Dr@Example.com')]);
    const s = await createStore(db, '"ref"').getState('c1', 'ja', 'dr@example.com');
    expect(s).toMatchObject({ pending_clarification: 'target_study', last_product_code: 'IMJUDO' });
  });

  it('ignores a row owned by another user, or by a user when the caller is anonymous', async () => {
    const { db } = fakeDb(() => [stateRow('owner@example.com')]);
    const store = createStore(db, '"ref"');
    for (const caller of ['eve@example.com', null]) {
      const s = await store.getState('c1', 'en', caller);
      expect(s).toMatchObject({
        conversation_id: 'c1',
        lang: 'en',
        pending_clarification: null,
        last_product_code: null,
      });
    }
  });

  it('accepts a row that has no owner yet', async () => {
    const { db } = fakeDb(() => [stateRow(null)]);
    expect((await createStore(db, '"ref"').getState('c1', 'ja', 'a@x.com')).pending_clarification).toBe('target_study');
  });

  it('recent turns are scoped to the user as well', async () => {
    const { db, calls } = fakeDb(() => []);
    await createStore(db, '"ref"').recentTurns('c1', 3, 'a@x.com');
    expect(calls[0].text).toMatch(/user_email IS NOT DISTINCT FROM \$3/);
    expect(calls[0].params).toEqual(['c1', 3, 'a@x.com']);
  });
});

describe('store: reads', () => {
  it('lineage carries the fields the answer re-check needs', async () => {
    const { db, calls } = fakeDb(() => [
      {
        section_id: 's',
        section_path: 'Ⅳ.1',
        level: 2,
        parent_section_id: null,
        char_len: 4200,
        is_current: true,
        qa_status: 'AUTO',
        approved_flag: false,
      },
    ]);
    const rows = await createStore(db, '"ref"').lineage(['s']);
    expect(calls[0].text).toContain('char_len');
    expect(calls[0].text).toContain('qa_status');
    expect(rows[0]).toEqual({
      section_id: 's',
      section_path: 'Ⅳ.1',
      level: 2,
      parent_section_id: null,
      char_len: 4200,
      is_current: true,
      qa_status: 'AUTO',
      approved_flag: false,
    });
  });

  it('file names come from the synced docs_registry and are cached; unknown docs fall back to the doc_id', async () => {
    const { db, calls } = fakeDb((_t, p) => (p?.[0] === 'known' ? [{ file_name: 'IF_v3.pdf' }] : []));
    const store = createStore(db, '"ref"');
    expect(await store.fileName('known')).toBe('IF_v3.pdf');
    expect(await store.fileName('known')).toBe('IF_v3.pdf');
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('"ref".docs_registry');
    expect(await store.fileName('other')).toBe('other');
  });

  it('breadcrumb is ancestor titles, outermost first; subtreeUnapproved reads the count', async () => {
    const { db } = fakeDb((t) => (t.includes('count(*)') ? [{ n: 2 }] : [{ title: 'Ⅳ' }, { title: 'Ⅳ.1' }]));
    const store = createStore(db, '"ref"');
    expect(await store.breadcrumb('s')).toEqual(['Ⅳ', 'Ⅳ.1']);
    expect(await store.subtreeUnapproved('s')).toBe(true);
  });
});

describe('store: AE writes', () => {
  it('logTurnWithAe uses one transaction, and nothing is written outside it', async () => {
    const outside = vi.fn();
    const inside: string[] = [];
    const db: Db = {
      query: (t) => {
        outside(t);
        return Promise.resolve({ rows: [] });
      },
      transaction: async (fn) => fn({ query: (t) => (inside.push(t), Promise.resolve({ rows: [] })) }),
    };
    await createStore(db, '"ref"').logTurnWithAe(turn, ae);
    expect(outside).not.toHaveBeenCalled();
    expect(inside).toHaveLength(2);
    expect(inside[0]).toContain('app.turn_log');
    expect(inside[1]).toContain('app.ae_queue');
  });

  it('inserts the status and a null probability for UNCLASSIFIED', async () => {
    const { db, calls } = fakeDb(() => []);
    await createStore(db, '"ref"').logAe(ae);
    expect(calls[0].text).toMatch(/status/);
    expect(calls[0].params).toEqual(['a1', 't1', 'c1', 'm', null, 'UNCLASSIFIED']);
  });

  it('a failing ae insert rejects, so the transaction rolls back and the caller retries', async () => {
    const db: Db = {
      query: () => Promise.resolve({ rows: [] }),
      transaction: async (fn) =>
        fn({
          query: (t) => (t.includes('ae_queue') ? Promise.reject(new Error('boom')) : Promise.resolve({ rows: [] })),
        }),
    };
    await expect(createStore(db, '"ref"').logTurnWithAe(turn, ae)).rejects.toThrow('boom');
  });

  it('without a transaction helper it falls back to two inserts', async () => {
    const { db, calls } = fakeDb(() => []);
    await createStore(db, '"ref"').logTurnWithAe(turn, ae);
    expect(calls).toHaveLength(2);
  });
});
