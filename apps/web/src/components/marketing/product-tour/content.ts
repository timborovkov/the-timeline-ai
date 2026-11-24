import type { PublicCanonicalPath } from '@/lib/public-site';

export const PRODUCT_TOUR = {
  route: '/product-tour' as const satisfies PublicCanonicalPath,
  seoTitle: 'Product tour',
  seoDescription:
    'See The Timeline in action: connect sources, build lasting records, review proposed changes, read daily updates and ask questions with sources.',
  eyebrow: 'Product tour',
  title: 'Follow the work from source to answer.',
  summary:
    'Start with an illustrative login issue, then explore product screenshots from a separate sample workspace.',
  closingTitle: 'Start with one source.',
  closingBody: 'Connect a relevant source and ask about the work happening there.',
  steps: [
    {
      index: '01',
      headline: 'Connect where the work happens.',
      caption:
        'Link Telegram and Slack, forward email, and sync GitHub, Linear, Google Drive, Monday.com and Sentry.',
      file: '18-sources-light.png',
      alt: 'Sources page showing Telegram, Slack, email and synced tools connected to a workspace.',
      reshoot: undefined,
      mobileFile: '55-sources-mobile.png',
    },
    {
      index: '02',
      headline: 'Follow activity on the timeline.',
      caption:
        'Messages, notes, documents and code activity in order, each with who said it, where and when.',
      file: '11-timeline-dark.png',
      alt: 'Timeline chronology of messages, notes, documents and code activity.',
      reshoot: undefined,
      mobileFile: '53-timeline-mobile.png',
    },
    {
      index: '03',
      headline: 'Voice memos and calls count too.',
      caption:
        'A Telegram voice memo arrives with its transcript and the original audio, linked to its source.',
      file: '17-timeline-voice-dark.png',
      alt: 'Timeline event for a Telegram voice memo with transcript and original audio.',
      reshoot: undefined,
      mobileFile: undefined,
    },
    {
      index: '04',
      headline: 'Open a record to see its context.',
      caption:
        'A project’s status, blocker and review date, written from the evidence and linked back to it.',
      file: '23-project-northstar-dark.png',
      alt: 'Project Northstar record with status, blocker and review date.',
      reshoot: undefined,
      mobileFile: '56-project-northstar-mobile.png',
    },
    {
      index: '05',
      headline: 'Clients, tasks and documents in one record.',
      caption:
        'A client record gathers its open tasks, pending approvals, documents and related evidence.',
      file: '22-client-northstar-dark.png',
      alt: 'Client record gathering open tasks, pending approvals, documents and related evidence.',
      reshoot: undefined,
      mobileFile: undefined,
    },
    {
      index: '06',
      headline: 'Review proposed record changes.',
      caption:
        'Proposed tasks, dates and record changes wait in a queue, each with why it was suggested and its source. Captured evidence still lands on the timeline automatically.',
      file: '29-approvals-dark.png',
      alt: 'Approvals queue of proposed tasks, dates and record changes.',
      reshoot: undefined,
      mobileFile: '57-approvals-mobile.png',
    },
    {
      index: '07',
      headline: 'A daily update for the workspace.',
      caption:
        'Highlights, status, follow-ups, new tasks and upcoming calendar, written once a day from the record.',
      file: '33-digest-dark.png',
      alt: 'Daily workspace update with highlights, status, follow-ups, new tasks and calendar.',
      reshoot: undefined,
      mobileFile: undefined,
    },
    {
      index: '08',
      headline: 'Ask, and get the receipts.',
      caption: 'Follow citations back to the sources behind the answer.',
      file: '32-ask-handoff-dark.png',
      alt: 'Ask handoff brief with every line cited to its source.',
      reshoot: undefined,
      mobileFile: '54-ask-recap-mobile.png',
    },
  ],
} as const;
