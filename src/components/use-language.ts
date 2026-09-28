'use client';
import { useEffect, useState } from 'react';
import { getContent } from '@/content';
import { HTML_LANG, localeFromPathname, localePath, type Locale } from '@/content/locale';

/** Language changes update copy in place: the WebGL scene and audio stay alive. */
export function useLanguage(initialLocale: Locale) {
  const [locale, setLocale] = useState(initialLocale);
  useEffect(() => {
    const onPopState = () => {
      const next = localeFromPathname(location.pathname);
      if (next) setLocale(next);
    };
    onPopState();
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    const { meta } = getContent(locale);
    document.documentElement.lang = HTML_LANG[locale];
    document.title = meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description);
  }, [locale]);

  const changeLanguage = (next: Locale) => {
    if (next === locale) return;
    // Keep the framework's history state, diagnostics query, and scene anchor.
    history.replaceState(history.state, '', `${localePath(next)}${location.search}${location.hash}`);
    setLocale(next);
  };
  return { locale, changeLanguage, t: getContent(locale) };
}
