import { RefreshCw } from 'lucide-react';
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@databricks/appkit-ui/react';
import { ErrorBlock, LoadingBlock, PageFrame } from '../components/PageFrame.tsx';
import { RouteBadge } from '../components/RouteBadge.tsx';
import { useI18n } from '../i18n/index.tsx';
import { getOps } from '../lib/api.ts';
import { formatTime } from '../lib/format.ts';
import { FAMILY_STYLES, routeFamily } from '../lib/routes.ts';
import { useAsync } from '../lib/useAsync.ts';
import { useRouteLabel } from '../lib/useRouteLabel.ts';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function Ops() {
  const { t, lang } = useI18n();
  const routeLabel = useRouteLabel();
  const { state, reload } = useAsync(getOps);

  return (
    <PageFrame
      title={t('ops.title')}
      intro={t('ops.intro')}
      actions={
        <Button variant="outline" size="sm" onClick={reload} disabled={state.status === 'loading'}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t('common.refresh')}
        </Button>
      }
    >
      {state.status === 'loading' && <LoadingBlock />}
      {state.status === 'error' && <ErrorBlock error={state.error} onRetry={reload} />}
      {state.status === 'ok' &&
        (() => {
          const ops = state.data;
          const max = Math.max(1, ...ops.route_counts.map((r) => r.count));
          const routes = [...ops.route_counts].sort((a, b) => b.count - a.count);
          const recent = ops.recent_turns.slice(0, 20);
          return (
            <>
              <p className="text-xs text-muted-foreground">{t('ops.window', { n: ops.window_days })}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Stat label={t('ops.totalTurns')} value={String(ops.total_turns)} />
                <Stat
                  label={t('ops.avgLatency')}
                  value={ops.avg_latency_ms === null ? '—' : t('ops.ms', { n: Math.round(ops.avg_latency_ms) })}
                />
                <Stat label={t('ops.aeQueue')} value={String(ops.ae_queue.reduce((n, q) => n + q.count, 0))} />
              </div>

              <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
                <section className="rounded-lg border bg-card p-4" aria-labelledby="mix-h">
                  <h3 id="mix-h" className="mb-3 font-semibold">
                    {t('ops.routeMix')}
                  </h3>
                  {routes.length === 0 ? (
                    <p className="text-muted-foreground">{t('common.empty')}</p>
                  ) : (
                    <ul className="space-y-2">
                      {routes.map((r) => (
                        <li
                          key={r.route_id}
                          className="grid grid-cols-[minmax(8rem,34%)_1fr_3.5rem] items-center gap-2 text-xs"
                        >
                          <span className="truncate" title={routeLabel(r.route_id)}>
                            {routeLabel(r.route_id)}
                          </span>
                          <div
                            className="h-3 rounded-full bg-secondary"
                            role="img"
                            aria-label={`${routeLabel(r.route_id)}: ${t('ops.turns', { n: r.count })}`}
                          >
                            <div
                              className={`h-full rounded-full border ${FAMILY_STYLES[routeFamily(r.route_id)]}`}
                              style={{ width: `${(r.count / max) * 100}%` }}
                            />
                          </div>
                          <span className="text-right tabular-nums">{r.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-lg border bg-card p-4" aria-labelledby="ae-h">
                  <h3 id="ae-h" className="mb-3 font-semibold">
                    {t('ops.aeQueue')}
                  </h3>
                  {ops.ae_queue.length === 0 ? (
                    <p className="text-muted-foreground">{t('ops.aeEmpty')}</p>
                  ) : (
                    <ul className="divide-y">
                      {ops.ae_queue.map((q) => (
                        <li key={q.status} className="flex items-center justify-between py-2">
                          <span className="rounded-full border border-[#df8f8b] bg-[#f9d6d4] px-2.5 py-0.5 text-xs font-semibold text-[#8a1c17]">
                            {q.status}
                          </span>
                          <span className="text-lg font-semibold tabular-nums">{q.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="recent-h">
                <h3 id="recent-h" className="border-b p-4 font-semibold">
                  {t('ops.recent')}
                </h3>
                {!ops.is_admin ? (
                  <p className="p-6 text-center text-muted-foreground">{t('ops.countsOnly')}</p>
                ) : recent.length === 0 ? (
                  <p className="p-6 text-center text-muted-foreground">{t('common.empty')}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('ops.time')}</TableHead>
                        <TableHead>{t('ops.message')}</TableHead>
                        <TableHead>{t('ops.route')}</TableHead>
                        <TableHead>{t('ops.template')}</TableHead>
                        <TableHead className="text-right">{t('ops.latency')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recent.map((turn) => (
                        <TableRow key={turn.turn_id}>
                          <TableCell className="whitespace-nowrap text-xs">
                            {formatTime(turn.created_at, lang)}
                          </TableCell>
                          <TableCell className="max-w-xs truncate" title={turn.message}>
                            {turn.message}
                          </TableCell>
                          <TableCell>
                            <RouteBadge routeId={turn.route_id} />
                          </TableCell>
                          <TableCell className="text-xs">{turn.template_id ?? '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            {turn.latency_ms === null ? '—' : t('ops.ms', { n: turn.latency_ms })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </section>
            </>
          );
        })()}
    </PageFrame>
  );
}
