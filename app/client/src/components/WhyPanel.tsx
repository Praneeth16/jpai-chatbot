import { CheckCircle2, ChevronRight, Circle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RouteResponse } from '../../../shared/api.ts';
import { useI18n } from '../i18n/index.tsx';
import { ProbBar } from './ProbBar.tsx';

// Reference thresholds from docs/CONTRACTS.md section 6 (display only; the server decides).
const TAU_AE = 0.35;
const TAU_INJ = 0.6;
const TAU_REQ = 0.3;
const TAU_INTENT = 0.55;
const TAU_COND = 0.5;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 text-xs sm:grid-cols-[8rem_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h5 className="text-xs font-semibold">{title}</h5>
      {children}
    </section>
  );
}

export function WhyPanel({ data }: { data: RouteResponse }) {
  const { t } = useI18n();
  const c = data.classification;
  const r = data.retrieval;

  const thresholds: { label: string; value: number | null; crossed: boolean }[] = [];
  if (c) {
    thresholds.push(
      { label: t('why.thAe'), value: c.adverse_event, crossed: c.adverse_event >= TAU_AE },
      { label: t('why.thInj'), value: c.injection, crossed: c.injection >= TAU_INJ },
      { label: t('why.thReq'), value: c.has_request, crossed: c.has_request < TAU_REQ },
      { label: t('why.thIntent'), value: c.intent.confidence, crossed: c.intent.confidence >= TAU_INTENT },
      { label: t('why.thCond'), value: c.has_conditions, crossed: c.has_conditions >= TAU_COND }
    );
  }
  if (r) {
    thresholds.push({ label: t('why.thRet'), value: r.top_score, crossed: data.route_id !== '2' });
  }

  const top3 = c
    ? Object.entries(c.intent.probabilities)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
    : [];
  const filters = r ? Object.entries(r.filters).filter(([, v]) => v !== undefined && v !== null) : [];

  return (
    <details className="group mt-3 rounded-md border bg-card text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary/60 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
        {t('why.toggle')}
      </summary>
      <div className="space-y-4 border-t px-3 py-3">
        {c ? (
          <>
            <Section title={t('why.classifier')}>
              <div className="space-y-1.5">
                <ProbBar label={t('why.ae')} value={c.adverse_event} threshold={TAU_AE} />
                <ProbBar label={t('why.injection')} value={c.injection} threshold={TAU_INJ} />
                <ProbBar label={t('why.hasRequest')} value={c.has_request} threshold={TAU_REQ} />
                <ProbBar label={t('why.hasConditions')} value={c.has_conditions} threshold={TAU_COND} />
              </div>
            </Section>
            <Section title={t('why.intent')}>
              <dl className="space-y-1">
                <Row label={t('why.intentChoice')}>
                  <code className="rounded bg-secondary px-1.5 py-0.5">{c.intent.choice}</code> · {t('why.confidence')}{' '}
                  {c.intent.confidence.toFixed(2)}
                </Row>
                <Row label={t('why.smalltalk')}>
                  <code className="rounded bg-secondary px-1.5 py-0.5">{c.smalltalk.choice}</code> (
                  {c.smalltalk.confidence.toFixed(2)})
                </Row>
              </dl>
              <div className="space-y-1.5 pt-1" aria-label={t('why.top3')}>
                {top3.map(([name, p]) => (
                  <ProbBar key={name} label={name} value={p} />
                ))}
              </div>
            </Section>
            <Section title={t('why.master')}>
              <dl className="space-y-1">
                <Row label={t('why.product')}>{c.product_code ?? t('common.none')}</Row>
                <Row label={t('why.study')}>{c.study_ids.length ? c.study_ids.join(', ') : t('common.none')}</Row>
                {c.model && <Row label={t('why.model')}>{c.model}</Row>}
              </dl>
              {c.degraded && <p className="text-xs text-destructive">{t('chat.degraded')}</p>}
            </Section>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{t('why.noClassification')}</p>
        )}

        <Section title={t('why.retrieval')}>
          {r ? (
            <dl className="space-y-1">
              <Row label={t('why.topScore')}>{r.top_score === null ? '—' : r.top_score.toFixed(3)}</Row>
              <Row label={t('why.query')}>{r.query}</Row>
              <Row label={t('why.filters')}>
                {filters.length ? (
                  <span className="flex flex-wrap gap-1">
                    {filters.map(([k, v]) => (
                      <code key={k} className="rounded bg-secondary px-1.5 py-0.5">
                        {k}={String(v)}
                      </code>
                    ))}
                  </span>
                ) : (
                  t('common.none')
                )}
              </Row>
              <Row label={t('why.hits')}>
                <ul className="space-y-0.5">
                  {r.hits.slice(0, 3).map((h) => (
                    <li key={h.section_id} className="flex justify-between gap-2">
                      <span className="truncate">{h.section_id}</span>
                      <span className="tabular-nums">{h.score.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </Row>
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">{t('why.noRetrieval')}</p>
          )}
        </Section>

        {thresholds.length > 0 && (
          <Section title={t('why.thresholds')}>
            <ul className="space-y-1">
              {thresholds.map((th) => (
                <li key={th.label} className="flex items-center gap-2 text-xs">
                  {th.crossed ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  ) : (
                    <Circle className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
                  )}
                  <span className={th.crossed ? 'font-medium' : 'text-muted-foreground'}>{th.label}</span>
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {th.value === null ? '—' : th.value.toFixed(2)} ·{' '}
                    {th.crossed ? t('why.thresholdCrossed') : t('why.thresholdBelow')}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <dl className="space-y-1 border-t pt-3">
          {data.merged_message && <Row label={t('why.merged')}>{data.merged_message}</Row>}
          <Row label={t('why.latency')}>{t('ops.ms', { n: data.latency_ms })}</Row>
          <Row label={t('why.trace')}>
            <code className="text-[11px]">{data.trace_id ?? '—'}</code>
          </Row>
          <Row label={t('why.turn')}>
            <code className="text-[11px]">{data.turn_id}</code>
          </Row>
        </dl>
      </div>
    </details>
  );
}
