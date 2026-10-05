import { useI18n } from '../i18n/index.tsx';
import { routeLabelKey } from './routes.ts';

export function useRouteLabel(): (routeId: string) => string {
  const { t } = useI18n();
  return (routeId) => {
    const key = routeLabelKey(routeId);
    return key ? t(key) : t('route.unknown', { id: routeId });
  };
}
