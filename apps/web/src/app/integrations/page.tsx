import { INTEGRATION_DIRECTORY_DOCUMENT } from '@/components/marketing/integrations/connector-public-documents';
import { IntegrationDirectory } from '@/components/marketing/integrations/integration-directory';
import { metadataForPublicDocument } from '@/lib/public-site';

export const metadata = metadataForPublicDocument(INTEGRATION_DIRECTORY_DOCUMENT);

export default function IntegrationsPage() {
  return <IntegrationDirectory />;
}
