import type { MarketingScreenshotSlot } from '@/components/marketing/screenshot-slot';

export const HOME_VOICE_SHOT = {
  file: '17-timeline-voice-dark.png',
  kicker: 'Voice notes',
  alt: 'A Telegram voice note on the timeline with its transcript and the original audio.',
  caption:
    'A Telegram voice note arrives transcribed, with the original audio and a link to the source. Fictional Acme Labs demo workspace.',
  callouts: [
    {
      label: 'What changed',
      detail: 'The voice note lands on the timeline with its transcript.',
    },
    {
      label: 'Who owns the next step',
      detail: 'The person who sent it stays on the row.',
    },
    {
      label: 'Link to the source',
      detail: 'The original message stays attached, with a link to it.',
    },
  ],
} as const satisfies MarketingScreenshotSlot & { kicker: string };

export const HOME_TIMELINE_SHOT = {
  file: '11-timeline-dark.png',
  kicker: 'Work record',
  alt: 'The Timeline with messages, notes, documents and code activity in order.',
  caption:
    'See who did what, what was promised, and what’s next — with links to the source. Fictional Acme Labs demo workspace.',
  callouts: [
    {
      label: 'What changed',
      detail: 'Messages, notes, documents and code land in order on one timeline.',
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
} as const satisfies MarketingScreenshotSlot & { kicker: string };

export const HOME_ASK_SHOT = {
  file: '32-ask-handoff-dark.png',
  kicker: 'Answers',
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
      detail: 'Numbered citations open the original message, with a link to it.',
    },
  ],
} as const satisfies MarketingScreenshotSlot & { kicker: string };

export const HOME_CLIENT_SHOT = {
  file: '22-client-northstar-dark.png',
  kicker: 'Clients and to-dos',
  alt: 'Client record gathering open tasks, pending approvals, documents and related messages.',
  caption:
    'A client record gathers its open to-dos, pending approvals, documents and the original messages. Fictional Acme Labs demo workspace.',
  callouts: [
    {
      label: 'What changed',
      detail: 'Clients and to-dos stay current from the messages already sent.',
    },
    {
      label: 'Who owns the next step',
      detail: 'Open to-dos name the person responsible.',
    },
    {
      label: 'Link to the source',
      detail: 'Each suggested update keeps the original message, with a link to it.',
    },
  ],
} as const satisfies MarketingScreenshotSlot & { kicker: string };

export const HOME_DIGEST_SHOT = {
  file: '33-digest-dark.png',
  kicker: 'Commitments and follow-ups',
  alt: 'Daily workspace update with highlights, status, follow-ups, new tasks and upcoming calendar.',
  caption:
    'The daily update is written from the day’s messages: who did what, what was promised, and what’s next, with links to tasks and calendar items.',
  callouts: [
    {
      label: 'What changed',
      detail: 'Highlights and status are written from that day’s work.',
    },
    {
      label: 'Who owns the next step',
      detail: 'Follow-ups and new tasks name the next owner.',
    },
    {
      label: 'Link to the source',
      detail: 'Open linked tasks and calendar items; the original message stays linked.',
    },
  ],
} as const satisfies MarketingScreenshotSlot & { kicker: string };

export const HOME_PROOF_SHOTS = [
  HOME_VOICE_SHOT,
  HOME_TIMELINE_SHOT,
  HOME_ASK_SHOT,
  HOME_CLIENT_SHOT,
  HOME_DIGEST_SHOT,
] as const satisfies readonly (MarketingScreenshotSlot & { kicker: string })[];

export type HomeProofShot = (typeof HOME_PROOF_SHOTS)[number];
