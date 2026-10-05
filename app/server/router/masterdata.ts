import type { MasterMatch } from './types';

export interface SynonymRow {
  term: string;
  kind: 'product' | 'study' | 'indication';
  target_id: string;
}

export interface ProductRow {
  product_code: string;
  brand_ja: string | null;
  brand_en: string | null;
  generic_ja: string | null;
  generic_en: string | null;
  patient_materials_url: string | null;
  product_info_url: string | null;
}

export interface StudyRow {
  study_id: string;
  study_code: string | null;
  product_codes: string[];
}

export interface MasterData {
  synonyms: SynonymRow[];
  products: ProductRow[];
  studies: StudyRow[];
}

export function normalise(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

const ASCII_WORD = /^[a-z0-9]+$/;
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[a-z0-9]/.test(c);

interface Target {
  kind: 'product' | 'study' | 'indication';
  target_id: string;
}

/** One normalised term. A term can name several targets (NSCLC is the indication of POSEIDON, PACIFIC and AEGEAN). */
interface Term {
  term: string;
  targets: Target[];
}

/** Synonyms table plus the names and codes in products / studies, so the match works even if the synonyms sync lags. */
export function buildTerms(data: MasterData): Term[] {
  const seen = new Map<string, Term>();
  const add = (raw: string | null | undefined, kind: Target['kind'], target: string): void => {
    if (!raw) return;
    const term = normalise(raw);
    if (term.length < 2 && ASCII_WORD.test(term)) return;
    if (term.length === 0) return;
    const entry = seen.get(term) ?? { term, targets: [] };
    if (!entry.targets.some((t) => t.kind === kind && t.target_id === target)) {
      entry.targets.push({ kind, target_id: target });
    }
    seen.set(term, entry);
  };
  for (const s of data.synonyms) add(s.term, s.kind, s.target_id);
  for (const p of data.products) {
    for (const t of [p.brand_ja, p.brand_en, p.generic_ja, p.generic_en, p.product_code]) {
      add(t, 'product', p.product_code);
    }
  }
  for (const s of data.studies) {
    add(s.study_id, 'study', s.study_id);
    add(s.study_code, 'study', s.study_id);
  }
  return [...seen.values()].sort((a, b) => b.term.length - a.term.length);
}

const pushUnique = (list: string[], id: string): void => {
  if (!list.includes(id)) list.push(id);
};

/**
 * NFKC + lowercase, then longest-match-first scan. Latin terms must sit on word boundaries; Japanese terms
 * match as substrings. A matched span is consumed so a shorter synonym cannot match inside it.
 */
export function matchMasterData(message: string, data: MasterData): MasterMatch {
  const text = normalise(message);
  const consumed = new Array<boolean>(text.length).fill(false);
  const hits: { pos: number; term: Term }[] = [];

  for (const t of buildTerms(data)) {
    let from = 0;
    for (;;) {
      const pos = text.indexOf(t.term, from);
      if (pos === -1) break;
      from = pos + 1;
      const end = pos + t.term.length;
      if (consumed.slice(pos, end).some(Boolean)) continue;
      if (ASCII_WORD.test(t.term) && (isWordChar(text[pos - 1]) || isWordChar(text[end]))) continue;
      consumed.fill(true, pos, end);
      hits.push({ pos, term: t });
    }
  }
  hits.sort((a, b) => a.pos - b.pos);

  const studyIds: string[] = [];
  const indicationStudies: string[] = [];
  let product: string | null = null;
  for (const { term } of hits) {
    const products = term.targets.filter((t) => t.kind === 'product').map((t) => t.target_id);
    // The first product term decides; a term that names several products is ambiguous and names none.
    if (product === null && products.length === 1) product = products[0];
    for (const t of term.targets) {
      if (t.kind === 'study') pushUnique(studyIds, t.target_id);
      if (t.kind === 'indication') pushUnique(indicationStudies, t.target_id);
    }
  }

  // CONTRACTS 6.9: an indication term (肝細胞癌, NSCLC) names a study only when exactly one study fits the product.
  // With no product in the message the candidates are all studies the indication maps to.
  if (studyIds.length === 0 && indicationStudies.length > 0) {
    const fits = indicationStudies.filter(
      (id) => product === null || (data.studies.find((s) => s.study_id === id)?.product_codes ?? []).includes(product)
    );
    if (fits.length === 1) studyIds.push(fits[0]);
  }

  // CONTRACTS 6.9: a study implies its product when the studies table lists exactly one product for it.
  if (product === null && studyIds.length > 0) {
    const owners = new Set(studyIds.flatMap((id) => data.studies.find((s) => s.study_id === id)?.product_codes ?? []));
    if (owners.size === 1) product = [...owners][0];
  }

  return {
    product_code: product,
    study_ids: studyIds,
    matched_terms: hits.flatMap((h) =>
      h.term.targets.map((t) => ({ term: h.term.term, kind: t.kind, target_id: t.target_id }))
    ),
  };
}
