/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Lang } from '../../../shared/api.ts';
import { ja } from './ja.ts';
import type { I18nKey } from './ja.ts';
import { en } from './en.ts';

const DICTS: Record<Lang, Record<I18nKey, string>> = { ja, en };
const STORAGE_KEY = 'jpai.lang';

export type TFn = (key: I18nKey, vars?: Record<string, string | number>) => string;

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'ja' || v === 'en') return v;
  } catch {
    // localStorage unavailable: fall through to the default
  }
  return 'ja';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore persistence failures
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = DICTS[lang]['app.title'];
  }, [lang]);

  const value = useMemo<I18nContextValue>(() => {
    const dict = DICTS[lang];
    const t: TFn = (key, vars) => {
      let s: string = dict[key];
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    };
    return { lang, setLang, t };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
