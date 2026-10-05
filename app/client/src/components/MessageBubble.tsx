import type { ReactNode } from 'react';
import { AlertTriangle, Bot, User } from 'lucide-react';
import { Button } from '@databricks/appkit-ui/react';
import type { Citation, RouteResponse } from '../../../shared/api.ts';
import { useI18n } from '../i18n/index.tsx';
import { routeFamily } from '../lib/routes.ts';
import { Citations } from './Citations.tsx';
import { RouteBadge } from './RouteBadge.tsx';
import { Breadcrumb, ParentSection, SectionText } from './SectionText.tsx';
import { WhyPanel } from './WhyPanel.tsx';

export function UserBubble({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <div className="flex justify-end gap-2">
      <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-primary-foreground shadow-sm sm:max-w-[75%]">
        <span className="sr-only">{t('chat.you')}: </span>
        <p className="whitespace-pre-wrap">{text}</p>
      </div>
      <User className="mt-2 hidden size-5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
    </div>
  );
}

function BotShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <Bot className="mt-2 hidden size-5 shrink-0 text-primary sm:block" aria-hidden="true" />
      <div className="min-w-0 max-w-full flex-1 sm:max-w-[88%]">{children}</div>
    </div>
  );
}

export function ThinkingBubble() {
  const { t } = useI18n();
  return (
    <BotShell>
      <div
        className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm border bg-card px-4 py-2.5 text-muted-foreground"
        role="status"
      >
        <span className="flex gap-1" aria-hidden="true">
          {[0, 150, 300].map((d) => (
            <span
              key={d}
              className="size-1.5 animate-bounce rounded-full bg-primary/60"
              style={{ animationDelay: `${d}ms` }}
            />
          ))}
        </span>
        {t('chat.thinking')}
      </div>
    </BotShell>
  );
}

export function ErrorBubble({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <BotShell>
      <div className="rounded-2xl rounded-bl-sm border border-destructive/40 bg-[#fdf1f0] px-4 py-3" role="alert">
        <p className="flex items-center gap-1.5 font-medium text-destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          {t('chat.error')}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </div>
    </BotShell>
  );
}

const CLARIFY_CHIPS: Record<'target_study' | 'product_focus', string[]> = {
  target_study: ['HIMALAYA'],
  product_focus: ['イジュド'],
};

export function BotBubble({
  data,
  isLast,
  disabled,
  showWhy,
  onViewPage,
  onChip,
}: {
  data: RouteResponse;
  isLast: boolean;
  disabled: boolean;
  /** Admins only: the "Why this route?" panel with classifier and retrieval internals. */
  showWhy: boolean;
  onViewPage: (citation: Citation, page: number) => void;
  onChip: (text: string) => void;
}) {
  const { t } = useI18n();
  const family = routeFamily(data.route_id);
  const { header_text, section_text, section_context, template_status, citations } = data.response;
  const citation = citations[0];

  const border = family === 'ae' ? 'border-[#df8f8b]' : family === 'verbatim' ? 'border-[#e2c35c]' : 'border-[#9cc48f]';

  return (
    <BotShell>
      <div className={`rounded-2xl rounded-bl-sm border bg-card px-4 py-3 shadow-sm ${border}`}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="sr-only">{t('chat.bot')}: </span>
          <RouteBadge routeId={data.route_id} />
          <span className="text-[11px] text-muted-foreground">
            {section_text !== null ? t('chat.verbatim') : t('chat.template')}
          </span>
          {template_status === 'FALLBACK' && (
            <span
              className="rounded border border-[#e2c35c] bg-[#fff6d6] px-1.5 py-px text-[10px] font-semibold text-[#6b4b00]"
              title={t('chat.fallbackBadgeTitle')}
            >
              {t('chat.fallbackBadge')}
            </span>
          )}
        </div>

        {data.ae_logged && (
          <div
            className="mb-3 flex items-start gap-2 rounded-md border border-[#df8f8b] bg-[#fdeceb] px-3 py-2 text-[#8a1c17]"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">{t('chat.aeNotice')}</p>
              <p className="text-xs">{t('chat.aeNoticeBody')}</p>
            </div>
          </div>
        )}

        {header_text && <p className="template-text whitespace-pre-wrap text-sm">{header_text}</p>}
        {section_text !== null && (
          <div className="mt-3 rounded-md border bg-background/60 p-3">
            {section_context && citation && (
              <Breadcrumb context={section_context} current={`${citation.section_path} ${citation.title}`} />
            )}
            <SectionText text={section_text} />
            {section_context?.parent_section_id && <ParentSection sectionId={section_context.parent_section_id} />}
          </div>
        )}

        <Citations citations={citations} onView={onViewPage} />

        {isLast && data.pending_clarification && (
          <div className="mt-3" role="group" aria-label={t('chat.clarify')}>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              {data.pending_clarification === 'target_study'
                ? t('chat.clarifyTargetStudy')
                : t('chat.clarifyProductFocus')}
            </p>
            <div className="flex flex-wrap gap-2">
              {CLARIFY_CHIPS[data.pending_clarification].map((chip) => (
                <Button
                  key={chip}
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={disabled}
                  onClick={() => onChip(chip)}
                >
                  {chip}
                </Button>
              ))}
            </div>
          </div>
        )}

        {showWhy && <WhyPanel data={data} />}
      </div>
    </BotShell>
  );
}
