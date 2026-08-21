import type { PublicDocument } from '@/lib/public-site/types';

import { CAPTURE_SURFACES } from '@/components/marketing/integrations/capture-surface-content';
import {
  CONNECTORS,
  type ConnectorContent,
} from '@/components/marketing/integrations/connector-content';
import { definePublicDocuments } from '@/lib/public-site/registry';

export const INTEGRATION_DIRECTORY_DOCUMENT = {
  canonicalPath: '/integrations',
  kind: 'product',
  title: 'Integrations and capture surfaces',
  description:
    'Explore Telegram, Slack, email, meeting, and webhook capture alongside native Timeline record sync for GitHub, Linear, Google Drive, Monday.com, Slack, and Sentry.',
  indexability: 'index',
  dates: { modified: '2026-08-15', reviewed: '2026-08-15' },
  capability: { kind: 'current-product' },
  sitemap: { changeFrequency: 'weekly', priority: 0.9 },
  structuredData: [{ type: 'collection-page' }],
  llms: {
    section: 'integrations',
    order: 0,
    summary:
      'Directory of first-party capture surfaces and six native provider-record connectors, with capability tiers, setup, and honest limits.',
    fullSummary: 'Integration, capture-surface, and capability-tier reference.',
    sections: [
      {
        title: 'First-party capture',
        body: CAPTURE_SURFACES.map((surface) => surface.name).join(', '),
      },
      {
        title: 'Provider record sync',
        body: CONNECTORS.map((connector) => connector.name).join(', '),
      },
      {
        title: 'Capability boundary',
        body: 'First-party capture accepts deliberately routed conversations and payloads. Native integrations sync selected provider records into durable cited events. Hosted MCP access provides live tools without passive ingestion. Figma desktop MCP requires Timeline on the same machine and is not connectable from hosted Timeline. Planned native support cannot be connected yet.',
      },
    ],
  },
} satisfies PublicDocument;

const connectorDocuments = CONNECTORS.map(
  (connector, index): PublicDocument => ({
    canonicalPath: `/integrations/${connector.slug}`,
    kind: 'connector',
    title: connector.seoTitle,
    description: connector.seoDescription,
    indexability: 'index',
    dates: { modified: connector.lastReviewed, reviewed: connector.lastReviewed },
    capability: { kind: 'native-ingestion', provider: connector.slug },
    sitemap: { changeFrequency: 'monthly', priority: 0.8 },
    structuredData: [
      { type: 'web-page' },
      {
        type: 'breadcrumbs',
        items: [
          { name: 'Integrations', path: '/integrations' },
          { name: connector.name, path: `/integrations/${connector.slug}` },
        ],
      },
      { type: 'faq', entries: connector.faqs },
      {
        type: 'software-application',
        name: 'The Timeline',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        features: connector.capturedRecords,
      },
    ],
    llms: {
      section: 'integrations',
      order: (index + 1) * 10,
      label: `${connector.name} integration`,
      summary: connector.seoDescription,
      fullSummary: connector.intro,
      sections: [
        {
          title: 'Capability truth',
          body: `${connector.captureStatement} ${connector.providerStatement}`,
        },
        {
          title: 'Captured records',
          body: `Timeline captures the following ${connector.name} evidence:`,
          items: connector.capturedRecords,
        },
        {
          title: 'Setup and permissions',
          body: connector.setup.join(' '),
          items: connector.permissions,
        },
        {
          title: 'Limitations',
          body: `Current ${connector.name} ingestion boundaries:`,
          items: connector.limitations,
        },
      ],
    },
  }),
);

export const CONNECTOR_PUBLIC_DOCUMENTS = definePublicDocuments('native-connectors', [
  INTEGRATION_DIRECTORY_DOCUMENT,
  ...connectorDocuments,
]);

export function findConnectorPublicDocument(
  connector: Pick<ConnectorContent, 'slug'>,
): PublicDocument {
  const document = CONNECTOR_PUBLIC_DOCUMENTS.documents.find(
    (candidate) => candidate.canonicalPath === `/integrations/${connector.slug}`,
  );
  if (!document) throw new Error(`Missing public document for connector ${connector.slug}`);
  return document;
}
