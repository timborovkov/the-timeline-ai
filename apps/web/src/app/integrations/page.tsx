import type { Metadata } from 'next';

import { IntegrationDirectory } from '@/components/marketing/integrations/integration-directory';
import { auth } from '@/lib/auth';
import { publicMetadata } from '@/lib/public-metadata';

export const metadata: Metadata = publicMetadata({
  title: 'Native integrations | The Timeline',
  description:
    'Explore native Timeline integrations for Slack, GitHub, Linear, Google Drive, Monday.com, and Sentry, with an honest view of records, permissions, and limitations.',
  path: '/integrations',
  robots: { index: true, follow: true },
});

export default async function IntegrationsPage() {
  const session = await auth();
  return <IntegrationDirectory isSignedIn={Boolean(session?.user)} />;
}
