import type { PublicDocument, PublicLlmsContentSection } from '@/lib/public-site/types';

import { EDITORIAL_PUBLIC_DOCUMENTS } from '@/components/marketing/editorial/public-documents';
import { CONNECTOR_PUBLIC_DOCUMENTS } from '@/components/marketing/integrations/connector-public-documents';
import { SOLUTION_PUBLIC_DOCUMENTS } from '@/components/marketing/solutions/public-documents';
import {
  TIMELINE_AGENT_ACCESS_FAQS,
  TIMELINE_AGENT_INSTALL_STEPS,
  TIMELINE_MCP_COMMAND,
  TIMELINE_PLUGIN_INSTALL_PROMPT,
  TIMELINE_SKILL_INSTALL_PROMPT,
} from '@/lib/agent-install-content';
import { HELP_PAGES } from '@/lib/help-content';
import { createPublicDocumentRegistry, definePublicDocuments } from '@/lib/public-site/registry';
import { TRUST_AI_MODEL_ITEMS, TRUST_AI_PRIVACY_SUMMARY } from '@/lib/trust-claims';

const LAST_REVIEWED = '2026-08-12' as const;

const AGENT_INSTALL_LLM_SECTIONS = [
  {
    title: 'Copy-ready plugin install prompt',
    body: 'Paste this prompt into a Codex task to install the complete Timeline plugin.',
    codeBlock: { content: TIMELINE_PLUGIN_INSTALL_PROMPT, language: 'text' },
  },
  {
    title: 'Copy-ready skill-only prompt',
    body: 'Use this narrower prompt when Timeline MCP is already connected or for a separately licensed customer-controlled deployment.',
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
    body: 'The Timeline is an AI team memory. Teams deliberately send notes, files, emails, meeting transcripts, calendar events, and documents or select provider records to preserve as chronological project history. The agent answers questions with citations back to the original source material.',
  },
  {
    title: 'Best-fit teams',
    body: 'The product is built for small to mid-sized knowledge-work teams where context compounds: founding teams, sales teams, consulting teams, product teams, and operators who need a reliable record of what happened.',
  },
  {
    title: 'Core differentiator',
    body: 'Capture is unstructured, but output is structured. Teams keep working in their existing tools while Timeline preserves source, time, and visibility. Cited answers remain inspectable, and suggested durable workspace changes require human approval.',
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

const TRUST_SECTIONS = [
  {
    title: 'AI without training on customer content',
    body: TRUST_AI_PRIVACY_SUMMARY,
    items: [
      ...TRUST_AI_MODEL_ITEMS,
      'Timeline does not use Customer Content to train or fine-tune any model.',
      'Hosted production disables rich prompt-and-output tracing.',
    ],
  },
  {
    title: 'Storage and workspace boundaries',
    body: 'Railway hosts the application, workers, PostgreSQL and Redis services, plus Qdrant vector search and RustFS object storage. Server traffic uses Railway private networking; RustFS also exposes HTTPS for authorized, short-lived signed browser transfers while buckets remain non-public. Team scope and per-record visibility apply to relational, vector, and file access. Integration secrets use authenticated encryption at rest.',
  },
  {
    title: 'Human access',
    body: 'Timeline personnel do not routinely browse customer workspaces. Authorized access is reserved for user-requested support, reliability, security response, legal compliance, or another documented operational need and must be minimum-necessary. Team administrators do not receive a general product bypass for private items.',
  },
  {
    title: 'Meetings and files',
    body: 'Recall.ai processes meeting media to produce transcripts. Hosted Timeline requests one-hour provider media retention and does not copy raw meeting audio or video into Timeline storage; deployed request/account evidence and deletion-failure handling must still be verified. Transcripts remain workspace content. Uploaded voice notes and documents remain stored until deleted under applicable workspace handling.',
  },
  {
    title: 'Analytics and third parties',
    body: 'Timeline does not use behavioral advertising trackers. PostHog browser analytics may run only on reviewed public pages after affirmative consent, never in private workspace routes, with autocapture, heatmaps, and session replay off. Separate server-to-server events count allowlisted public and app surfaces through two fixed non-visitor streams, while content-free product actions use pseudonymous server identifiers. Sentry error monitoring is separate from every PostHog path. Provider account, retention, and deployed-production evidence remain pending.',
    links: [
      {
        label: 'Read the cookies and browser-storage notice',
        href: 'https://thetimeline.cc/cookies',
      },
    ],
  },
  {
    title: 'Current assurance status',
    body: 'Timeline does not currently claim SOC 2 or ISO 27001 certification or HIPAA compliance. GDPR is a legal framework, not a certificate. Verified assurance reports and certifications will be published only after they are actually obtained.',
  },
  {
    title: 'Inspect or control the deployment',
    body: 'The source repository is public so teams can inspect architecture, report issues, and propose patches. Public source availability is not itself a software license. Contact Timeline to discuss a dedicated or self-managed deployment and the applicable terms.',
    links: [
      {
        label: 'Inspect the public source repository',
        href: 'https://github.com/timborovkov/the-timeline-ai',
      },
    ],
  },
] satisfies readonly PublicLlmsContentSection[];

export const TRUST_DOCUMENT = {
  canonicalPath: '/trust',
  kind: 'trust',
  title: 'Trust, security, and data privacy',
  description:
    'How The Timeline protects team data across AI inference, storage, permissions, meetings, analytics, and human access.',
  indexability: 'index',
  dates: { modified: '2026-08-21', reviewed: '2026-08-21' },
  capability: { kind: 'current-product' },
  sitemap: { changeFrequency: 'monthly', priority: 0.7 },
  structuredData: [{ type: 'web-page' }],
  llms: {
    section: 'primary',
    order: 25,
    label: 'Trust and security',
    summary:
      'Security and privacy controls, provider boundaries, and current assurance status for AI routing, storage, permissions, meetings, analytics, and human access.',
    fullSummary: 'Security, privacy, provider, retention, and assurance details.',
    sections: TRUST_SECTIONS,
  },
} as const satisfies PublicDocument;

const coreDocuments = definePublicDocuments('public-core', [
  {
    canonicalPath: '/',
    kind: 'landing',
    title: 'AI Team Memory With Cited Answers',
    description:
      'Timeline turns selected chats, meetings, documents, tickets, and code into a searchable project history. Ask questions and verify every claim at the source.',
    indexability: 'index',
    dates: { modified: '2026-08-21', reviewed: '2026-08-21' },
    capability: { kind: 'current-product' },
    sitemap: { changeFrequency: 'weekly', priority: 1 },
    structuredData: [
      { type: 'web-page' },
      {
        type: 'software-application',
        name: 'The Timeline',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        features: [
          'Evidence-backed chronological project history from selected work',
          'Deliberate Telegram, Slack, email, meeting transcript, and webhook capture',
          'Cited status, handoffs, blockers, decisions, and commitments',
          'Native ingestion for GitHub, Linear, Google Drive, Monday.com, Slack, and Sentry',
          'Source, time, and visibility preserved with captured evidence',
          'Human approval before inferred durable workspace changes',
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
    dates: { modified: '2026-08-21', reviewed: '2026-08-21' },
    capability: { kind: 'current-product' },
    sitemap: { changeFrequency: 'weekly', priority: 0.8 },
    structuredData: [{ type: 'collection-page' }],
    llms: {
      section: 'primary',
      order: 20,
      label: 'Help center',
      summary:
        'Public product guides plus private, bug, security, and contribution support routes.',
      fullSummary: 'Public user guides and support-channel routing.',
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
  TRUST_DOCUMENT,
  {
    canonicalPath: '/help/support',
    kind: 'support',
    title: 'Help and support',
    description:
      'Choose private support, public bug reporting, security, or contribution guidance.',
    indexability: 'index',
    dates: { modified: '2026-08-21', reviewed: '2026-08-21' },
    capability: { kind: 'not-applicable' },
    sitemap: { changeFrequency: 'monthly', priority: 0.5 },
    structuredData: [{ type: 'web-page' }],
    llms: {
      section: 'primary',
      order: 30,
      summary: 'Channel router and private form for support, bugs, security, and contributions.',
      fullSummary: 'Private support form plus safe public bug, security, and contribution routes.',
    },
  },
  {
    canonicalPath: '/terms',
    kind: 'legal',
    title: 'Terms of Use',
    description: 'Terms governing access to The Timeline.',
    indexability: 'index',
    dates: { modified: '2026-08-21', reviewed: '2026-08-21' },
    capability: { kind: 'not-applicable' },
    sitemap: { changeFrequency: 'monthly', priority: 0.4 },
    structuredData: [{ type: 'web-page' }],
    llms: {
      section: 'primary',
      order: 50,
      summary: 'Terms governing access to The Timeline.',
      fullSummary:
        'Binding service terms covering user and team authority, customer content, capture responsibility, AI, integrations, acceptable use, security, liability, and termination.',
    },
  },
  {
    canonicalPath: '/privacy',
    kind: 'legal',
    title: 'Privacy Policy',
    description: 'How The Timeline processes personal data and team content.',
    indexability: 'index',
    dates: { modified: '2026-08-21', reviewed: '2026-08-21' },
    capability: { kind: 'not-applicable' },
    sitemap: { changeFrequency: 'monthly', priority: 0.4 },
    structuredData: [{ type: 'web-page' }],
    llms: {
      section: 'primary',
      order: 40,
      summary: 'How The Timeline processes personal data and team content.',
      fullSummary:
        'Controller and processor roles, data categories, legal bases, AI privacy routing, subprocessors, analytics, human access, security, retention, transfers, and data-subject rights.',
    },
  },
  {
    canonicalPath: '/cookies',
    kind: 'legal',
    title: 'Cookies and similar technologies',
    description:
      'The cookies, browser storage, analytics, and related technologies used by The Timeline.',
    indexability: 'index',
    dates: { modified: '2026-08-21', reviewed: '2026-08-21' },
    capability: { kind: 'not-applicable' },
    sitemap: { changeFrequency: 'monthly', priority: 0.4 },
    structuredData: [{ type: 'web-page' }],
    llms: {
      section: 'primary',
      order: 45,
      summary:
        'Current necessary browser storage and the consent controls for optional public analytics.',
      fullSummary:
        'Cookie, local-storage, and session-storage inventory; notice-versus-consent boundary; public-only browser analytics and withdrawal controls; personless server surface streams; and separate Sentry, Turnstile, and logging paths.',
    },
  },
  {
    canonicalPath: '/llms-full.txt',
    kind: 'machine',
    title: 'llms-full.txt',
    description: 'Expanded Markdown summary of the public product and help content.',
    indexability: 'index',
    dates: { modified: '2026-08-21', reviewed: '2026-08-21' },
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
    dates: { modified: '2026-08-21', reviewed: '2026-08-21' },
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
  SOLUTION_PUBLIC_DOCUMENTS,
);
