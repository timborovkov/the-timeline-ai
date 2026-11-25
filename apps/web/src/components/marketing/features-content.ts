import { definePublicDocuments } from '@/lib/public-site/registry';
import type { PublicDocument } from '@/lib/public-site/types';

export const WORK_VIEWS = [
  {
    title: 'Task boards',
    href: '/use-cases/task-board',
    body: 'See what’s open and follow tasks back to the work behind them.',
  },
  {
    title: 'Customer context',
    href: '/use-cases/customer-context',
    body: 'Keep people, companies, deals and follow-ups together.',
  },
  {
    title: 'Calendar',
    href: '/help/work',
    body: 'See dated tasks and upcoming work in one place.',
  },
  {
    title: 'Files',
    href: '/help/documents',
    body: 'Find captured files and search supported documents.',
  },
] as const;

export const FEATURE_GROUPS = [
  {
    title: 'Keep up with the work',
    items: [
      {
        title: 'Timeline',
        href: '/how-it-works',
        body: 'Browse captured activity in order, with its source and time attached.',
      },
      {
        title: 'Questions with sources',
        href: '/product-tour',
        body: 'Ask what changed or what needs attention and check the evidence behind the answer.',
      },
      {
        title: 'Daily updates',
        href: '/use-cases/team-daily-log',
        body: 'Review highlights and follow-ups from the activity you can see.',
      },
    ],
  },
  {
    title: 'Open a view when you need it',
    items: WORK_VIEWS,
  },
  {
    title: 'Connect more of the work',
    items: [
      {
        title: 'Linked records',
        href: '/help/objects',
        body: 'Follow relationships between tasks, projects, people and source activity.',
      },
      {
        title: 'AI agents',
        href: '/agents',
        body: 'Let connected agents read permitted context and leave attributed progress notes.',
      },
      {
        title: 'Optional meeting capture',
        href: '/integrations#meeting-capture',
        body: 'Invite Timeline to a supported call or add existing notes or a text transcript as a document.',
      },
    ],
  },
] as const;

export const FEATURES_DOCUMENT = {
  canonicalPath: '/features',
  kind: 'product',
  title: 'Features',
  description:
    'Explore the shared work record: timeline, questions, daily updates, task boards, customer context, calendar, files, meetings and AI agents.',
  indexability: 'index',
  dates: { modified: '2026-11-24', reviewed: '2026-11-24' },
  capability: { kind: 'current-product' },
  sitemap: { changeFrequency: 'monthly', priority: 0.8 },
  structuredData: [{ type: 'collection-page' }],
  llms: {
    section: 'primary',
    order: 13,
    summary: 'Ways to keep up with the work and open the right view from the shared record.',
    sections: FEATURE_GROUPS.map((group) => ({
      title: group.title,
      body: group.items.map((item) => `${item.title}. ${item.body}`).join(' '),
    })),
  },
} as const satisfies PublicDocument;

export const FEATURES_PUBLIC_DOCUMENTS = definePublicDocuments('features', [FEATURES_DOCUMENT]);
