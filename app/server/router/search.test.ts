import { describe, expect, it, vi } from 'vitest';
import { config } from './fixtures';
import { buildFilters, searchIndex } from './search';

const response = (rows: unknown[][]) => ({
  manifest: {
    columns: ['chunk_id', 'section_id', 'section_path', 'product_code', 'study_ids', 'approved_flag', 'score'].map(
      (name) => ({ name })
    ),
  },
  result: { row_count: rows.length, data_array: rows },
});
const row = (chunk: string, section: string, studies: string[], score: number) => [
  chunk,
  section,
  'Ⅴ.5',
  'IMJUDO',
  studies,
  false,
  score,
];

const need = (study?: string) => ({
  query: 'イジュドの有効性 HIMALAYA',
  mode: 'subsection' as const,
  filters: {
    product_code: 'IMJUDO',
    is_current: true as const,
    audience: 'HCP' as const,
    approved_flag: true as const,
    ...(study ? { study_id: study } : {}),
  },
});

describe('searchIndex', () => {
  it('sends a HYBRID query with the CONTRACTS filters', async () => {
    const post = vi.fn().mockResolvedValue(response([row('c1', 's1', [], 0.7)]));
    const r = await searchIndex(need(), config(), post, 'c.s.if_chunks_idx');
    const [index, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(index).toBe('c.s.if_chunks_idx');
    expect(body).toMatchObject({ query_type: 'HYBRID', num_results: 8, query_text: 'イジュドの有効性 HIMALAYA' });
    expect(JSON.parse(body.filters_json as string)).toEqual({
      product_code: 'IMJUDO',
      is_current: true,
      audience: 'HCP',
      approved_flag: true,
      'qa_status NOT': 'REJECTED',
    });
    expect(body.columns).not.toContain('chunk_to_retrieve');
    expect(r.hits).toEqual([{ chunk_id: 'c1', section_id: 's1', section_path: 'Ⅴ.5', score: 0.7 }]);
  });

  it('omits approved_flag when the route allows unapproved sections', () => {
    expect(buildFilters({ product_code: 'X', is_current: true, audience: 'HCP' })).toEqual({
      product_code: 'X',
      is_current: true,
      audience: 'HCP',
      'qa_status NOT': 'REJECTED',
    });
  });

  it('passes a product list through as an IN filter', () => {
    expect(buildFilters({ product_code: ['A', 'B'], is_current: true, audience: 'HCP' })).toMatchObject({
      product_code: ['A', 'B'],
    });
  });

  it('CONTRACTS 8: require_qa_approved keeps only APPROVED sections', async () => {
    expect(buildFilters({ product_code: 'X', is_current: true, audience: 'HCP' }, true)).toEqual({
      product_code: 'X',
      is_current: true,
      audience: 'HCP',
      qa_status: 'APPROVED',
    });
    const post = vi.fn().mockResolvedValue(response([]));
    await searchIndex(need(), config({ require_qa_approved: true }), post, 'i');
    const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(JSON.parse(body.filters_json as string)).toMatchObject({ qa_status: 'APPROVED', audience: 'HCP' });
  });

  it('checks the study on study_ids and over-fetches', async () => {
    const post = vi
      .fn()
      .mockResolvedValue(
        response([row('c1', 's1', ['POSEIDON'], 0.9), row('c2', 's2', ['HIMALAYA'], 0.8), row('c3', 's3', [], 0.7)])
      );
    const r = await searchIndex(need('HIMALAYA'), config(), post, 'i');
    expect((post.mock.calls[0] as [string, Record<string, unknown>])[1].num_results).toBe(24);
    expect(r.hits.map((h) => h.chunk_id)).toEqual(['c2']);
    expect(r.filters).toMatchObject({ study_ids: 'HIMALAYA' });
  });

  it('throws when the index is not configured', async () => {
    await expect(searchIndex(need(), config(), vi.fn(), undefined)).rejects.toThrow(/AI_SEARCH_INDEX/);
  });
});
