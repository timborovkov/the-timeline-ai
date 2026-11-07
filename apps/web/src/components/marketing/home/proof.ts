import type { MarketingScreenshotSlot } from '@/components/marketing/screenshot-slot';

export const HOME_PROOF_SHOTS = [
  {
    file: '11-timeline-dark.png',
    kicker: 'Work record',
    alt: 'The Timeline chronology with messages, notes, documents and code activity in order.',
    caption:
      'The work record: every message, note, document and code update in order, with who said it, where and when.',
  },
  {
    file: '32-ask-handoff-dark.png',
    kicker: 'Cited answers',
    alt: 'Ask handoff brief with numbered citations and a source hover card.',
    caption:
      'A stored Ask answer from the fictional Acme Labs demo. Every line cites its source, and a hover card opens the evidence. This is not live generated proof.',
  },
  {
    file: '33-digest-dark.png',
    kicker: 'Commitments and follow-ups',
    alt: 'Daily workspace update with highlights, status, follow-ups, new tasks and upcoming calendar.',
    caption:
      'The daily update is written from what the team said and shipped: highlights, status, follow-ups and what is coming next.',
  },
] as const satisfies readonly (MarketingScreenshotSlot & { kicker: string })[];
