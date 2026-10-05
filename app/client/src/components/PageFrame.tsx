import type { ReactNode } from 'react';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { AlertTriangle } from 'lucide-react';
import { useI18n } from '../i18n/index.tsx';

export function PageFrame({
  title,
  intro,
  actions,
  children,
}: {
  title: string;
  intro?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            {intro && <p className="mt-1 text-muted-foreground">{intro}</p>}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}

export function LoadingBlock() {
  const { t } = useI18n();
  return (
    <div className="space-y-2" role="status">
      <span className="sr-only">{t('common.loading')}</span>
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-3/4" />
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-destructive/40 bg-[#fdf1f0] p-4" role="alert">
      <p className="flex items-center gap-1.5 font-medium text-destructive">
        <AlertTriangle className="size-4" aria-hidden="true" />
        {t('common.error')}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
      <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}
