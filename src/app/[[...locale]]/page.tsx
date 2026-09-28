import { notFound } from 'next/navigation';
import Experience from '@/components/experience';
import { localeFromSegments } from '@/content/locale';

export const dynamicParams = false;
export function generateStaticParams() {
  return [{ locale: [] }, { locale: ['cn'] }, { locale: ['en'] }, { locale: ['ja'] }];
}

export default async function Home({ params }: { params: Promise<{ locale?: string[] }> }) {
  const locale = localeFromSegments((await params).locale);
  if (!locale) notFound();
  return <Experience initialLocale={locale} />;
}
