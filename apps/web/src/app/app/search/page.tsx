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

type SearchParamValue = string | string[] | undefined;

function cleanParam(value: SearchParamValue): string {
  const scalar = Array.isArray(value) ? value[0] : value;
  return scalar?.trim() ?? '';
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParamValue>>;
}) {
  const params = await searchParams;
  const source = cleanParam(params.source);
  return (
    <GlobalSearchPage
      initialQuery={cleanParam(params.q)}
      initialType={cleanParam(params.type)}
      initialSource={SEARCH_SOURCES.has(source) ? source : ''}
      initialFrom={cleanParam(params.from)}
      initialTo={cleanParam(params.to)}
    />
  );
}
