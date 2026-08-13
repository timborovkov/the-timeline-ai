import type { PublicDocument } from '@/lib/public-site/types';

import { HELP_PAGES } from '@/lib/help-content';
import { createPublicDocumentRegistry, definePublicDocuments } from '@/lib/public-site/registry';

const LAST_REVIEWED = '2026-08-12' as const;

const LANDING_SECTIONS = [
  {
    title: 'What The Timeline does',
    body: 'Teams capture voice notes, chat messages, emails, meetings, calendar events, documents, and integration activity. The agent extracts durable events, facts, objects, tasks, and relationships, then answers questions with citations back to source material.',
  },
  {
    title: 'Best-fit teams',
    body: 'The product is built for small to mid-sized knowledge-work teams where context compounds: founding teams, sales teams, consulting teams, product teams, and operators who need a reliable record of what happened.',
  },
  {
    title: 'Core differentiator',
    body: 'Capture is unstructured, but output is structured. Users do not need to keep a CRM, wiki, project tracker, and document index manually synchronized; the timeline compiles the operational archive from everyday work.',
  },
  {
    title: 'Trust model',
    body: 'Raw events are immutable source evidence. Agent answers surface citation chips that point back to raw messages, voice memos, emails, transcripts, calendar events, or document versions.',
  },
  {
    title: 'Privacy model',
    body: 'Data is scoped by team and then filtered by per-event visibility. Events can be private, team-visible, or restricted to specific users. Team admins do not receive a general bypass for private context.',
  },
  {
    title: 'Main capture surfaces',
    body: 'Native surfaces include the web app, Telegram, Slack, inbound email, calendar, document uploads, meeting transcripts for Google Meet, Microsoft Teams, and Zoom, and first-party integrations for GitHub, Linear, Google Drive, Monday.com, Slack workspace history, and Sentry. Native integrations create durable cited events; custom MCP servers cover long-tail live tool access without passive timeline ingestion by default.',
  },
] as const;

const coreDocuments = definePublicDocuments('public-core', [
  {
    canonicalPath: '/',
    kind: 'landing',
    title: 'The Timeline | The work becomes the record',
    description:
      'The Timeline turns work from Slack, meetings, code, and documents into a chronological project record and cited answers.',
    indexability: 'index',
    dates: { modified: '2026-08-13', reviewed: '2026-08-13' },
    capability: { kind: 'current-product' },
    sitemap: { changeFrequency: 'weekly', priority: 1 },
    structuredData: [
      { type: 'web-page' },
      {
        type: 'software-application',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        features: [
          'Chronological project history from captured work',
          'Cited answers linked to immutable source events',
          'Native ingestion for GitHub, Linear, Google Drive, Monday.com, Slack, and Sentry',
          'Meeting transcript, document, message, and email capture',
          'Team-scoped storage with per-event visibility',
        ],
      },
    ],
    llms: {
      section: 'primary',
      order: 10,
      label: 'Landing page',
      summary:
        'Editorial product overview, cited evidence narrative, capture surfaces, and trust model.',
      fullSummary: 'Product overview and cited evidence narrative.',
      sections: LANDING_SECTIONS,
    },
  },
  {
    canonicalPath: '/help',
    kind: 'guide-index',
    title: 'Help',
    description: 'Public help docs for The Timeline.',
    indexability: 'index',
    dates: { modified: '2026-08-05', reviewed: LAST_REVIEWED },
    capability: { kind: 'current-product' },
    sitemap: { changeFrequency: 'weekly', priority: 0.8 },
    structuredData: [{ type: 'collection-page' }],
    llms: {
      section: 'primary',
      order: 20,
      label: 'Help center',
      summary: 'Public product guides for users and evaluators.',
      fullSummary: 'Public user guides.',
    },
  },
] satisfies readonly PublicDocument[]);

