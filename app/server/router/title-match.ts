/**
 * Match the cleaned search query against the section titles of the Interview Form (IF). The IF has a fixed table of
 * contents and HCP questions usually name the item they want (組成, 効能又は効果, 貯法, 禁忌...), which is a section
 * title. Offline on the eval set the section whose title was best covered by the query was right 18 of 19 times at a
 * coverage of 0.6 or more, against about 68% for the top vector hit. Pure: no I/O.
 */

/** A current section (level 2 or deeper) as the title match and finalize need it. Structurally a SectionMeta too. */
export interface TitleRow {
  section_id: string;
  product_code: string;
  section_path: string;
  title: string;
  level: number;
  parent_section_id: string | null;
  char_len: number | null;
  is_current: boolean;
  qa_status: string | null;
  approved_flag: boolean;
  is_pseudo: boolean;
}

// Longest first, so 'とその理由' goes before 'の'.
const TITLE_WORDS = ['とその理由', 'に関する', 'における', 'について', '及び', '等', 'の'];

/** The part of a title a question can be expected to repeat: no bracketed parts, footnote digits, separators or glue words. */
export function titleCore(title: string): string {
  let s = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)/gu, '') // （カニクイザル）; NFKC made the brackets ASCII
    .replace(/\d+/gu, '')
    .replace(/\)+$/u, '') // what is left of a footnote marker such as "30）"
    .replace(/[・、]/gu, '');
  for (const w of TITLE_WORDS) s = s.split(w).join('');
  return s;
}

/** Set of 2-character substrings, whitespace ignored. A 1-character string is its own single element. */
export function bigrams(s: string): Set<string> {
  const t = s.replace(/\s+/gu, '');
  const out = new Set<string>();
  if (t.length === 0) return out;
  if (t.length === 1) return out.add(t);
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** Share of the title (its core) covered by the query. `query` is the cleaned search query. */
export function titleScore(query: string, title: string): number {
  const t = bigrams(titleCore(title));
  const q = bigrams(query);
  if (t.size === 0 || q.size === 0) return 0;
  let shared = 0;
  for (const g of t) if (q.has(g)) shared++;
  return shared / t.size;
}

/**
 * The row whose title the query covers best, if that reaches minScore (and is above 0). Ties: the shallower
 * section_path (shorter), then the order of `sections`. Considers only the rows passed in; the caller filters.
 */
export function bestTitleMatch(query: string, sections: TitleRow[], minScore: number): TitleRow | null {
  let best: TitleRow | null = null;
  let bestScore = 0;
  for (const row of sections) {
    const score = titleScore(query, row.title);
    if (score <= 0 || score < minScore) continue;
    if (
      best === null ||
      score > bestScore ||
      (score === bestScore && row.section_path.length < best.section_path.length)
    ) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}
