import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { connectionsHref } from '@/lib/connections';

export const metadata: Metadata = {
  title: 'Connections',
  description: 'Capture and integration surfaces that feed the timeline.',
};

export default async function IntegrationsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  redirect(connectionsHref(await searchParams));
}
