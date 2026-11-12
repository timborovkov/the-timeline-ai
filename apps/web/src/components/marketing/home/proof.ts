import type { MarketingScreenshotSlot } from '@/components/marketing/screenshot-slot';

export const HOME_VOICE_SHOT = {
  file: '17-timeline-voice-dark.png',
  kicker: 'Voice notes',
  alt: 'A Telegram voice note on the timeline with its transcript and the original audio.',
  caption: 'Voice notes you can read.',
  body: 'Send a voice note in Telegram. Its transcript sits beside the original audio, with the sender and a link back to the message.',
} as const satisfies MarketingScreenshotSlot & { kicker: string; body: string };

export const HOME_TIMELINE_SHOT = {
  file: '11-timeline-dark.png',
  kicker: 'Work record',
  alt: 'The Timeline with messages, notes, documents and code activity in order.',
  caption: 'Find the moment that matters.',
  body: 'Search it by person, client or source. Conversations, documents and code activity appear in time order, with the author and original source attached.',
} as const satisfies MarketingScreenshotSlot & { kicker: string; body: string };

export const HOME_ASK_SHOT = {
  file: '32-ask-handoff-dark.png',
  kicker: 'Answers',
  alt: 'Ask handoff brief with numbered citations and a source card.',
  caption: 'A handoff with its evidence attached.',
  body: 'Ask for the current state, commitments and open gaps. Numbered citations show which messages support the answer.',
} as const satisfies MarketingScreenshotSlot & { kicker: string; body: string };

export const HOME_CLIENT_SHOT = {
  file: '22-client-northstar-dark.png',
  kicker: 'Clients and to-dos',
  alt: 'Client record gathering open tasks, pending approvals, documents and related messages.',
  caption: 'One place for the client’s work.',
  body: 'See open tasks, documents and proposed changes alongside the conversations behind them.',
} as const satisfies MarketingScreenshotSlot & { kicker: string; body: string };

export const HOME_DIGEST_SHOT = {
  file: '33-digest-dark.png',
  kicker: 'Commitments and follow-ups',
  alt: 'Daily workspace update with highlights, status, follow-ups, new tasks and upcoming calendar.',
  caption: 'Start with what needs attention.',
  body: 'Read the day’s highlights and follow-ups, then open the linked tasks and calendar items.',
} as const satisfies MarketingScreenshotSlot & { kicker: string; body: string };

export const HOME_PROOF_SHOTS = [
  HOME_VOICE_SHOT,
  HOME_TIMELINE_SHOT,
  HOME_ASK_SHOT,
  HOME_CLIENT_SHOT,
  HOME_DIGEST_SHOT,
] as const satisfies readonly (MarketingScreenshotSlot & { kicker: string; body: string })[];

export type HomeProofShot = (typeof HOME_PROOF_SHOTS)[number];
