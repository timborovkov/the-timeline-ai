import { notFound } from 'next/navigation';

import type { Metadata } from 'next';

import { DATASETS } from '@/app/dev/break-ui/fixtures';
import { MembersStressPreview } from '@/app/dev/break-ui/preview';
import { getSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: 'Team members stress test',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function BreakUiPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string }>;
}) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { data } = await searchParams;
  const dataset = DATASETS.find((value) => value === data) ?? 'demo';
  return <MembersStressPreview siteUrl={getSiteUrl()} initialDataset={dataset} />;
}
