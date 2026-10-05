import { Activity, Database, Info, MessageSquare } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import type { Lang } from '../../../shared/api.ts';
import { useI18n } from '../i18n/index.tsx';
import type { I18nKey } from '../i18n/ja.ts';
import { MOCK } from '../lib/api.ts';

const NAV: { to: string; key: I18nKey; icon: typeof Info; end?: boolean }[] = [
  { to: '/', key: 'nav.chat', icon: MessageSquare, end: true },
  { to: '/sources', key: 'nav.sources', icon: Database },
  { to: '/ops', key: 'nav.ops', icon: Activity },
  { to: '/about', key: 'nav.about', icon: Info },
];

const LANGS: Lang[] = ['ja', 'en'];

export function Shell() {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="flex h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2 focus:shadow"
      >
        {t('app.skipToContent')}
      </a>
      <header className="shrink-0 border-b bg-card">
        <div className="h-1 bg-primary" aria-hidden="true" />
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight tracking-tight sm:text-lg">{t('app.title')}</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">{t('app.subtitle')}</p>
          </div>
          <nav
            aria-label={t('nav.label')}
            className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto"
          >
            {NAV.map(({ to, key, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`
                }
              >
                <Icon className="size-4" aria-hidden="true" />
                {t(key)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2" role="group" aria-label={t('lang.label')}>
            {LANGS.map((l) => (
              <button
                key={l}
                type="button"
                lang={l}
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                  lang === l
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-secondary'
                }`}
              >
                {t(l === 'ja' ? 'lang.ja' : 'lang.en')}
              </button>
            ))}
          </div>
        </div>
        <div
          className="border-t border-[#e9d9a0] bg-[#fff6d6] px-4 py-1 text-center text-xs font-medium text-[#6b4b00]"
          role="note"
        >
          {t('app.demoBadge')}
        </div>
        {MOCK && (
          <div className="bg-secondary px-4 py-1 text-center text-xs text-muted-foreground">{t('mock.banner')}</div>
        )}
      </header>
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
