import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MASTER } from './fixtures';
import { buildTerms, matchMasterData, normalise, searchQuery, type MasterData } from './masterdata';

const match = (m: string) => matchMasterData(m, MASTER);

describe('masterdata', () => {
  it.each([
    'イジュドの用法を教えて',
    'Imjudo の用法',
    'トレメリムマブの用法',
    'tremelimumab dosage',
    'ｲｼﾞｭﾄﾞの用法', // half-width katakana
    'IMJUDO',
  ])('matches the product in %j', (m) => {
    expect(match(m).product_code).toBe('IMJUDO');
  });

  it('matches full-width study names after NFKC and lower-casing', () => {
    const r = match('ＨＩＭＡＬＡＹＡ試験の結果');
    expect(r.study_ids).toEqual(['HIMALAYA']);
  });

  it('matches the study code', () => {
    expect(match('d419cc00002').study_ids).toEqual(['HIMALAYA']);
  });

  it('normalises', () => {
    expect(normalise('ＨＩＭＡＬＡＹＡ  Ｔｅｓｔ')).toBe('himalaya test');
  });

  it('requires word boundaries for latin terms', () => {
    expect(match('imjudoxyz').product_code).toBe(null);
    expect(match('xtremelimumab').product_code).toBe(null);
  });

  it('takes the longest match and does not double count', () => {
    const r = match('イミフィンジ');
    expect(r.product_code).toBe('IMFINZI');
    expect(r.matched_terms).toHaveLength(1);
  });

  it('CONTRACTS 6.9: a study implies its product only when exactly one product owns it', () => {
    expect(match('PACIFIC の結果').product_code).toBe('IMFINZI');
    // POSEIDON lists two products (studies.csv), so nothing is inferred
    expect(match('POSEIDON の結果').product_code).toBe(null);
    // HIMALAYA lists two products, so nothing is inferred and the router asks
    expect(match('HIMALAYA の結果').product_code).toBe(null);
    expect(match('HIMALAYA の結果').study_ids).toEqual(['HIMALAYA']);
  });

  it('an explicit product wins over study inference', () => {
    expect(match('イジュド HIMALAYA').product_code).toBe('IMJUDO');
  });

  it('CONTRACTS 6.9: an indication term names the study when exactly one study fits the product', () => {
    const r = match('イジュドの肝細胞癌での有効性');
    expect(r.product_code).toBe('IMJUDO');
    expect(r.study_ids).toEqual(['HIMALAYA']);
  });

  it.each(['非小細胞肺癌', 'NSCLC'])(
    'CONTRACTS 8: %s with IMFINZI maps to POSEIDON, PACIFIC and AEGEAN, so no single study is inferred',
    (term) => {
      const r = match(`イミフィンジの${term}での有効性`);
      expect(r.product_code).toBe('IMFINZI');
      expect(r.study_ids).toEqual([]);
    }
  );

  it('an indication with several studies still names the one study that fits the product', () => {
    // POSEIDON is the only NSCLC study that lists IMJUDO
    const r = match('イジュドの非小細胞肺癌での有効性');
    expect(r.product_code).toBe('IMJUDO');
    expect(r.study_ids).toEqual(['POSEIDON']);
  });

  it('an ambiguous indication alone infers neither study nor product', () => {
    const r = match('非小細胞肺癌の成績');
    expect(r.study_ids).toEqual([]);
    expect(r.product_code).toBeNull();
  });

  it('keeps every target of a term in buildTerms and reports each in matched_terms', () => {
    const nsclc = buildTerms(MASTER).find((t) => t.term === 'nsclc');
    expect(nsclc?.targets.map((t) => t.target_id).sort()).toEqual(['AEGEAN', 'PACIFIC', 'POSEIDON']);
    expect(
      match('nsclc')
        .matched_terms.map((t) => t.target_id)
        .sort()
    ).toEqual(['AEGEAN', 'PACIFIC', 'POSEIDON']);
  });

  it('a term that names two products names neither (ask instead of guessing)', () => {
    const data = {
      ...MASTER,
      synonyms: [
        ...MASTER.synonyms,
        { term: 'pdl1薬', kind: 'product' as const, target_id: 'IMJUDO' },
        { term: 'pdl1薬', kind: 'product' as const, target_id: 'IMFINZI' },
      ],
    };
    expect(matchMasterData('pdl1薬の用法', data).product_code).toBeNull();
  });

  it('indication is ignored when two different studies fit', () => {
    expect(match('イジュド 肝細胞癌 非小細胞肺癌').study_ids).toEqual([]);
  });

  it('an explicit study beats an indication term', () => {
    expect(match('POSEIDON 肝細胞癌').study_ids).toEqual(['POSEIDON']);
  });

  it('indication alone implies study and then product when exactly one study maps to it', () => {
    const r = match('胆道癌の成績');
    expect(r.study_ids).toEqual(['TOPAZ-1']);
    expect(r.product_code).toBe('IMFINZI');
  });

  it('returns nothing for unrelated text', () => {
    expect(match('今日の天気は')).toMatchObject({ product_code: null, study_ids: [] });
  });
});

