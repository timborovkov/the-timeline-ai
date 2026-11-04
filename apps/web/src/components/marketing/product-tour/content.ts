import type { PublicCanonicalPath } from '@/lib/public-site';

export const PRODUCT_TOUR = {
  route: '/product-tour' as const satisfies PublicCanonicalPath,
  seoTitle: 'See it first: a tour of The Timeline',
  seoDescription:
    'Real screens from The Timeline: connect Slack, Telegram, email and calls, watch the work record fill in, approve changes, read the daily update and ask with sources.',
  eyebrow: 'Product tour',
  title: 'See it first.',
  summary:
    'Real screens from a demo workspace. Scroll through how The Timeline turns what your team says in Slack, Telegram, email and calls into a work record that keeps itself current.',
  closingTitle: 'Link one channel. Watch the record fill in.',
  closingBody:
    'Start with one Slack channel or Telegram group. Read the daily update, approve what The Timeline proposes, and ask what was decided, with the source for every line.',
  steps: [
    {
      index: '01',
      headline: 'Connect where the work happens.',
      caption:
        'Link Telegram and Slack, forward email, and sync GitHub, Linear, Google Drive, Monday.com and Sentry.',
      file: '18-sources-light.png',
      alt: 'Sources page showing Telegram, Slack, email and synced tools connected to a workspace.',
      reshoot: 'Needs a true dark capture: 18-sources-dark.png was captured in light mode.',
      mobileFile: undefined,
    },
    {
      index: '02',
      headline: 'Everything lands on one timeline.',
      caption:
        'Messages, notes, documents and code activity in order, each with who said it, where and when.',
      file: '11-timeline-dark.png',
      alt: 'Timeline chronology of messages, notes, documents and code activity.',
      reshoot: 'To reshoot after citation redesign and seed update (demo dates).',
      mobileFile: '53-timeline-mobile.png',
    },
    {
      index: '03',
      headline: 'Voice memos and calls count too.',
      caption:
        'A Telegram voice memo arrives with its transcript and the original audio, linked to its source.',
      file: '17-timeline-voice-dark.png',
      alt: 'Timeline event for a Telegram voice memo with transcript and original audio.',
      reshoot: 'To reshoot after citation redesign and seed update (citation chip, demo dates).',
      mobileFile: undefined,
    },
    {
      index: '04',
      headline: 'The record keeps itself current.',
      caption:
        'A project’s status, blocker and review date, written from the evidence and linked back to it.',
      file: '23-project-northstar-dark.png',
      alt: 'Project Northstar record with status, blocker and review date.',
      reshoot:
        'To reshoot after citation redesign and seed update (evidence chips, demo dates, Overdue tasks).',
      mobileFile: undefined,
    },
    {
      index: '05',
      headline: 'Clients, tasks and documents in one record.',
      caption:
        'A client record gathers its open tasks, pending approvals, documents and related evidence.',
      file: '22-client-northstar-dark.png',
      alt: 'Client record gathering open tasks, pending approvals, documents and related evidence.',
      reshoot: 'To reshoot after citation redesign and seed update (demo dates, Overdue tasks).',
      mobileFile: undefined,
    },
    {
      index: '06',
      headline: 'Nothing changes until you approve it.',
      caption:
        'Proposed tasks, dates and record changes wait in a queue, each with why it was suggested and its source.',
      file: '29-approvals-dark.png',
      alt: 'Approvals queue of proposed tasks, dates and record changes.',
      reshoot: 'To reshoot after citation redesign and seed update (demo dates).',
      mobileFile: undefined,
    },
    {
      index: '07',
      headline: 'A daily update for the workspace.',
      caption:
        'Highlights, status, follow-ups, new tasks and upcoming calendar, written once a day from the record.',
      file: '33-digest-dark.png',
      alt: 'Daily workspace update with highlights, status, follow-ups, new tasks and calendar.',
      reshoot:
        'To reshoot after citation redesign and seed update. Also capture from the top of the page.',
      mobileFile: undefined,
    },
    {
      index: '08',
      headline: 'Ask, and get the receipts.',
      caption:
        'Ask for a status or a handoff brief on any client or project, and every line cites where it came from.',
      file: '32-ask-handoff-dark.png',
      alt: 'Ask handoff brief with every line cited to its source.',
      reshoot:
        'To reshoot after citation redesign and seed update (citation chips). Remove the Last week recap chat from the Ask sidebar before reshooting.',
      mobileFile: '54-ask-recap-mobile.png',
    },
  ],
} as const;
