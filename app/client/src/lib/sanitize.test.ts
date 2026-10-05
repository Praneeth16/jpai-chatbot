import { describe, expect, it, vi } from 'vitest';
import { sanitizeTable, splitTables, TABLE_ATTRS, TABLE_TAGS } from './sanitize.ts';

const TABLE = '<table><tr><th colspan="2">用量</th></tr><tr><td>300 mg</td><td rowspan="2">q4w</td></tr></table>';

describe('splitTables', () => {
  it('keeps plain text exactly, with no markdown interpretation', () => {
    const text = '## 見出し\n* 箇条書き\n**太字** と _下線_ と `code`\n\n次の段落';
    expect(splitTables(text)).toEqual([{ kind: 'text', value: text }]);
  });

  it('pulls out an HTML table and keeps the text around it', () => {
    expect(splitTables(`前の文\n\n${TABLE}\n\n後の文`)).toEqual([
      { kind: 'text', value: '前の文' },
      { kind: 'table', html: TABLE },
      { kind: 'text', value: '後の文' },
    ]);
  });

  it('handles several tables, attributes on <table>, and upper case tags', () => {
    const segs = splitTables(`<TABLE border="1"><tr><td>a</td></tr></TABLE>間<table><tr><td>b</td></tr></table>`);
    expect(segs.map((s) => s.kind)).toEqual(['table', 'text', 'table']);
    expect(segs[1]).toEqual({ kind: 'text', value: '間' });
  });

  it('matches nested tables as one block', () => {
    const nested = '<table><tr><td><table><tr><td>in</td></tr></table></td></tr></table>';
    expect(splitTables(`x${nested}y`)).toEqual([
      { kind: 'text', value: 'x' },
      { kind: 'table', html: nested },
      { kind: 'text', value: 'y' },
    ]);
  });

  it('leaves an unclosed table as text so it is escaped, not parsed', () => {
    const text = '前 <table><tr><td>x';
    expect(splitTables(text)).toEqual([{ kind: 'text', value: text }]);
  });

  it('does not treat <tablet> or <tables> as a table', () => {
    expect(splitTables('<tablet>x</tablet>')).toEqual([{ kind: 'text', value: '<tablet>x</tablet>' }]);
  });

  it('keeps script tags outside tables as inert text', () => {
    const text = '<script>alert(1)</script>';
    expect(splitTables(text)).toEqual([{ kind: 'text', value: text }]);
  });

  it('keeps inner newlines of text runs (pre-wrap depends on them)', () => {
    expect(splitTables('a\n\nb\n  c')).toEqual([{ kind: 'text', value: 'a\n\nb\n  c' }]);
  });

  it('returns nothing for an empty string', () => {
    expect(splitTables('')).toEqual([]);
  });
});

describe('sanitizeTable', () => {
  it('asks DOMPurify for a table-only allow-list that keeps colspan and rowspan', () => {
    const purify = { sanitize: vi.fn((dirty: string) => dirty) };
    expect(sanitizeTable(TABLE, purify)).toBe(TABLE);
    const [, config] = purify.sanitize.mock.calls[0] as unknown as [string, Record<string, string[]>];
    expect(config.ALLOWED_TAGS).toEqual(expect.arrayContaining(['table', 'thead', 'tbody', 'tr', 'th', 'td']));
    expect(config.ALLOWED_ATTR).toEqual(expect.arrayContaining(['colspan', 'rowspan']));
  });

  it('allows nothing that can run or load: no script, style, iframe, img, a, form, event handlers or style attributes', () => {
    for (const bad of ['script', 'style', 'iframe', 'img', 'a', 'form', 'input', 'svg', 'object', 'link']) {
      expect(TABLE_TAGS).not.toContain(bad);
    }
    for (const bad of ['style', 'href', 'src', 'onclick', 'onerror', 'class', 'id']) {
      expect(TABLE_ATTRS).not.toContain(bad);
    }
  });
});