// The same checks against the real reference data, so the fixture cannot drift from data/reference/*.csv.
const refDir = path.resolve(__dirname, '../../../data/reference');
const csv = (file: string): Record<string, string>[] => {
  const [head, ...lines] = readFileSync(path.join(refDir, file), 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
};

describe.skipIf(!existsSync(path.join(refDir, 'studies.csv')))('masterdata against data/reference', () => {
  const real: MasterData = {
    products: [
      {
        product_code: 'IMFINZI',
        brand_ja: 'イミフィンジ',
        brand_en: 'Imfinzi',
        generic_ja: 'デュルバルマブ',
        generic_en: 'durvalumab',
        patient_materials_url: null,
        product_info_url: null,
      },
    ],
    studies: csv('studies.csv').map((r) => ({
      study_id: r.study_id,
      study_code: r.study_code || null,
      product_codes: r.product_codes.split('|'),
    })),
    synonyms: csv('synonyms.csv').map((r) => ({
      term: r.term,
      kind: r.kind as 'product' | 'study' | 'indication',
      target_id: r.target_id,
    })),
  };

  it.each(['非小細胞肺癌', 'NSCLC'])('IMFINZI + %s does not infer a single study', (term) => {
    const r = matchMasterData(`イミフィンジの${term}の有効性`, real);
    expect(r.product_code).toBe('IMFINZI');
    expect(r.study_ids).toEqual([]);
  });

  it('a one-study indication (TOPAZ-1) is still inferred', () => {
    expect(matchMasterData('イミフィンジの胆道癌', real).study_ids).toEqual(['TOPAZ-1']);
  });
});

describe('product_candidates', () => {
  it('a study of two products with no product named lists both, sorted', () => {
    expect(match('HIMALAYA の結果').product_candidates).toEqual(['IMFINZI', 'IMJUDO']);
  });

  it('is empty when a product is named or the study has one owner', () => {
    expect(match('イジュド HIMALAYA').product_candidates).toEqual([]);
    expect(match('PACIFIC の結果').product_candidates).toEqual([]);
    expect(match('用法を教えて').product_candidates).toEqual([]);
  });
});

describe('searchQuery', () => {
  const q = (m: string) => searchQuery(m, match(m));

  it('drops the product name and polite filler', () => {
    expect(q('イジュドの貯法を教えてください')).toBe('貯法');
    expect(q('Imjudoの有効期間は？')).toBe('有効期間は');
  });

  it('removes every occurrence, brand and generic alike', () => {
    const out = q('イジュド トレメリムマブ imjudo の用法用量について');
    expect(out).toBe('用法用量');
    for (const t of ['イジュド', 'トレメリムマブ', 'imjudo']) expect(out).not.toContain(t);
  });

  it('keeps study and indication terms', () => {
    expect(q('イジュドのHIMALAYA試験の全生存期間を教えて')).toBe('himalaya試験の全生存期間');
  });

  it('falls back to the normalised message when (almost) nothing is left', () => {
    expect(q('イジュド')).toBe('イジュド');
    expect(q('ＩＭＪＵＤＯを教えて')).toBe('imjudoを教えて');
  });
});
