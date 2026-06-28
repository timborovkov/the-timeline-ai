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

function cleanSourceParam(value: SearchParamValue): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of cleanParam(value).split(',')) {
    const part = raw.trim();
    if (SEARCH_SOURCES.has(part) && !seen.has(part)) {
      seen.add(part);
      out.push(part);
    }
  }
  return out.join(',');
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParamValue>>;
}) {
  const params = await searchParams;
  return (
    <GlobalSearchPage
      initialQuery={cleanParam(params.q)}
      initialType={cleanParam(params.type)}
      initialSource={cleanSourceParam(params.source)}
      initialFrom={cleanParam(params.from)}
      initialTo={cleanParam(params.to)}
    />
  );
}
