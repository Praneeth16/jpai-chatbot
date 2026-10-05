import type { I18nKey } from '../i18n/ja.ts';

export type RouteFamily = 'template' | 'verbatim' | 'ae';

const VERBATIM = new Set(['4.1', '4.2', '5.1']);

export function routeFamily(routeId: string): RouteFamily {
  if (routeId === '1') return 'ae';
  if (VERBATIM.has(routeId)) return 'verbatim';
  return 'template';
}

/** Routes that run an AI Search query (teal "search" chip in the flowchart). */
export function routeUsesSearch(routeId: string): boolean {
  return VERBATIM.has(routeId);
}

const KNOWN = new Set([
  '0a',
  '0b',
  '0c_greeting',
  '0c_closing',
  '0c_about',
  '1',
  '2',
  '3.1',
  '3.2',
  '4.1',
  '4.2',
  '5.1',
  '5.2',
  '6.1',
  '6.2',
  '7.1',
  '8.1',
  '8.2',
]);

export function routeLabelKey(routeId: string): I18nKey | null {
  return KNOWN.has(routeId) ? (`route.${routeId}` as I18nKey) : null;
}

/** Tailwind classes per family, matching the flowchart legend (green template, yellow verbatim, red AE, teal search). */
export const FAMILY_STYLES: Record<RouteFamily | 'search', string> = {
  template: 'bg-[#e3f1df] text-[#1f5a2a] border-[#9cc48f]',
  verbatim: 'bg-[#fff1c9] text-[#6b4b00] border-[#e2c35c]',
  ae: 'bg-[#f9d6d4] text-[#8a1c17] border-[#df8f8b]',
  search: 'bg-[#1aa0ab] text-white border-[#13808a]',
};

export const FAMILY_KEYS: Record<RouteFamily | 'search', I18nKey> = {
  template: 'family.template',
  verbatim: 'family.verbatim',
  ae: 'family.ae',
  search: 'family.search',
};

/** Sample questions: text keys live in i18n, the expected route is a language-independent hint. */
export const SAMPLES: { key: I18nKey; route: string }[] = [
  { key: 'sample.1', route: '4.1' },
  { key: 'sample.4', route: '4.2' },
  { key: 'sample.2', route: '5.1' },
  { key: 'sample.3', route: '5.2' },
  { key: 'sample.5', route: '0c' },
  { key: 'sample.13', route: '0c' },
  { key: 'sample.14', route: '0c' },
  { key: 'sample.6', route: '1' },
  { key: 'sample.7', route: '0b' },
  { key: 'sample.12', route: '0a' },
  { key: 'sample.15', route: '2' },
  { key: 'sample.9', route: '3.1' },
  { key: 'sample.10', route: '3.2' },
  { key: 'sample.16', route: '6.1' },
  { key: 'sample.11', route: '6.2' },
  { key: 'sample.17', route: '7.1' },
  { key: 'sample.8', route: '8.1' },
];