const helpDocuments = definePublicDocuments(
  'help-guides',
  HELP_PAGES.map(
    (page, index): PublicDocument => ({
      canonicalPath: `/help/${page.slug}`,
      kind: 'guide',
      title: page.title,
      description: page.description,
      indexability: 'index',
      dates: { modified: '2026-08-05', reviewed: LAST_REVIEWED },
      capability: { kind: 'current-product' },
      sitemap: { changeFrequency: 'monthly', priority: 0.7 },
      structuredData: [
        { type: 'tech-article' },
        {
          type: 'breadcrumbs',
          items: [
            { name: 'Help', path: '/help' },
            { name: page.title, path: `/help/${page.slug}` },
          ],
        },
      ],
      llms: {
        section: 'product-guides',
        order: index,
        summary: page.description,
        sections: page.sections.map((section) => ({
          title: section.title,
          body: section.body,
          items: section.items,
        })),
      },
    }),
  ),
);

const publicUtilityDocuments = definePublicDocuments('public-utility', [
  {
    canonicalPath: '/help/support',
    kind: 'support',
    title: 'Support',
    description: 'Contact The Timeline support.',
    indexability: 'index',
    dates: { modified: '2026-08-05', reviewed: LAST_REVIEWED },
    capability: { kind: 'not-applicable' },
    sitemap: { changeFrequency: 'monthly', priority: 0.5 },
    structuredData: [{ type: 'web-page' }],
    llms: {
      section: 'primary',
      order: 30,
      summary: 'Contact form for support, sales, and product questions.',
      fullSummary: 'Public support and sales contact form.',
    },
  },
  {
    canonicalPath: '/terms',
    kind: 'legal',
    title: 'Terms of Use',
    description: 'Terms governing access to The Timeline.',
    indexability: 'index',
    dates: { modified: '2026-06-03', reviewed: LAST_REVIEWED },
    capability: { kind: 'not-applicable' },
    sitemap: { changeFrequency: 'monthly', priority: 0.4 },
    structuredData: [{ type: 'web-page' }],
    llms: {
      section: 'primary',
      order: 50,
      summary: 'Terms governing access to The Timeline.',
      fullSummary: 'Service terms and acceptable-use rules.',
    },
  },
  {
    canonicalPath: '/privacy',
    kind: 'legal',
    title: 'Privacy Policy',
    description: 'How The Timeline processes personal data and team content.',
    indexability: 'index',
    dates: { modified: '2026-08-02', reviewed: LAST_REVIEWED },
    capability: { kind: 'not-applicable' },
    sitemap: { changeFrequency: 'monthly', priority: 0.4 },
    structuredData: [{ type: 'web-page' }],
    llms: {
      section: 'primary',
      order: 40,
      summary: 'How The Timeline processes personal data and team content.',
      fullSummary: 'Privacy and data-processing details.',
    },
  },
  {
    canonicalPath: '/llms-full.txt',
    kind: 'machine',
    title: 'llms-full.txt',
    description: 'Expanded Markdown summary of the public product and help content.',
    indexability: 'index',
    dates: { modified: '2026-08-12', reviewed: LAST_REVIEWED },
    capability: { kind: 'not-applicable' },
    sitemap: false,
    structuredData: [],
    llms: {
      section: 'companion',
      order: 10,
      summary: 'Expanded Markdown summary of the public product and help content.',
    },
  },
  {
    canonicalPath: '/sitemap.xml',
    kind: 'machine',
    title: 'sitemap.xml',
    description: 'Machine-readable sitemap for public indexable pages.',
    indexability: 'index',
    dates: { modified: '2026-08-12', reviewed: LAST_REVIEWED },
    capability: { kind: 'not-applicable' },
    sitemap: false,
    structuredData: [],
    llms: {
      section: 'companion',
      order: 20,
      fullLabel: 'Sitemap',
      summary: 'Machine-readable sitemap for public indexable pages.',
    },
  },
] satisfies readonly PublicDocument[]);

export const PUBLIC_DOCUMENT_REGISTRY = createPublicDocumentRegistry(
  coreDocuments,
  helpDocuments,
  publicUtilityDocuments,
);
