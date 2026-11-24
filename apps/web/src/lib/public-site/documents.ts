import { PRIVACY_VERSION, TERMS_VERSION } from '@timeline/shared/legal-versions';

import { AGENTS_PUBLIC_DOCUMENTS } from '@/components/marketing/agents/public-documents';
import { COMPARE_PUBLIC_DOCUMENTS } from '@/components/marketing/compare/public-documents';
import { EDITORIAL_PUBLIC_DOCUMENTS } from '@/components/marketing/editorial/public-documents';
import { FEATURES_PUBLIC_DOCUMENTS } from '@/components/marketing/features-content';
import { CONNECTOR_PUBLIC_DOCUMENTS } from '@/components/marketing/integrations/connector-public-documents';
import { MCP_GUIDE_PUBLIC_DOCUMENTS } from '@/components/marketing/integrations/mcp-guide-public-documents';
import { WORKS_WITH_PUBLIC_DOCUMENTS } from '@/components/marketing/integrations/works-with-public-documents';
import { PRICING_FAQS } from '@/components/marketing/pricing-faq-content';
import { SOLUTION_PUBLIC_DOCUMENTS } from '@/components/marketing/solutions/public-documents';
import {
  PRODUCT_TOUR_DOCUMENT,
  USE_CASE_PUBLIC_DOCUMENTS,
} from '@/components/marketing/use-cases/public-documents';
import {
  TIMELINE_AGENT_ACCESS_FAQS,
  TIMELINE_AGENT_INSTALL_STEPS,
  TIMELINE_AGENT_SETUP_PROMPT,
  TIMELINE_CLAUDE_PLUGIN_INSTALL_COMMAND,
  TIMELINE_MCP_COMMAND,
  TIMELINE_PLUGIN_INSTALL_PROMPT,
  TIMELINE_SKILL_INSTALL_PROMPT,
} from '@/lib/agent-install-content';
import { HELP_PAGES } from '@/lib/help-content';
import { PRODUCT_POSITIONING } from '@/lib/product-positioning';
import { createPublicDocumentRegistry, definePublicDocuments } from '@/lib/public-site/registry';
import type {
  PublicDocument,
  PublicIsoDate,
  PublicLlmsContentSection,
} from '@/lib/public-site/types';
import { TRUST_AI_MODEL_ITEMS, TRUST_AI_PRIVACY_SUMMARY } from '@/lib/trust-claims';

// Legal consent versions may have a same-day .N revision; public dates cannot.
const termsDate = TERMS_VERSION.slice(0, 10) as PublicIsoDate;
const privacyDate = PRIVACY_VERSION.slice(0, 10) as PublicIsoDate;

const LAST_REVIEWED = '2026-08-12' as const;

