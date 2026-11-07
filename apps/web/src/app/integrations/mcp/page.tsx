import { McpGuidePage } from '@/components/marketing/integrations/mcp-guide-page';
import { MCP_GUIDE_DOCUMENT } from '@/components/marketing/integrations/mcp-guide-public-documents';
import { metadataForPublicDocument } from '@/lib/public-site';

export const metadata = metadataForPublicDocument(MCP_GUIDE_DOCUMENT);

export default function ConnectMcpToolsPage() {
  return <McpGuidePage />;
}
