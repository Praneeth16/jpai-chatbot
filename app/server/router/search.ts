import { z } from 'zod';
import type { RouterConfig } from './config';
import { dbxJson } from './dbx';
import type { SearchHit } from './flow';
import type { NeedsSearch } from './types';

export const SEARCH_COLUMNS = [
  'chunk_id',
  'section_id',
  'section_path',
  'product_code',
  'study_ids',
  'approved_flag',
] as const;

export interface SearchResult {
  query: string;
  filters: Record<string, unknown>;
  hits: (SearchHit & { section_path: string | null })[];
}

export type VectorSearchPost = (indexName: string, body: unknown) => Promise<unknown>;

const QueryResponse = z.object({
  manifest: z.object({ columns: z.array(z.object({ name: z.string() })) }),
  result: z.object({ data_array: z.array(z.array(z.unknown())).default([]) }),
});

const defaultPost: VectorSearchPost = (indexName, body) =>
  dbxJson(`/api/2.0/vector-search/indexes/${encodeURIComponent(indexName)}/query`, {
    method: 'POST',
    json: body,
    timeoutMs: 10_000,
  });

/** Standard endpoint filter dictionary (filters_json). The study is matched client side, see searchIndex. */
export function buildFilters(f: NeedsSearch['filters'], requireQaApproved = false): Record<string, unknown> {
  const filters: Record<string, unknown> = {
    product_code: f.product_code,
    is_current: f.is_current,
    audience: f.audience,
  };
  if (f.approved_flag) filters.approved_flag = true;
  // CONTRACTS section 8: REJECTED sections never come back; with require_qa_approved only APPROVED ones do.
  if (requireQaApproved) filters.qa_status = 'APPROVED';
  else filters['qa_status NOT'] = 'REJECTED';
  return filters;
}

/**
 * CONTRACTS section 6 step 6. REST call instead of the AppKit aiSearch plugin: the index is created by
 * bootstrap_job after the bundle deploys, so the plugin's required vector_search_index resource cannot be declared
 * in resources/app.yml, and the plugin is beta.
 *
 * study_ids is an array column; equality filters on arrays are not guaranteed, so the study is checked on the
 * returned study_ids column and the query over-fetches when a study is required.
 */
export async function searchIndex(
  need: NeedsSearch,
  config: RouterConfig,
  post: VectorSearchPost = defaultPost,
  indexName: string | undefined = process.env.AI_SEARCH_INDEX
): Promise<SearchResult> {
  if (!indexName) throw new Error('AI_SEARCH_INDEX is not set');
  const base = buildFilters(need.filters, config.require_qa_approved);
  const study = need.filters.study_id;
  const prefix = need.filters.section_prefix;

  const run = async (filters: Record<string, unknown>): Promise<SearchResult['hits']> => {
    const raw = await post(indexName, {
      query_text: need.query,
      query_type: 'HYBRID',
      num_results: study ? config.num_results * 3 : config.num_results,
      columns: SEARCH_COLUMNS,
      filters_json: JSON.stringify(filters),
    });
    const parsed = QueryResponse.parse(raw);
    const names = parsed.manifest.columns.map((c) => c.name);
    const col = (row: unknown[], name: string): unknown => row[names.indexOf(name)];
    return parsed.result.data_array
      .map((row) => {
        const studies = col(row, 'study_ids');
        return {
          chunk_id: String(col(row, 'chunk_id')),
          section_id: String(col(row, 'section_id')),
          section_path: col(row, 'section_path') == null ? null : String(col(row, 'section_path')),
          // The last manifest column is the relevance score.
          score: Number(row[row.length - 1]),
          studies: Array.isArray(studies) ? studies.map(String) : [],
        };
      })
      .filter((h) => !study || h.studies.includes(study))
      .slice(0, config.num_results)
      .map(({ studies: _studies, ...h }) => h);
  };

  // Standard endpoints treat "LIKE" as a substring match.
  let filters = prefix ? { ...base, 'section_path LIKE': prefix } : base;
  let hits = await run(filters);
  if (prefix && hits.length === 0) {
    filters = base;
    hits = await run(filters);
  }
  return { query: need.query, filters: study ? { ...filters, study_ids: study } : filters, hits };
}