const AGENT_INSTALL_LLM_SECTIONS = [
  {
    title: 'Give this to your agent',
    body: 'Paste this one-liner so the agent can fetch /agents/setup.md and connect over OAuth.',
    codeBlock: { content: TIMELINE_AGENT_SETUP_PROMPT, language: 'text' },
  },
  {
    title: 'Copy-ready plugin install prompt',
    body: 'Paste this prompt into a Codex task to install the complete Timeline plugin.',
    codeBlock: { content: TIMELINE_PLUGIN_INSTALL_PROMPT, language: 'text' },
  },
  {
    title: 'Claude Code install commands',
    body: 'Run both commands in a terminal, then restart Claude Code and start a new conversation.',
    codeBlock: { content: TIMELINE_CLAUDE_PLUGIN_INSTALL_COMMAND, language: 'bash' },
  },
  {
    title: 'Copy-ready skill-only prompt',
    body: 'Use this narrower prompt when Timeline MCP is already connected or self-hosted.',
    codeBlock: { content: TIMELINE_SKILL_INSTALL_PROMPT, language: 'text' },
  },
  {
    title: 'Copy-ready MCP command',
    body: 'Run this URL-only command, then complete Timeline sign-in, team selection, and OAuth consent in the browser.',
    codeBlock: { content: TIMELINE_MCP_COMMAND, language: 'bash' },
  },
  {
    title: 'Install and connect',
    body: 'Complete these steps before asking Timeline-backed questions in Codex or Claude Code.',
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
    body: `${PRODUCT_POSITIONING.promise} ${PRODUCT_POSITIONING.hero}`,
  },
  {
    title: 'Who uses the work record',
    body: 'Teams whose work spans conversations, tools and AI agents. Before a customer call, a founder or product lead can check what engineering merged, what changed and what still needs verification.',
  },
  {
    title: 'Core differentiator',
    body: 'Keep working in your existing tools. The Timeline preserves source, time and visibility and connects that evidence to questions, daily updates and workspace records. Ask what you worked on this week, what changed for the team or what needs following up. Answers draw on captured activity you can see.',
  },
  {
    title: 'Trust model',
    body: 'Raw events are immutable source evidence. Agent answers surface numbered citations that point back to raw messages, voice memos, emails, transcripts, calendar events, or document versions.',
  },
  {
    title: 'Privacy model',
    body: 'Data is scoped by team and then filtered by per-event visibility. Events can be private, team-visible, or restricted to specific users. Team admins do not receive a general bypass for private context.',
  },
  {
    title: 'Main capture surfaces',
    body: 'Native surfaces include the web app, Telegram, Slack, inbound email, calendar, document uploads, optional meeting bot capture on supported Google Meet, Microsoft Teams and Zoom calls, and first-party integrations for GitHub, Linear, Google Drive, Monday.com, Slack workspace history, and Sentry. Native integrations create durable cited events; custom MCP servers cover long-tail live tool access without passive timeline ingestion by default.',
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
    body: 'Railway hosts the application, workers, PostgreSQL and Redis services, plus Qdrant vector search and RustFS object storage. Application file transfers use team authorization and short-lived signed URLs. Team scope and per-record visibility apply to relational, vector, and file access. Integration secrets use authenticated encryption at rest.',
  },
  {
    title: 'Human access',
    body: 'Timeline staff access policy prohibits routine browsing of customer workspaces. The policy permits access only for user-requested support, reliability, security response, legal compliance, or another documented operational need and requires access to be limited to what the task needs. Customer team administrators do not receive a general product bypass for private items. Separately authorized Timeline personnel can use audited support sessions lasting at most 30 minutes to read and act within a selected member’s permissions, including their private content. Ordinary support requires customer authorization. Session records are eligible for deletion after 30 days and platform audit records after 12 months, subject to documented legal holds; session expiry does not immediately delete records.',
  },
  {
    title: 'Meetings and files',
    body: 'Recall.ai processes meeting media to produce transcripts. Hosted Timeline requests one-hour provider media retention and does not copy raw meeting audio or video into Timeline storage. The requested setting is not confirmation of completed provider deletion. Transcripts remain workspace content. Uploaded voice notes and documents remain stored until deleted under applicable workspace handling.',
  },
  {
    title: 'Website sources and scanning',
    body: 'When a user requests a website scan, Firecrawl (SideGuide Technologies, Inc. d/b/a Firecrawl) fetches public pages of a website URL the user submits. Timeline sends that public URL; Firecrawl returns markdown. Firecrawl documents United States processing and a 24-hour crawl-result API window. Broader page-content retention is to be confirmed. Timeline does not enable Firecrawl Enterprise zero-data-retention.',
  },
  {
    title: 'Analytics and third parties',
    body: 'Timeline does not use behavioral advertising trackers. PostHog browser analytics may run only on reviewed public pages after affirmative consent, never in private workspace routes, with autocapture, heatmaps, and session replay off. Separate server-to-server events count allowlisted public and app surfaces through two fixed non-visitor streams, while content-free product actions use pseudonymous server identifiers. Sentry error monitoring is separate from every PostHog path.',
    links: [
      {
        label: 'Read the cookies and browser-storage notice',
        href: '/cookies',
      },
    ],
  },
  {
    title: 'Current assurance status',
    body: 'Timeline does not currently claim a SOC 2 report, ISO 27001 certification, or HIPAA compliance. Do not submit highly regulated or special-category data without Timeline’s express prior written approval for your use case.',
  },
  {
    title: 'Deployment options',
    body: 'Hosted Timeline cloud is operated by Timeline with the processors listed on the Trust page. Self-hosting uses the public GitHub repository under Elastic License 2.0 (source-available): use, modify, and self-host for your own organisation; do not offer it as a hosted/managed service to third parties; keep licensing notices. Self-hosted operators configure connectors and an OpenAI-compatible LLM endpoint. Timeline can also set up and maintain a managed on-premise or private-cloud deployment via the Enterprise enquiry form. This page does not invent certifications or SLAs that are not otherwise documented.',
    links: [
      {
        label: 'Inspect the public source repository',
        href: 'https://github.com/timborovkov/the-timeline-ai',
      },
      {
        label: 'Self-hosting guide',
        href: 'https://github.com/timborovkov/the-timeline-ai/blob/main/docs/self-hosting.md',
      },
      {
        label: 'Elastic License 2.0',
        href: 'https://github.com/timborovkov/the-timeline-ai/blob/main/LICENSE',
      },
      {
        label: 'Enterprise enquiry for managed on-premise',
        href: 'https://thetimeline.cc/contact/enterprise?topics=on_premise_deployment&from=trust',
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
  dates: { modified: '2026-11-19', reviewed: '2026-11-19' },
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
    title: PRODUCT_POSITIONING.title,
    description: PRODUCT_POSITIONING.description,
    indexability: 'index',
    dates: { modified: '2026-11-24', reviewed: '2026-11-24' },
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
          'Connected clients, projects, tasks and decisions from selected tools and sources',
          'Automatic capture in activated Slack channels and linked Telegram groups, plus optional notes, documents and meeting capture',
          'Cited status, handoffs, blockers, decisions, and commitments',
          'Native ingestion for GitHub, Linear, Google Drive, Monday.com, Slack, and Sentry',
          'Source, time, and visibility preserved with captured evidence',
          'Source-linked history for applied changes and a review queue for exceptions',
        ],
      },
    ],
    llms: {
      section: 'primary',
      order: 10,
      label: 'Landing page',
      summary: PRODUCT_POSITIONING.description,
      fullSummary:
        'A running record for teams and their AI agents, with cited answers, daily updates and views.',
      sections: LANDING_SECTIONS,
    },
  },
  {
    canonicalPath: '/help',
    kind: 'guide-index',
    title: 'Help',
    description:
      'Guides to connecting sources, capturing work, managing lasting records and tracing answers to their evidence in The Timeline.',
    indexability: 'index',
    dates: { modified: '2026-11-12', reviewed: '2026-11-12' },
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
  {
    canonicalPath: '/pricing',
    kind: 'guide-index',
    title: 'Pricing',
    description:
      'Free for up to three members with no card required. Team starts at $10 per member per month in USD. Contact sales for custom Enterprise pricing.',
    indexability: 'index',
    dates: { modified: '2026-11-24', reviewed: '2026-11-24' },
    capability: { kind: 'current-product' },
    sitemap: { changeFrequency: 'weekly', priority: 0.9 },
    structuredData: [
      { type: 'web-page' },
      {
        type: 'breadcrumbs',
        items: [
          { name: 'Home', path: '/' },
          { name: 'Pricing', path: '/pricing' },
        ],
      },
      { type: 'faq', entries: PRICING_FAQS },
    ],
    llms: {
      section: 'primary',
      order: 15,
      label: 'Pricing',
      summary:
        'Free for up to three members, Team at $10 per member per month, and custom Enterprise.',
      fullSummary:
        'AI processing and optional native meeting capture use a shared monthly allowance. Team admins can opt into capped additional usage.',
      sections: [
        {
          title: 'Questions',
          body: 'Membership, Included usage, and payment management.',
          items: PRICING_FAQS.map((faq) => `${faq.question} ${faq.answer}`),
        },
      ],
    },
  },
] satisfies readonly PublicDocument[]);

