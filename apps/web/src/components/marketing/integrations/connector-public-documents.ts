import type { PublicDocument } from '@/lib/public-site/types';

import { CAPTURE_SURFACES } from '@/components/marketing/integrations/capture-surface-content';
import {
  CONNECTORS,
  type ConnectorContent,
} from '@/components/marketing/integrations/connector-content';
import { TELEGRAM_PAGE } from '@/components/marketing/integrations/telegram-content';
import { findWorksWithTool } from '@/components/marketing/integrations/works-with-content';
import { definePublicDocuments } from '@/lib/public-site/registry';

export const INTEGRATION_DIRECTORY_REVIEW_DATE = '2026-11-12' as const;

export const INTEGRATION_DIRECTORY_DOCUMENT = {
  canonicalPath: '/integrations',
  kind: 'product',
  title: 'Integrations and capture surfaces',
  description:
    'Connect selected sources to build your work record. Capture messages, files and tool activity with native integrations, or connect MCP for live tool access.',
  indexability: 'index',
  dates: {
    modified: INTEGRATION_DIRECTORY_REVIEW_DATE,
    reviewed: INTEGRATION_DIRECTORY_REVIEW_DATE,
  },
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
        body: 'First-party capture accepts deliberately routed conversations and payloads. Native integrations sync selected provider records into durable cited events. Hosted MCP access provides live tools without passive ingestion; see /integrations/mcp. Figma desktop MCP requires Timeline on the same machine and is not connectable from hosted Timeline. Planned native support cannot be connected yet.',
      },
    ],
  },
} satisfies PublicDocument;

const connectorDocuments = CONNECTORS.map((connector, index): PublicDocument => ({
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
      ...worksWithLlmsSections(connector.slug),
    ],
  },
}));

export const TELEGRAM_PUBLIC_DOCUMENT = {
  canonicalPath: TELEGRAM_PAGE.route,
  kind: 'product',
  title: TELEGRAM_PAGE.seoTitle,
  description: TELEGRAM_PAGE.seoDescription,
  indexability: 'index',
  dates: { modified: '2026-11-12', reviewed: '2026-11-12' },
  capability: { kind: 'current-product' },
  sitemap: { changeFrequency: 'monthly', priority: 0.8 },
  structuredData: [
    { type: 'web-page' },
    {
      type: 'breadcrumbs',
      items: [
        { name: 'Integrations', path: '/integrations' },
        { name: 'Telegram', path: TELEGRAM_PAGE.route },
      ],
    },
  ],
  llms: {
    section: 'integrations',
    order: 5,
    label: 'Telegram integration',
    summary: TELEGRAM_PAGE.seoDescription,
    fullSummary: TELEGRAM_PAGE.summary,
    sections: [
      { title: 'What it captures', body: TELEGRAM_PAGE.captured },
      { title: 'What to know', body: TELEGRAM_PAGE.boundary },
      { title: 'Daily update', body: TELEGRAM_PAGE.dailyUpdate },
    ],
  },
} as const satisfies PublicDocument;

export const WEBSITES_PUBLIC_DOCUMENT = {
  canonicalPath: '/integrations/websites',
  kind: 'product',
  title: 'Website sources',
  description:
    'Capture public website pages as cited evidence, preserve version history, and refresh them manually or on a schedule.',
  structuredData: [],
  indexability: 'index',
  dates: { modified: '2026-11-12', reviewed: '2026-11-12' },
  capability: { kind: 'current-product' },
  sitemap: { changeFrequency: 'monthly', priority: 0.7 },
  llms: {
    section: 'integrations',
    order: 6,
    summary:
      'Public website capture: five pages per scan, 20 source units per page; immutable snapshots and current-version answers.',
    sections: [
      {
        title: 'Capture and refresh',
        body: 'Add your own or another company’s public website in Sources. Members can scan; admins manage daily or weekly schedules and removal. Schedules require service activation. Historical citations remain available. Firecrawl fetches public pages; login-protected pages are not supported.',
      },
      {
        title: 'Usage',
        body: 'Twenty accepted-source units per successfully captured page, including unchanged pages. AI and storage are separate. Removing the source stops future scans and retains history; see Privacy for deletion.',
      },
    ],
  },
} as const satisfies PublicDocument;

export const CONNECTOR_PUBLIC_DOCUMENTS = definePublicDocuments('native-connectors', [
  INTEGRATION_DIRECTORY_DOCUMENT,
  TELEGRAM_PUBLIC_DOCUMENT,
  WEBSITES_PUBLIC_DOCUMENT,
  ...connectorDocuments,
]);

function worksWithLlmsSections(slug: string) {
  const tool = findWorksWithTool(slug);
  if (!tool) return [];
  return [
    { title: 'Just getting started', body: tool.gettingStarted },
    { title: `When ${tool.name} alone is the better pick`, body: tool.whenAloneBetter },
  ];
}

export function findConnectorPublicDocument(
  connector: Pick<ConnectorContent, 'slug'>,
): PublicDocument {
  const document = CONNECTOR_PUBLIC_DOCUMENTS.documents.find(
    (candidate) => candidate.canonicalPath === `/integrations/${connector.slug}`,
  );
  if (!document) throw new Error(`Missing public document for connector ${connector.slug}`);
  return document;
}
