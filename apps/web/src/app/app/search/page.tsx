import type { Metadata } from 'next';

import { GlobalSearchPage } from '@/components/global-search-page';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search pages, work, timeline events, calendar, boards, and documents.',
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  return <GlobalSearchPage initialQuery={params.q?.trim() ?? ''} />;
}
