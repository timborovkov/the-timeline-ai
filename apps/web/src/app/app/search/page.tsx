import type { Metadata } from 'next';

import { GlobalSearchPage } from '@/components/global-search-page';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search pages, work, timeline events, calendar, boards, and documents.',
};

const SEARCH_SOURCES = new Set([
  'web',
  'telegram',
  'slack',
  'email',
  'document',
  'meeting',
  'integration',
  'calendar',
  'system',
]);

function cleanParam(value: string | undefined): string {
  return value?.trim() ?? '';
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; source?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const source = cleanParam(params.source);
  return (
    <GlobalSearchPage
      initialQuery={cleanParam(params.q)}
      initialSource={SEARCH_SOURCES.has(source) ? source : ''}
      initialFrom={cleanParam(params.from)}
      initialTo={cleanParam(params.to)}
    />
  );
}
