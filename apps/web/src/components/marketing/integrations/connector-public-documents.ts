import type { PublicDocument } from '@/lib/public-site/types';

import {
  CONNECTORS,
  type ConnectorContent,
} from '@/components/marketing/integrations/connector-content';
import { definePublicDocuments } from '@/lib/public-site/registry';

export const INTEGRATION_DIRECTORY_DOCUMENT = {
  canonicalPath: '/integrations',
  kind: 'product',
  title: 'Native integrations',
  description:
    'Explore native Timeline integrations for Slack, GitHub, Linear, Google Drive, Monday.com, and Sentry, with an honest view of records, permissions, and limitations.',
  indexability: 'index',
  dates: { modified: '2026-08-13', reviewed: '2026-08-13' },
  capability: { kind: 'current-product' },
  sitemap: { changeFrequency: 'weekly', priority: 0.9 },
  structuredData: [{ type: 'collection-page' }],
  llms: {
    section: 'integrations',
    order: 0,
    summary:
      'Directory of six native ingestion connectors, with capability tiers, permissions, setup, and honest limits.',
    fullSummary: 'Native integration directory and capability-tier reference.',
    sections: [
      {
        title: 'Native ingestion',
        body: CONNECTORS.map((connector) => connector.name).join(', '),
      },
      {
        title: 'Capability boundary',
        body: 'Native integrations create durable cited events. MCP access provides live tools without passive ingestion, and planned native support cannot be connected yet.',
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
