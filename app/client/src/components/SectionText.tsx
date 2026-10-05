import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@databricks/appkit-ui/react';
import type { SectionContext, SectionResponse } from '../../../shared/api.ts';
import { useI18n } from '../i18n/index.tsx';
import { getSection } from '../lib/api.ts';
import { Verbatim } from './Verbatim.tsx';

/** Bodies longer than this start collapsed. */
export const COLLAPSE_CHARS = 4000;

/** Verbatim section text; a long body sits in a <details> with a "show all" toggle. */
export function SectionText({ text }: { text: string }) {
  const { t } = useI18n();
  if (text.length <= COLLAPSE_CHARS) return <Verbatim text={text} />;
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-primary [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
        <span className="group-open:hidden">{t('chat.showAll', { n: text.length.toLocaleString() })}</span>
        <span className="hidden group-open:inline">{t('chat.collapse')}</span>
      </summary>
      <div className="mt-2">
        <Verbatim text={text} />
      </div>
    </details>
  );
}

/** Ancestor titles, then the section itself, and the "k/n" part marker for a split section. */
export function Breadcrumb({ context, current }: { context: SectionContext; current: string }) {
  const { t } = useI18n();
  const trail = [...context.breadcrumb, current].filter(Boolean);
  return (
    <nav aria-label={t('chat.breadcrumb')} className="mb-2 text-xs text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-x-1">
        {trail.map((crumb, i) => (
          <li key={trail.slice(0, i + 1).join('›')} className="flex items-center gap-x-1">
            {i > 0 && <span aria-hidden="true">›</span>}
            <span className={i === trail.length - 1 ? 'font-medium text-foreground' : ''}>{crumb}</span>
          </li>
        ))}
        {context.part && (
          <li className="ml-1 rounded bg-secondary px-1.5 py-px text-[10px] font-semibold">
            {t('chat.part', { part: context.part })}
          </li>
        )}
      </ol>
    </nav>
  );
}

type ParentState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: SectionResponse }
  | { status: 'error'; detail: string };

/** "Show full parent section": fetches GET /api/v1/sections/:id on demand and shows it verbatim below. */
export function ParentSection({ sectionId }: { sectionId: string }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<ParentState>({ status: 'idle' });
  const [open, setOpen] = useState(false);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (state.status === 'ok' || state.status === 'loading') return;
    setState({ status: 'loading' });
    try {
      setState({ status: 'ok', data: await getSection(sectionId, lang) });
    } catch (err) {
      setState({ status: 'error', detail: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="mt-2">
      <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => void toggle()}>
        {open ? t('chat.hideParent') : t('chat.showParent')}
      </Button>
      {open && (
        <div className="mt-2 rounded-md border bg-background/60 p-3" aria-live="polite">
          {state.status === 'loading' && <p className="text-xs text-muted-foreground">{t('chat.parentLoading')}</p>}
          {state.status === 'error' && (
            <p className="text-xs text-destructive" role="alert">
              {t('chat.parentError', { detail: state.detail })}
            </p>
          )}
          {state.status === 'ok' && (
            <>
              <h4 className="mb-1 text-xs font-semibold text-muted-foreground">{t('chat.parentTitle')}</h4>
              <Breadcrumb
                context={state.data.section_context}
                current={`${state.data.section_path} ${state.data.title}`}
              />
              {state.data.header_text && (
                <p className="template-text mb-2 whitespace-pre-wrap text-sm">{state.data.header_text}</p>
              )}
              {!state.data.approved_flag && (
                <p className="mb-2 text-xs text-[#6b4b00]">{t('chat.unapprovedSection')}</p>
              )}
              <SectionText text={state.data.section_text} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
