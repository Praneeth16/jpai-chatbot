import { BookOpen, FileText } from 'lucide-react';
import { Button } from '@databricks/appkit-ui/react';
import type { Citation } from '../../../shared/api.ts';
import { useI18n } from '../i18n/index.tsx';

export function Citations({
  citations,
  onView,
}: {
  citations: Citation[];
  onView: (citation: Citation, page: number) => void;
}) {
  const { t } = useI18n();
  if (citations.length === 0) return null;
  return (
    <section aria-label={t('cite.title')} className="mt-3 rounded-md border bg-secondary/40 p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <BookOpen className="size-3.5" aria-hidden="true" />
        {t('cite.title')}
      </h4>
      <ul className="space-y-2">
        {citations.map((c) => (
          <li key={`${c.doc_id}:${c.section_path}`} className="text-xs leading-relaxed">
            <div className="flex items-start gap-1.5">
              <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <div className="font-medium">{c.file_name}</div>
                <div className="text-muted-foreground">
                  {t('cite.revision')}: {c.doc_rev} · {t('cite.section')}: {c.section_path} {c.title}
                </div>
                {c.pages.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground">{t('cite.pages')}:</span>
                    {c.pages.map((p) => (
                      <Button
                        key={p}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        aria-label={t('cite.viewPageAria', { file: c.file_name, n: p })}
                        title={t('cite.viewPage')}
                        onClick={() => onView(c, p)}
                      >
                        {t('cite.page', { n: p })}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
