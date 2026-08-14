type CaptureSurfaceId = 'telegram' | 'slack-chat' | 'email' | 'meetings' | 'webhooks';

type CaptureSurfaceIcon = 'telegram' | 'slack' | 'mail' | 'video' | 'webhook';

export interface CaptureSurfaceContent {
  id: CaptureSurfaceId;
  name: string;
  category: string;
  icon: CaptureSurfaceIcon;
  summary: string;
  captured: string;
  boundary: string;
  setupHref: string;
  setupLabel: string;
  featured: boolean;
}

/**
 * Public truth for first-party capture surfaces. These are deliberately kept
 * separate from provider record-sync connectors: they accept human-directed
 * conversations, calls, mail, or payloads rather than mirroring a provider's
 * structured history.
 */
export const CAPTURE_SURFACES = [
  {
    id: 'telegram',
    name: 'Telegram',
    category: 'Conversation and capture',
    icon: 'telegram',
    summary:
      'Talk to Timeline in a linked DM or group, capture an explicit note, or send a file or voice memo into the same evidence pipeline.',
    captured: 'Explicit notes, linked group messages, files, images, audio, and voice memos.',
    boundary:
      'Plain text in a direct chat asks the agent; it does not silently become team evidence. Use /note for an explicit note. Telegram is not a passive account-history sync.',
    setupHref: '/app/team/telegram',
    setupLabel: 'Link Telegram',
    featured: true,
  },
  {
    id: 'slack-chat',
    name: 'Slack conversations',
    category: 'Conversation and capture',
    icon: 'slack',
    summary:
      'Ask Timeline from Slack, capture deliberate notes, and route linked conversations, files, and voice memos into the record.',
    captured:
      'Direct agent chats, /ask, @Timeline replies, explicit notes, files, and voice memos.',
    boundary:
      'This conversational surface is separate from the Slack history connector below, which syncs selected workspace channels as provider records.',
    setupHref: '/app/team/slack',
    setupLabel: 'Install Slack',
    featured: true,
  },
  {
    id: 'email',
    name: 'Email forwarding',
    category: 'Team inbox',
    icon: 'mail',
    summary:
      'Forward, CC, or BCC a message to the team address so decisions and attachments do not disappear inside personal inboxes.',
    captured:
      'Message body, sender and recipient context, and supported file, document, and audio attachments.',
    boundary:
      'Email enters only when the team address is included. Accepted messages from unknown senders are retained as unverified evidence rather than silently mapped to a member. When the team sender whitelist is enabled, messages from unlisted senders are rejected.',
    setupHref: '/app/team?section=email',
    setupLabel: 'Set up email',
    featured: false,
  },
  {
    id: 'meetings',
    name: 'Meeting transcripts',
    category: 'Google Meet · Microsoft Teams · Zoom',
    icon: 'video',
    summary:
      'Invite a silent notetaker to a live call, then keep the transcript, speakers, summary, and action items with the rest of the work.',
    captured:
      'Transcripts from Google Meet, Microsoft Teams, and Zoom calls after the scheduling gate is satisfied.',
    boundary:
      'By default, the scheduler must confirm that participants will be informed before the bot joins. Team admins can disable this gate when they have another legal basis. Timeline stores the transcript, not a copy of the raw meeting audio; provider setup is required.',
    setupHref: '/app/meetings',
    setupLabel: 'Open meetings',
    featured: false,
  },
  {
    id: 'webhooks',
    name: 'Ingest webhooks',
    category: 'Custom evidence',
    icon: 'webhook',
    summary:
      'Give an internal tool or unsupported service a named, authenticated endpoint that writes its payload into Timeline as source evidence.',
    captured:
      'JSON, form, CSV, XML, YAML, GraphQL, NDJSON, and other textual request bodies up to 1 MB.',
    boundary:
      'Webhooks are evidence-only sources. They do not become lifecycle-authoritative integrations, and direct file or binary upload uses a separate capture path.',
    setupHref: '/app/sources',
    setupLabel: 'Create a webhook',
    featured: false,
  },
] as const satisfies readonly CaptureSurfaceContent[];

export const CAPTURE_SURFACE_SUMMARY = {
  canonicalPath: '/integrations',
  surfaces: CAPTURE_SURFACES.map(({ id, name, category, captured, boundary }) => ({
    id,
    name,
    category,
    captured,
    boundary,
  })),
} as const;
