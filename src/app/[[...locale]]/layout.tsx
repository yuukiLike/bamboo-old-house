import type { Metadata } from 'next';
import { HTML_LANG, localeFromSegments, localePath } from '@/content/locale';
import { getContent } from '@/content';
import '../globals.css';

type Props = { children: React.ReactNode; params: Promise<{ locale?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = localeFromSegments((await params).locale) ?? 'en';
  return {
    ...getContent(locale).meta,
    icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } },
    alternates: { languages: { 'zh-CN': localePath('zh'), en: localePath('en'), ja: localePath('ja'), 'x-default': localePath('en') } },
  };
}

export default async function RootLayout({ children, params }: Props) {
  const locale = localeFromSegments((await params).locale) ?? 'en';
  return <html lang={HTML_LANG[locale]}><body>{children}</body></html>;
}
