import type { PublicDocument, PublicLlmsContentSection } from '@/lib/public-site/types';

import { EDITORIAL_PUBLIC_DOCUMENTS } from '@/components/marketing/editorial/public-documents';
import { CONNECTOR_PUBLIC_DOCUMENTS } from '@/components/marketing/integrations/connector-public-documents';
import {
  TIMELINE_AGENT_ACCESS_FAQS,
  TIMELINE_AGENT_INSTALL_STEPS,
  TIMELINE_MCP_COMMAND,
  TIMELINE_PLUGIN_INSTALL_PROMPT,
  TIMELINE_SKILL_INSTALL_PROMPT,
} from '@/lib/agent-install-content';
import { HELP_PAGES } from '@/lib/help-content';
import { createPublicDocumentRegistry, definePublicDocuments } from '@/lib/public-site/registry';

const LAST_REVIEWED = '2026-08-12' as const;

const AGENT_INSTALL_LLM_SECTIONS = [
  {
    title: 'Copy-ready plugin install prompt',
    body: 'Paste this prompt into a Codex task to install the complete Timeline plugin.',
    codeBlock: { content: TIMELINE_PLUGIN_INSTALL_PROMPT, language: 'text' },
  },
  {
    title: 'Copy-ready skill-only prompt',
    body: 'Use this narrower prompt when Timeline MCP is already connected or self-hosted.',
    codeBlock: { content: TIMELINE_SKILL_INSTALL_PROMPT, language: 'text' },
  },
  {
    title: 'Copy-ready MCP command',
    body: 'Run this command after TIMELINE_MCP_KEY is available in the environment that will launch Codex.',
    codeBlock: { content: TIMELINE_MCP_COMMAND, language: 'bash' },
  },
  {
    title: 'Install and connect',
    body: 'Complete these steps before asking Timeline-backed questions in Codex.',
    items: TIMELINE_AGENT_INSTALL_STEPS.map((step) => `${step.title}: ${step.body}`),
  },
  ...TIMELINE_AGENT_ACCESS_FAQS.map((item) => ({
    title: item.question,
    body: item.answer,
  })),
] satisfies readonly PublicLlmsContentSection[];

const LANDING_SECTIONS = [
  {
    title: 'What The Timeline does',
    body: 'The Timeline is an evidence-backed working history. Teams deliberately send notes, files, emails, meeting transcripts, calendar events, and documents or select provider records to preserve in a chronological project record. The agent answers questions with citations back to source material.',
  },
  {
    title: 'Best-fit teams',
    body: 'The product is built for small to mid-sized knowledge-work teams where context compounds: founding teams, sales teams, consulting teams, product teams, and operators who need a reliable record of what happened.',
  },
  {
    title: 'Core differentiator',
    body: 'Capture is unstructured, but output is structured. Teams keep working in their existing tools while Timeline preserves source, time, and visibility. Cited answers remain inspectable, and durable workspace changes require human approval.',
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
      'The Timeline preserves selected work from Telegram, Slack, meetings, documents, tickets, code, and email as an evidence-backed project history with cited answers.',
    indexability: 'index',
    dates: { modified: '2026-08-15', reviewed: '2026-08-15' },
    capability: { kind: 'current-product' },
    sitemap: { changeFrequency: 'weekly', priority: 1 },
    structuredData: [
      { type: 'web-page' },
      {
        type: 'software-application',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        features: [
          'Evidence-backed chronological project history from selected work',
          'Deliberate Telegram, Slack, email, meeting transcript, and webhook capture',
          'Cited status, handoffs, blockers, decisions, and commitments',
          'Native ingestion for GitHub, Linear, Google Drive, Monday.com, Slack, and Sentry',
          'Source, time, and visibility preserved with captured evidence',
          'Human approval before durable workspace changes',
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
    dates: { modified: '2026-08-20', reviewed: '2026-08-20' },
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
      dates: {
        modified: page.updatedAt ?? '2026-08-05',
        reviewed: page.updatedAt ?? LAST_REVIEWED,
      },
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
        sections: [
          ...page.sections.map((section) => ({
            title: section.title,
            body: section.body,
            items: section.items,
            links: section.resourceLinks,
          })),
          ...(page.slug === 'agents' ? AGENT_INSTALL_LLM_SECTIONS : []),
        ],
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
    dates: { modified: '2026-08-20', reviewed: '2026-08-20' },
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
    dates: { modified: '2026-08-20', reviewed: '2026-08-20' },
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
  CONNECTOR_PUBLIC_DOCUMENTS,
  EDITORIAL_PUBLIC_DOCUMENTS,
);
