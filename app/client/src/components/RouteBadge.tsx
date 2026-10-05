import { Search } from 'lucide-react';
import { useI18n } from '../i18n/index.tsx';
import { FAMILY_STYLES, routeFamily, routeUsesSearch } from '../lib/routes.ts';
import { useRouteLabel } from '../lib/useRouteLabel.ts';

export function RouteBadge({ routeId }: { routeId: string }) {
  const { t } = useI18n();
  const label = useRouteLabel()(routeId);
  const family = routeFamily(routeId);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${FAMILY_STYLES[family]}`}
        data-route={routeId}
      >
        {label}
      </span>
      {routeUsesSearch(routeId) && (
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${FAMILY_STYLES.search}`}
        >
          <Search className="size-3" aria-hidden="true" />
          {t('family.search')}
        </span>
      )}
    </span>
  );
}

export function RouteLegend() {
  const { t } = useI18n();
  const items = [
    ['template', 'family.template'],
    ['verbatim', 'family.verbatim'],
    ['ae', 'family.ae'],
    ['search', 'family.search'],
  ] as const;
  return (
    <ul
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
      aria-label={t('family.legend')}
    >
      {items.map(([family, key]) => (
        <li key={family} className="inline-flex items-center gap-1.5">
          <span className={`inline-block size-3 rounded-sm border ${FAMILY_STYLES[family]}`} aria-hidden="true" />
          {t(key)}
        </li>
      ))}
    </ul>
  );
}
