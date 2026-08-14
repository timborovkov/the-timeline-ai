import { INTEGRATION_DIRECTORY_DOCUMENT } from '@/components/marketing/integrations/connector-public-documents';
import { IntegrationDirectory } from '@/components/marketing/integrations/integration-directory';
import { auth } from '@/lib/auth';
import { metadataForPublicDocument } from '@/lib/public-site';

export const metadata = metadataForPublicDocument(INTEGRATION_DIRECTORY_DOCUMENT);

export default async function IntegrationsPage() {
  const session = await auth();
  return <IntegrationDirectory isSignedIn={Boolean(session?.user)} />;
}
