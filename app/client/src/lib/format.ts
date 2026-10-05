import type { Lang } from '../../../shared/api.ts';

export function formatDateTime(iso: string | null, lang: Lang): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
    d
  );
}

export function formatTime(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-GB', { dateStyle: 'short', timeStyle: 'medium' }).format(
    d
  );
}
