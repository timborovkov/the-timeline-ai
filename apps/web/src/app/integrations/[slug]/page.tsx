import { notFound } from 'next/navigation';

import type { Metadata } from 'next';

import { CONNECTORS, findConnector } from '@/components/marketing/integrations/connector-content';
import { ConnectorPage } from '@/components/marketing/integrations/connector-page';
import { findConnectorPublicDocument } from '@/components/marketing/integrations/connector-public-documents';
import {
  WORKS_WITH_PAGE_TOOLS,
  findWorksWithTool,
} from '@/components/marketing/integrations/works-with-content';
import { WorksWithPage } from '@/components/marketing/integrations/works-with-page';
import { findWorksWithPublicDocument } from '@/components/marketing/integrations/works-with-public-documents';
import { metadataForPublicDocument } from '@/lib/public-site';

interface ConnectorPageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  const native = CONNECTORS.map((connector) => ({ slug: connector.slug }));
  const worksWith = WORKS_WITH_PAGE_TOOLS.map((tool) => ({ slug: tool.slug }));
  return [...native, ...worksWith];
}

export async function generateMetadata({ params }: ConnectorPageProps): Promise<Metadata> {
  const { slug } = await params;
  const connector = findConnector(slug);
  if (connector) return metadataForPublicDocument(findConnectorPublicDocument(connector));

  const tool = findWorksWithTool(slug);
  if (tool && !tool.nativeConnector) {
    return metadataForPublicDocument(findWorksWithPublicDocument(tool));
  }

  return {};
}

export default async function IntegrationSlugPage({ params }: ConnectorPageProps) {
  const { slug } = await params;
  const connector = findConnector(slug);
  if (connector) return <ConnectorPage connector={connector} />;

  const tool = findWorksWithTool(slug);
  if (tool && !tool.nativeConnector) return <WorksWithPage tool={tool} />;

  notFound();
}
