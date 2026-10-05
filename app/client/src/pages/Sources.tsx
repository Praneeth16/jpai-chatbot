import { RefreshCw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import type { UploadResponse } from '../../../shared/api.ts';
import { ErrorBlock, LoadingBlock, PageFrame } from '../components/PageFrame.tsx';
import { useI18n } from '../i18n/index.tsx';
import { getDocs, uploadDoc } from '../lib/api.ts';
import { formatDateTime } from '../lib/format.ts';
import { useAsync } from '../lib/useAsync.ts';
import { useIsAdmin } from '../lib/useAdmin.ts';

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'done'; result: UploadResponse }
  | { kind: 'error'; message: string };

export function Sources() {
  const { t, lang } = useI18n();
  const { state, reload } = useAsync(getDocs);
  const isAdmin = useIsAdmin();
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadState>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUpload({ kind: 'error', message: t('sources.pdfOnly') });
      return;
    }
    setUpload({ kind: 'uploading' });
    try {
      const result = await uploadDoc(file);
      setUpload({ kind: 'done', result });
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setUpload({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <PageFrame
      title={t('sources.title')}
      intro={t('sources.intro')}
      actions={
        <Button variant="outline" size="sm" onClick={reload} disabled={state.status === 'loading'}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t('common.refresh')}
        </Button>
      }
    >
      <section className="overflow-hidden rounded-lg border bg-card">
        {state.status === 'loading' && (
          <div className="p-4">
            <LoadingBlock />
          </div>
        )}
        {state.status === 'error' && (
          <div className="p-4">
            <ErrorBlock error={state.error} onRetry={reload} />
          </div>
        )}
        {state.status === 'ok' &&
          (state.data.docs.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground">{t('common.empty')}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('sources.file')}</TableHead>
                    <TableHead>{t('sources.product')}</TableHead>
                    <TableHead>{t('sources.revision')}</TableHead>
                    <TableHead className="text-right">{t('sources.sections')}</TableHead>
                    <TableHead>{t('sources.current')}</TableHead>
                    <TableHead>{t('sources.ingested')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.data.docs.map((d) => (
                    <TableRow key={d.doc_id}>
                      <TableCell className="font-medium">{d.file_name}</TableCell>
                      <TableCell>{d.product_code ?? '—'}</TableCell>
                      <TableCell>{d.doc_rev ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.section_count}</TableCell>
                      <TableCell>
                        <Badge variant={d.is_current ? 'default' : 'secondary'}>
                          {d.is_current ? t('sources.currentYes') : t('sources.currentNo')}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDateTime(d.ingested_at, lang)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                {t('sources.source', { source: state.data.source })}
              </p>
            </>
          ))}
      </section>

      {isAdmin && (
        <section className="rounded-lg border bg-card p-4" aria-labelledby="upload-h">
          <h3 id="upload-h" className="font-semibold">
            {t('sources.upload')}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('sources.uploadHelp')}</p>
          <form className="mt-3 flex flex-wrap items-center gap-3" onSubmit={(e) => void onSubmit(e)}>
            <label className="sr-only" htmlFor="pdf-file">
              {t('sources.choose')}
            </label>
            <input
              id="pdf-file"
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setUpload({ kind: 'idle' });
              }}
              className="max-w-full rounded-md border bg-background text-sm file:mr-3 file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium"
            />
            <Button type="submit" disabled={!file || upload.kind === 'uploading'}>
              <Upload className="size-4" aria-hidden="true" />
              {upload.kind === 'uploading' ? t('sources.uploading') : t('sources.uploadButton')}
            </Button>
          </form>
          <div aria-live="polite" className="mt-3 space-y-1 text-sm">
            {upload.kind === 'done' && (
              <>
                <p className="font-medium text-[#1f5a2a]">{t('sources.uploaded', { file: upload.result.file_name })}</p>
                <p>
                  {upload.result.run_id !== null
                    ? t('sources.runId', { id: upload.result.run_id })
                    : t('sources.noRun')}
                </p>
                {upload.result.warning && <p className="text-[#6b4b00]">{upload.result.warning}</p>}
                <p className="text-muted-foreground">{t('sources.indexingNote')}</p>
              </>
            )}
            {upload.kind === 'error' && (
              <p className="text-destructive" role="alert">
                {upload.message}
              </p>
            )}
          </div>
        </section>
      )}
    </PageFrame>
  );
}
