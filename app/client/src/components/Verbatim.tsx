import { useMemo } from 'react';
import { type Segment, sanitizeTable, splitTables } from '../lib/sanitize.ts';

function TableBlock({ html }: { html: string }) {
  const clean = useMemo(() => sanitizeTable(html), [html]);
  // Sanitised with an allow-list of table tags and colspan / rowspan / scope only (lib/sanitize.ts).
  return <div className="table-scroll verbatim-table" dangerouslySetInnerHTML={{ __html: clean }} />;
}

/** Keys segments by character offset: they only change when the text does. */
function keyed(segments: Segment[]): (Segment & { key: string })[] {
  const out: (Segment & { key: string })[] = [];
  let offset = 0;
  for (const s of segments) {
    out.push({ ...s, key: `${s.kind}@${offset}` });
    offset += s.kind === 'table' ? s.html.length : s.value.length;
  }
  return out;
}

/**
 * Verbatim Interview Form text: escaped text with the original line breaks (pre-wrap), no markdown. Only the parser's
 * HTML tables are rendered as (sanitised) HTML.
 */
export function Verbatim({ text, className = '' }: { text: string; className?: string }) {
  const segments = useMemo(() => keyed(splitTables(text)), [text]);
  return (
    <div className={`verbatim ${className}`}>
      {segments.map((s) =>
        s.kind === 'table' ? (
          <TableBlock key={s.key} html={s.html} />
        ) : (
          <div key={s.key} className="verbatim-text" style={{ whiteSpace: 'pre-wrap' }}>
            {s.value}
          </div>
        )
      )}
    </div>
  );
}
