export const LOCALES = ['zh', 'en', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = { zh: '中文', en: 'English', ja: '日本語' };
export const HTML_LANG: Record<Locale, string> = { zh: 'zh-CN', en: 'en', ja: 'ja' };
export const localePath = (locale: Locale) => locale === 'zh' ? '/' : `/${locale}`;

/** Only the root and the two published language suffixes are pages. */
export function localeFromSegments(segments: readonly string[] = []): Locale | undefined {
  if (segments.length === 0) return 'zh';
  if (segments.length !== 1) return undefined;
  return segments[0] === 'en' || segments[0] === 'ja' ? segments[0] : undefined;
}

export function localeFromPathname(pathname: string): Locale | undefined {
  if (pathname === '/') return 'zh';
  if (pathname === '/en' || pathname === '/en/') return 'en';
  if (pathname === '/ja' || pathname === '/ja/') return 'ja';
  return undefined;
}
