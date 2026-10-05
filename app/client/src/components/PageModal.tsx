import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@databricks/appkit-ui/react';
import type { Citation } from '../../../shared/api.ts';
import { useI18n } from '../i18n/index.tsx';
import { getPageImage } from '../lib/api.ts';
import { HttpError } from '../lib/http.ts';

type Outcome = { kind: 'ok'; src: string } | { kind: 'missing' } | { kind: 'failed' };

interface Result {
  page: number;
  attempt: number;
  outcome: Outcome;
}

export interface PageTarget {
  citation: Citation;
  page: number;
}

/** Mount with key={doc_id:page} so the selected page resets when a different citation is opened. */
export function PageModal({ target, onClose }: { target: PageTarget; onClose: () => void }) {
  const { t } = useI18n();
  const [page, setPage] = useState(target.page);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const docId = target.citation.doc_id;

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    getPageImage(docId, page)
      .then((src) => {
        if (cancelled) {
          if (src.startsWith('blob:')) URL.revokeObjectURL(src);
          return;
        }
        if (src.startsWith('blob:')) objectUrl = src;
        setResult({ page, attempt, outcome: { kind: 'ok', src } });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const outcome: Outcome =
          err instanceof HttpError && err.status === 404 ? { kind: 'missing' } : { kind: 'failed' };
        setResult({ page, attempt, outcome });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [docId, page, attempt]);

  const outcome = result && result.page === page && result.attempt === attempt ? result.outcome : null;

  const citation = target.citation;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('page.title')}</DialogTitle>
          <DialogDescription>
            {`${citation.file_name} · ${citation.section_path} ${citation.title} · ${t('cite.page', { n: page })}`}
          </DialogDescription>
        </DialogHeader>
        {citation.pages.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('cite.pages')}>
            {citation.pages.map((p) => (
              <Button
                key={p}
                size="sm"
                variant={p === page ? 'default' : 'outline'}
                aria-pressed={p === page}
                onClick={() => setPage(p)}
              >
                {t('cite.page', { n: p })}
              </Button>
            ))}
          </div>
        )}
        <div className="min-h-48 rounded-md border bg-secondary/40 p-2" aria-live="polite">
          {outcome === null && (
            <div className="space-y-2" role="status">
              <span className="sr-only">{t('page.loading')}</span>
              <Skeleton className="h-96 w-full" />
            </div>
          )}
          {outcome?.kind === 'ok' && (
            <img
              src={outcome.src}
              alt={t('page.alt', { file: citation.file_name, n: page })}
              className="mx-auto h-auto max-w-full bg-white shadow-sm"
            />
          )}
          {outcome?.kind === 'missing' && <p className="p-6 text-center text-muted-foreground">{t('page.notFound')}</p>}
          {outcome?.kind === 'failed' && (
            <div className="space-y-3 p-6 text-center">
              <p className="text-destructive">{t('page.failed')}</p>
              <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                {t('common.retry')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
