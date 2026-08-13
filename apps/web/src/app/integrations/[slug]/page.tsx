import { notFound } from 'next/navigation';

import type { Metadata } from 'next';

import { CONNECTORS, findConnector } from '@/components/marketing/integrations/connector-content';
import { ConnectorPage } from '@/components/marketing/integrations/connector-page';
import { findConnectorPublicDocument } from '@/components/marketing/integrations/connector-public-documents';
import { auth } from '@/lib/auth';
import { metadataForPublicDocument } from '@/lib/public-site';

interface ConnectorPageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return CONNECTORS.map((connector) => ({ slug: connector.slug }));
}

export async function generateMetadata({ params }: ConnectorPageProps): Promise<Metadata> {
  const { slug } = await params;
  const connector = findConnector(slug);
  if (!connector) return {};

  return metadataForPublicDocument(findConnectorPublicDocument(connector));
}

export default async function NativeConnectorPage({ params }: ConnectorPageProps) {
  const { slug } = await params;
  const connector = findConnector(slug);
  if (!connector) notFound();

  const session = await auth();
  return <ConnectorPage connector={connector} isSignedIn={Boolean(session?.user)} />;
}