const helpDocuments = definePublicDocuments(
  'help-guides',
  HELP_PAGES.map((page, index): PublicDocument => ({
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
  })),
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
    canonicalPath: '/contact/enterprise',
    kind: 'support',
    title: 'Enterprise enquiry',
    description:
      'Contact Timeline about procurement, security review, SSO, SLA, data residency, or a custom Enterprise plan.',
    indexability: 'index',
    dates: { modified: '2026-11-19', reviewed: '2026-11-19' },
    capability: { kind: 'not-applicable' },
    sitemap: { changeFrequency: 'monthly', priority: 0.4 },
    structuredData: [{ type: 'web-page' }],
    llms: {
      section: 'primary',
      order: 31,
      summary:
        'Dedicated Enterprise enquiry form for procurement, governance, and SLA conversations.',
      fullSummary:
        'Short Enterprise form that emails the same support inbox, tagged enterprise, with pricing-context prefill.',
    },
  },
  {
    canonicalPath: '/terms',
    kind: 'legal',
    title: 'Terms of Use',
    description: 'Terms governing access to The Timeline.',
    indexability: 'index',
    dates: { modified: termsDate, reviewed: termsDate },
    capability: { kind: 'not-applicable' },
    sitemap: { changeFrequency: 'monthly', priority: 0.4 },
    structuredData: [{ type: 'web-page' }],
    llms: {
      section: 'primary',
      order: 50,
      summary: 'Terms governing access to The Timeline.',
      fullSummary:
        'Binding service terms covering user and team authority, customer content, capture responsibility, AI, integrations, acceptable use, security, liability, and termination. Personal OAuth disconnect, workspace-source removal, and deletion of captured history are distinct actions.',
    },
  },
  {
    canonicalPath: '/privacy',
    kind: 'legal',
    title: 'Privacy Policy',
    description: 'How The Timeline processes personal data and team content.',
    indexability: 'index',
    dates: { modified: privacyDate, reviewed: privacyDate },
    capability: { kind: 'not-applicable' },
    sitemap: { changeFrequency: 'monthly', priority: 0.4 },
    structuredData: [{ type: 'web-page' }],
    llms: {
      section: 'primary',
      order: 40,
      summary: 'How The Timeline processes personal data and team content.',
      fullSummary:
        'Controller and processor roles, data categories, legal bases, AI privacy routing, subprocessors including Firecrawl public website scanning, Resend transactional and inbound email, analytics, human access, security, retention, transfers, data-subject rights, and the distinction between personal disconnect, workspace-source removal, and deletion of captured history.',
    },
  },
  {
    canonicalPath: '/cookies',
    kind: 'legal',
    title: 'Cookies and similar technologies',
    description:
      'The cookies, browser storage, analytics, and related technologies used by The Timeline.',
    indexability: 'index',
    dates: { modified: '2026-11-24', reviewed: '2026-11-24' },
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
    canonicalPath: '/agents/provisioning.md',
    kind: 'machine',
    title: 'Agent provisioning API',
    description:
      'Owner-authorized unattended creation of new workspaces, credentials, retries, and restrictions.',
    indexability: 'index',
    dates: { modified: '2026-11-06', reviewed: '2026-11-06' },
    capability: { kind: 'current-product' },
    sitemap: false,
    structuredData: [],
    llms: false,
  },
  {
    canonicalPath: '/agents/setup.md',
    kind: 'machine',
    title: 'Agent setup',
    description:
      'Agent-readable Markdown that branches MCP and skill setup by ChatGPT, Claude, Claude Code, Codex, Cursor, Grok Bot, Hermes, and OpenClaw.',
    indexability: 'index',
    dates: { modified: '2026-11-07', reviewed: '2026-11-07' },
    capability: { kind: 'current-product' },
    sitemap: false,
    structuredData: [],
    llms: false,
  },
  {
    canonicalPath: '/agents/SKILL.md',
    kind: 'machine',
    title: 'Timeline skill',
    description:
      'The published Timeline SKILL.md, byte-identical to the repository plugin skill file.',
    indexability: 'index',
    dates: { modified: '2026-11-07', reviewed: '2026-11-07' },
    capability: { kind: 'current-product' },
    sitemap: false,
    structuredData: [],
    llms: false,
  },
  {
    canonicalPath: '/llms-full.txt',
    kind: 'machine',
    title: 'llms-full.txt',
    description: 'Expanded Markdown summary of the public product and help content.',
    indexability: 'index',
    dates: { modified: '2026-11-19', reviewed: '2026-11-19' },
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
    dates: { modified: '2026-11-03', reviewed: '2026-11-03' },
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

const productTourDocuments = definePublicDocuments('product-tour', [PRODUCT_TOUR_DOCUMENT]);

export const PUBLIC_DOCUMENT_REGISTRY = createPublicDocumentRegistry(
  coreDocuments,
  helpDocuments,
  publicUtilityDocuments,
  CONNECTOR_PUBLIC_DOCUMENTS,
  MCP_GUIDE_PUBLIC_DOCUMENTS,
  WORKS_WITH_PUBLIC_DOCUMENTS,
  EDITORIAL_PUBLIC_DOCUMENTS,
  SOLUTION_PUBLIC_DOCUMENTS,
  USE_CASE_PUBLIC_DOCUMENTS,
  FEATURES_PUBLIC_DOCUMENTS,
  COMPARE_PUBLIC_DOCUMENTS,
  AGENTS_PUBLIC_DOCUMENTS,
  productTourDocuments,
);
