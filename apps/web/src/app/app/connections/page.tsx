import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { connectionsHref } from '@/lib/connections';

export const metadata: Metadata = {
  title: 'Connections',
  description: 'Connect the tools this team already uses.',
};

export default async function ConnectionsIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  redirect(connectionsHref(await searchParams));
}
