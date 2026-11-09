import type { MarketingScreenshotSlot } from '@/components/marketing/screenshot-slot';

export const HOME_PROOF_SHOTS = [
  {
    file: '11-timeline-dark.png',
    kicker: 'Work record',
    alt: 'The Timeline chronology with messages, notes, documents and code activity in order.',
    caption:
      'See who did what, what was promised, and what’s next — with links to the source. Fictional Acme Labs demo workspace.',
    callouts: [
      {
        label: 'What changed',
        detail: 'Messages, notes, documents and code land in order on one chronology.',
      },
      {
        label: 'Who owns the next step',
        detail: 'Each row names the person who said it.',
      },
      {
        label: 'Link to the source',
        detail: 'Slack, GitHub, Telegram, calendar and documents stay attached.',
      },
    ],
  },
  {
    file: '32-ask-handoff-dark.png',
    kicker: 'Cited answers',
    alt: 'Ask handoff brief with numbered citations and a source card.',
    caption:
      'A stored example from the fictional Acme Labs demo. See who did what, what was promised, and what’s next — with links to the source.',
    callouts: [
      {
        label: 'What changed',
        detail: 'Current state, commitments and the open gap, written as a brief.',
      },
      {
        label: 'Who owns the next step',
        detail: 'Owner in flight is named in the answer.',
      },
      {
        label: 'Link to the source',
        detail: 'Numbered citations open the evidence. They do not rely on hover.',
      },
    ],
  },
  {
    file: '33-digest-dark.png',
    kicker: 'Commitments and follow-ups',
    alt: 'Daily workspace update with highlights, status, follow-ups, new tasks and upcoming calendar.',
    caption:
      'The daily update is written from captured conversations: who did what, what was promised, and what’s next — with links to the source.',
    callouts: [
      {
        label: 'What changed',
        detail: 'Highlights and status are written from that day’s captured work.',
      },
      {
        label: 'Who owns the next step',
        detail: 'Follow-ups and new tasks name the next owner.',
      },
      {
        label: 'Link to the source',
        detail: 'Each line traces back to a conversation, document or shipped change.',
      },
    ],
  },
] as const satisfies readonly (MarketingScreenshotSlot & { kicker: string })[];
