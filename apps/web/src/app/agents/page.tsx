import { AgentsHubPage } from '@/components/marketing/agents/agents-hub';
import { AGENTS_HUB_DOCUMENT } from '@/components/marketing/agents/public-documents';
import { metadataForPublicDocument } from '@/lib/public-site';

export const metadata = metadataForPublicDocument(AGENTS_HUB_DOCUMENT);

export default function AgentsRoutePage() {
  return <AgentsHubPage />;
}
