export const EVENT_SOURCES = [
  'web',
  'telegram',
  'email',
  'system',
  'document',
  // Phase 10 — meeting bot transcripts (Google Meet / Teams / Zoom via
  // Recall.ai). The finalize worker creates one consolidated event per
  // meeting; the specific platform lives in source_metadata.platform.
  'meeting',
  // Phase 11 — Third-party integration sync (Google Drive activity, Linear
  // issue/comment changes, GitHub PR/issue/release events, MCP-tool-derived
  // events, etc.). The provider lives in source_metadata.provider; the
  // external object id in source_metadata.external_object_id; the dedup
  // key in source_metadata.dedup_key.
  'integration',
  // Phase 11 — Calendar events. Two raw_events per calendar event:
  // source_metadata.action='scheduled' (at creation) and 'event' (at
  // start_at). Calendar-specific metadata in source_metadata.calendar_event_id.
  'calendar',
  // Phase 12 — first-party conversational capture from Slack. Slack-specific
  // routing, sender, conversation, thread, edit/delete, and attachment
  // provenance lives in source_metadata.
  'slack',
  // Generic team-managed inbound webhooks. The named webhook source and
  // credential live in ingest_webhooks / ingest_webhook_credentials; arbitrary
  // textual payload provenance lives in source_metadata.
  'ingest_webhook',
] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];
