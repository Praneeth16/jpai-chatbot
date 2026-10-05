import { Plus, SendHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button, Textarea } from '@databricks/appkit-ui/react';
import type { Citation, RouteResponse } from '../../../shared/api.ts';
import { BotBubble, ErrorBubble, ThinkingBubble, UserBubble } from '../components/MessageBubble.tsx';
import { PageModal } from '../components/PageModal.tsx';
import type { PageTarget } from '../components/PageModal.tsx';
import { RouteLegend } from '../components/RouteBadge.tsx';
import { useI18n } from '../i18n/index.tsx';
import { newConversationId, postRoute } from '../lib/api.ts';
import { SAMPLES } from '../lib/routes.ts';
import { useIsAdmin } from '../lib/useAdmin.ts';

type ChatMessage =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'bot'; data: RouteResponse }
  | { id: number; kind: 'error'; detail: string; question: string };

const MAX_CHARS = 2000;

export function Chat() {
  const { t, lang } = useI18n();
  const isAdmin = useIsAdmin();
  const [conversationId, setConversationId] = useState(newConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [pageTarget, setPageTarget] = useState<PageTarget | null>(null);
  const nextId = useRef(1);
  const conversationRef = useRef(conversationId);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, busy]);

  const ask = useCallback(
    async (question: string, addUser: boolean) => {
      const convo = conversationRef.current;
      if (addUser) setMessages((m) => [...m, { id: nextId.current++, kind: 'user', text: question }]);
      setBusy(true);
      try {
        const data = await postRoute(convo, question, lang);
        if (conversationRef.current !== convo) return;
        setMessages((m) => [...m, { id: nextId.current++, kind: 'bot', data }]);
      } catch (err) {
        if (conversationRef.current !== convo) return;
        const detail = err instanceof Error ? err.message : String(err);
        setMessages((m) => [...m, { id: nextId.current++, kind: 'error', detail, question }]);
      } finally {
        if (conversationRef.current === convo) setBusy(false);
      }
    },
    [lang]
  );

  const send = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      setDraft('');
      void ask(q, true);
    },
    [ask, busy]
  );

  const retry = (errorId: number, question: string) => {
    setMessages((m) => m.filter((x) => x.id !== errorId));
    void ask(question, false);
  };

  const reset = () => {
    const id = newConversationId();
    conversationRef.current = id;
    setConversationId(id);
    setMessages([]);
    setDraft('');
    setBusy(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  const openPage = (citation: Citation, page: number) => setPageTarget({ citation, page });
  const lastBotId = [...messages].reverse().find((m) => m.kind === 'bot')?.id;
  const lastId = messages.length ? messages[messages.length - 1].id : null;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col" data-conversation-id={conversationId}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <RouteLegend />
        <Button variant="outline" size="sm" onClick={reset}>
          <Plus className="size-4" aria-hidden="true" />
          {t('chat.new')}
        </Button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        role="log"
        aria-live="polite"
        aria-label={t('chat.conversationLog')}
      >
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl space-y-4 py-4">
            <div className="rounded-lg border bg-card p-4">
              <h2 className="text-lg font-semibold">{t('chat.title')}</h2>
              <p className="mt-1 text-muted-foreground">{t('chat.intro')}</p>
            </div>
            <section aria-labelledby="samples-h">
              <h3 id="samples-h" className="text-sm font-semibold">
                {t('chat.samples')}
              </h3>
              <p className="mb-2 text-xs text-muted-foreground">{t('chat.samplesHint')}</p>
              <div className="flex flex-wrap gap-2">
                {SAMPLES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    disabled={busy}
                    onClick={() => send(t(s.key))}
                    className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-left text-sm transition-colors hover:border-primary hover:bg-accent disabled:opacity-50"
                  >
                    <span>{t(s.key)}</span>
                    <span className="rounded bg-secondary px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
                      → {s.route}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => {
              if (m.kind === 'user') return <UserBubble key={m.id} text={m.text} />;
              if (m.kind === 'bot') {
                return (
                  <BotBubble
                    key={m.id}
                    data={m.data}
                    isLast={m.id === lastBotId && m.id === lastId}
                    disabled={busy}
                    showWhy={isAdmin}
                    onViewPage={openPage}
                    onChip={send}
                  />
                );
              }
              return <ErrorBubble key={m.id} detail={m.detail} onRetry={() => retry(m.id, m.question)} />;
            })}
            {busy && <ThinkingBubble />}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="shrink-0 border-t bg-card px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('chat.placeholder')}
            aria-label={t('chat.inputLabel')}
            maxLength={MAX_CHARS}
            rows={2}
            className="max-h-40 min-h-[3.25rem] resize-none bg-background"
          />
          <Button type="submit" disabled={busy || draft.trim() === ''} className="h-[3.25rem] shrink-0 px-4">
            <SendHorizontal className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{busy ? t('chat.sending') : t('chat.send')}</span>
            <span className="sr-only sm:hidden">{t('chat.send')}</span>
          </Button>
        </div>
      </form>

      {pageTarget && (
        <PageModal
          key={`${pageTarget.citation.doc_id}:${pageTarget.page}`}
          target={pageTarget}
          onClose={() => setPageTarget(null)}
        />
      )}
    </div>
  );
}
