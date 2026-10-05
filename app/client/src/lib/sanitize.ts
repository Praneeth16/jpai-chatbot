import DOMPurify from 'dompurify';

// Verbatim IF text is shown as text, never as markdown: a "*" or "#" in the source must stay a "*" or "#".
// The one exception is the parser's HTML <table> blocks, which are rendered as sanitised HTML.

export type Segment = { kind: 'text'; value: string } | { kind: 'table'; html: string };

const TABLE_OPEN_OR_CLOSE = /<(\/?)table(?=[\s>/])/gi;

/**
 * Splits verbatim text into plain-text runs and <table>...</table> blocks (nesting respected). An unclosed <table>
 * stays plain text, so it is escaped rather than parsed. Newlines next to a table are dropped because the table is
 * a block of its own; every other character of the text is kept exactly.
 */
export function splitTables(src: string): Segment[] {
  const segments: Segment[] = [];
  let pos = 0;
  for (;;) {
    TABLE_OPEN_OR_CLOSE.lastIndex = pos;
    let start = -1;
    let end = -1;
    let depth = 0;
    for (let m = TABLE_OPEN_OR_CLOSE.exec(src); m; m = TABLE_OPEN_OR_CLOSE.exec(src)) {
      if (m[1] === '') {
        if (depth === 0) start = m.index;
        depth++;
      } else if (depth > 0) {
        depth--;
        if (depth === 0) {
          const close = src.indexOf('>', m.index);
          end = close === -1 ? -1 : close + 1;
          break;
        }
      }
    }
    if (start === -1 || end === -1) break;
    segments.push({ kind: 'text', value: src.slice(pos, start) }, { kind: 'table', html: src.slice(start, end) });
    pos = end;
  }
  segments.push({ kind: 'text', value: src.slice(pos) });

  return segments
    .map((s, i): Segment => {
      if (s.kind !== 'text') return s;
      let value = s.value;
      if (segments[i - 1]?.kind === 'table') value = value.replace(/^\n+/, '');
      if (segments[i + 1]?.kind === 'table') value = value.replace(/\n+$/, '');
      return { kind: 'text', value };
    })
    .filter((s) => s.kind === 'table' || s.value !== '');
}

/** Table structure and the inline marks that change meaning inside a cell (sup/sub: m2 vs m²). No links, no media. */
export const TABLE_TAGS = [
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'br',
  'sub',
  'sup',
  'b',
  'strong',
  'i',
  'em',
  'u',
  'span',
];
export const TABLE_ATTRS = ['colspan', 'rowspan', 'scope'];

export interface Purifier {
  sanitize(dirty: string, config: Record<string, unknown>): string;
}

export function sanitizeTable(html: string, purify: Purifier = DOMPurify): string {
  return purify.sanitize(html, {
    ALLOWED_TAGS: TABLE_TAGS,
    ALLOWED_ATTR: TABLE_ATTRS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
