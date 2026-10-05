import { describe, expect, it } from 'vitest';
import { ROUTE_IDS } from '../../shared/api';
import { resolveTemplate, type TemplateRow } from './templates';

const row = (over: Partial<TemplateRow>): TemplateRow => ({
  template_id: 'T_X',
  route_id: '2',
  lang: 'ja',
  text: 'x',
  version: 1,
  status: 'PLACEHOLDER',
  ...over,
});

describe('templates', () => {
  it('returns the stored text verbatim, including braces (no substitution)', () => {
    const t = resolveTemplate([row({ text: '資料は {patient_materials_url} です' })], '2', 'ja');
    expect(t.text).toBe('資料は {patient_materials_url} です');
  });
  it('prefers APPROVED, then the highest version, and matches lang', () => {
    const rows = [
      row({ template_id: 'A', version: 9 }),
      row({ template_id: 'B', version: 1, status: 'APPROVED' }),
      row({ template_id: 'C', version: 2, status: 'APPROVED' }),
      row({ template_id: 'D', lang: 'en', version: 99, status: 'APPROVED' }),
    ];
    expect(resolveTemplate(rows, '2', 'ja').template_id).toBe('C');
    expect(resolveTemplate(rows, '2', 'en').template_id).toBe('D');
  });
  it('has a built-in fallback for every route and language', () => {
    for (const id of ROUTE_IDS) {
      for (const lang of ['ja', 'en'] as const) {
        const t = resolveTemplate([], id, lang);
        expect(t.text.length).toBeGreaterThan(5);
        expect(t.status).toBe('FALLBACK');
      }
    }
  });
});
