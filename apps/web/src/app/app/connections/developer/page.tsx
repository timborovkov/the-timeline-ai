import ConnectionsPage, { metadata } from '@/app/app/connections/connections-page-content';

export { metadata };
export const dynamic = 'force-dynamic';

export default function DeveloperConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    error?: string;
    integrationId?: string;
    tab?: string;
  }>;
}) {
  return <ConnectionsPage tab="developer" searchParams={searchParams} />;
}
