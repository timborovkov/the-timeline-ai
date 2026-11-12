import type { MarketingScreenshotSlot } from '@/components/marketing/screenshot-slot';

export const HOME_VOICE_SHOT = {
  file: '17-timeline-voice-dark.png',
  kicker: 'Voice notes',
  alt: 'A Telegram voice note on the timeline with its transcript and the original audio.',
  caption: 'Read a voice note without losing the recording.',
  callouts: [
    {
      label: 'What changed',
      detail: 'The transcript appears beside the original audio.',
    },
    {
      label: 'Who owns the next step',
      detail: 'The sender is named on the row.',
    },
    {
      label: 'Link to the source',
      detail: 'Open the Telegram message.',
    },
  ],
} as const satisfies MarketingScreenshotSlot & { kicker: string };

export const HOME_TIMELINE_SHOT = {
  file: '11-timeline-dark.png',
  kicker: 'Work record',
  alt: 'The Timeline with messages, notes, documents and code activity in order.',
  caption: 'Review work across sources in time order.',
  callouts: [
    {
      label: 'What changed',
      detail: 'Messages, documents and code activity share one chronology.',
    },
    {
      label: 'Who owns the next step',
      detail: 'Each row names its author.',
    },
    {
      label: 'Link to the source',
      detail: 'Open the source attached to any row.',
    },
  ],
} as const satisfies MarketingScreenshotSlot & { kicker: string };

export const HOME_ASK_SHOT = {
  file: '32-ask-handoff-dark.png',
  kicker: 'Answers',
  alt: 'Ask handoff brief with numbered citations and a source card.',
  caption: 'Turn the record into a handoff brief.',
  callouts: [
    {
      label: 'What changed',
      detail: 'Review the current state and open gaps.',
    },
    {
      label: 'Who owns the next step',
      detail: 'The answer names the next owner.',
    },
    {
      label: 'Link to the source',
      detail: 'Select a citation to inspect its source.',
    },
  ],
} as const satisfies MarketingScreenshotSlot & { kicker: string };

export const HOME_CLIENT_SHOT = {
  file: '22-client-northstar-dark.png',
  kicker: 'Clients and to-dos',
  alt: 'Client record gathering open tasks, pending approvals, documents and related messages.',
  caption: 'Review a client’s work in one place.',
  callouts: [
    {
      label: 'What changed',
      detail: 'Review proposed changes beside the client record.',
    },
    {
      label: 'Who owns the next step',
      detail: 'Open to-dos name the responsible person.',
    },
    {
      label: 'Link to the source',
      detail: 'Inspect the message behind a suggestion.',
    },
  ],
} as const satisfies MarketingScreenshotSlot & { kicker: string };

export const HOME_DIGEST_SHOT = {
  file: '33-digest-dark.png',
  kicker: 'Commitments and follow-ups',
  alt: 'Daily workspace update with highlights, status, follow-ups, new tasks and upcoming calendar.',
  caption: 'Start the day with commitments and follow-ups.',
  callouts: [
    {
      label: 'What changed',
      detail: 'Read highlights from the day’s work.',
    },
    {
      label: 'Who owns the next step',
      detail: 'Follow-ups name the next owner.',
    },
    {
      label: 'Link to the source',
      detail: 'Open the linked task or calendar item.',
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
