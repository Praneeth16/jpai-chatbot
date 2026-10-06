import { describe, expect, it } from 'vitest';
import { bestTitleMatch, bigrams, titleCore, titleScore, type TitleRow } from './title-match';

const row = (section_id: string, title: string, section_path = section_id): TitleRow => ({
  section_id,
  product_code: 'IMJUDO',
  section_path,
  title,
  level: 2,
  parent_section_id: null,
  char_len: 100,
  is_current: true,
  qa_status: 'AUTO',
  approved_flag: true,
  is_pseudo: false,
});

describe('titleCore', () => {
  it('drops bracketed parts, footnote digits, separators and glue words', () => {
    expect(titleCore('生殖発生毒性試験（カニクイザル）30）')).toBe('生殖発生毒性試験');
    expect(titleCore('血中濃度の推移')).toBe('血中濃度推移');
    expect(titleCore('効能又は効果追加、用法及び用量変更追加等の年月日及びその内容')).toBe(
      '効能又は効果追加用法用量変更追加年月日そ内容'
    );
    expect(titleCore('Ｃｍａｘ(ng/mL)')).toBe('cmax');
    expect(titleCore('副作用に関する情報について')).toBe('副作用情報');
    expect(titleCore('禁忌とその理由')).toBe('禁忌');
    expect(/[\d()）・、]/u.test(titleCore('生殖発生毒性試験（カニクイザル）30）'))).toBe(false);
  });
});

describe('bigrams', () => {
  it('handles empty, one character and whitespace', () => {
    expect(bigrams('')).toEqual(new Set());
    expect(bigrams(' ')).toEqual(new Set());
    expect(bigrams('禁')).toEqual(new Set(['禁']));
    expect(bigrams('貯 法')).toEqual(new Set(['貯法']));
    expect(bigrams('組成物')).toEqual(new Set(['組成', '成物']));
  });
});

describe('titleScore', () => {
  it('is the share of the title core covered by the query', () => {
    expect(titleScore('貯法', '包装状態での貯法')).toBeCloseTo(1 / 6);
    expect(titleScore('貯法', '有効期間')).toBe(0);
    expect(titleScore('血中濃度の推移', '血中濃度の推移')).toBeCloseTo(4 / 5);
    expect(titleScore('効能又は効果', '効能又は効果')).toBe(1);
    expect(titleScore('効能又は効果', '効能又は効果追加、用法及び用量変更追加等の年月日及びその内容')).toBeLessThan(
      0.3
    );
    expect(titleScore('妊婦に投与しても問題ありませんか', '妊婦')).toBe(1);
  });
  it('does not confuse 作用機序 with 副作用', () => {
    expect(titleScore('作用機序', '副作用')).toBe(0.5);
    expect(titleScore('作用機序', '副作用')).toBeLessThan(0.6);
  });
  it('is 0 when either side has no bigrams', () => {
    expect(titleScore('', '組成')).toBe(0);
    expect(titleScore('組成', '')).toBe(0);
    expect(titleScore('組成', '（注）')).toBe(0);
  });
});

describe('bestTitleMatch', () => {
  const rows = [row('a', '包装状態での貯法'), row('b', '有効期間')];
  it('returns the best covered title', () => {
    expect(bestTitleMatch('貯法', rows, 0.1)?.section_id).toBe('a');
  });
  it('returns null below minScore, on no overlap and on no rows', () => {
    expect(bestTitleMatch('貯法', rows, 0.6)).toBeNull();
    expect(bestTitleMatch('組成', rows, 0)).toBeNull();
    expect(bestTitleMatch('貯法', [], 0)).toBeNull();
    expect(bestTitleMatch('貯法', [row('x', '貯法')], 1.01)).toBeNull();
  });
  it('a full match beats a partial one', () => {
    const list = [
      row('long', '効能又は効果追加、用法及び用量変更追加等の年月日及びその内容'),
      row('short', '効能又は効果'),
    ];
    expect(bestTitleMatch('効能又は効果', list, 0.6)?.section_id).toBe('short');
  });
  it('ties go to the shorter section_path, then to the first row', () => {
    const list = [row('deep', '禁忌', 'Ⅷ.2.(1)'), row('shallow', '禁忌', 'Ⅷ.2'), row('shallow2', '禁忌', 'Ⅷ.3')];
    expect(bestTitleMatch('禁忌', list, 0.6)?.section_id).toBe('shallow');
    expect(bestTitleMatch('禁忌', [list[1], list[2]], 0.6)?.section_id).toBe('shallow');
  });
});
