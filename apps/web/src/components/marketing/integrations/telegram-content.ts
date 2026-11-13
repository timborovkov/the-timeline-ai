import type { PublicCanonicalPath } from '@/lib/public-site';

import { CAPTURE_SURFACES } from '@/components/marketing/integrations/capture-surface-content';

const telegram = CAPTURE_SURFACES.find((surface) => surface.id === 'telegram');
if (!telegram) throw new Error('Telegram capture surface content is required');

export const TELEGRAM_PAGE = {
  route: '/integrations/telegram' as const satisfies PublicCanonicalPath,
  seoTitle: 'Telegram integration: keep your work record from group chats',
  seoDescription:
    'Link a Telegram group or DM to The Timeline. Messages, files and voice memos join your work record with their source, and you can ask questions right in Telegram.',
  title: 'Keep the work beyond the chat.',
  summary:
    'Link a Telegram group or DM. Group messages, files, images and voice memos join your work record with their source. Ask The Timeline questions without leaving the chat.',
  captured: telegram.captured,
  boundary: telegram.boundary,
  dailyUpdate:
    'Post the workspace daily update to a Telegram chat, or send it to each linked member by DM.',
  setupHref: telegram.setupHref,
  setupLabel: telegram.setupLabel,
  screenshot: {
    file: '17-timeline-voice-dark.png',
    alt: 'A Telegram voice memo on the timeline with its transcript and original audio.',
    caption:
      'A Telegram voice memo joins the work record with its transcript and the original audio, linked to its source.',
  },
} as const;
