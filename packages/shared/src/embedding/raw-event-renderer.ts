import {
  payloadDigestFromMetadata,
  sourcePayloadRefFromMetadata,
} from '#src/reconciliation/source-snapshot.js';

type Metadata = Record<string, unknown>;

export interface RawEventForAiInput {
  source: string;
  contentText: string | null;
  sourceMetadata: unknown;
}

function metadataObject(value: unknown): Metadata {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Metadata) : {};
}

function metadataString(meta: Metadata, key: string, max = 120): string | null {
  const value = meta[key];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= max) return text;
  if (max <= 0) return '';
  if (max <= 3) return '.'.repeat(max);
  return `${text.slice(0, max - 3)}...`;
}

function metadataStringFrom(meta: Metadata, keys: string[], max = 120): string | null {
  for (const key of keys) {
    const value = metadataString(meta, key, max);
    if (value) return value;
  }
  return null;
}

function metadataPathString(meta: Metadata, path: string[], max = 120): string | null {
  let value: unknown = meta;
  for (const key of path) {
    value = metadataObject(value)[key];
  }
  return metadataString({ value }, 'value', max);
}

function metadataPerson(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number')
    return metadataString({ value }, 'value');
  const meta = metadataObject(value);
  const name = metadataStringFrom(meta, ['name', 'display_name']);
  const email = metadataString(meta, 'email');
  if (name && email) return `${name} <${email}>`;
  return name ?? email ?? metadataStringFrom(meta, ['externalId', 'external_id', 'id']);
}

function metadataAttachmentNames(meta: Metadata): string[] {
  const attachments = meta.attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((a) =>
      a && typeof a === 'object'
        ? metadataStringFrom(a as Metadata, ['filename', 'name', 'id'])
        : null,
    )
    .filter((v): v is string => Boolean(v))
    .slice(0, 5);
}

function metadataValueString(value: unknown, max = 120): string | null {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string' || typeof value === 'number') {
    return metadataString({ value }, 'value', max);
  }
  return null;
}

function metadataStringList(value: unknown, maxItems = 5): string | null {
  if (!Array.isArray(value)) return null;
  const entries = value
    .map((entry) => metadataValueString(entry, 80))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, maxItems);
  return entries.length > 0 ? entries.join(', ') : null;
}

function pushPart(parts: string[], label: string, value: string | null): void {
  if (value) parts.push(`${label} ${value}`);
}

function renderMondayColumns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((column) => {
      const meta = metadataObject(column);
      const title = metadataStringFrom(meta, ['title', 'id'], 60);
      if (!title) return null;
      const type = metadataString(meta, 'type', 30);
      const text = metadataString(meta, 'text', 120) ?? metadataValueString(meta.value, 120);
      if (!text) return null;
      return `Monday column ${title}${type ? ` (${type})` : ''} ${text}`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 8);
}

function renderSentryDetails(meta: Metadata): string[] {
  if (metadataString(meta, 'provider') !== 'sentry') return [];
  const parts: string[] = [];
  const action = metadataString(meta, 'webhook_action', 60);
  if (action) parts.push(`Sentry action ${action}`);
  const level = metadataString(meta, 'level', 60);
  if (level) parts.push(`Sentry level ${level}`);
  const status = metadataString(meta, 'status', 60);
  if (status) parts.push(`Sentry status ${status}`);
  const count = metadataStringFrom(meta, ['count', 'event_count'], 60);
  if (count) parts.push(`Sentry events ${count}`);
  const userCount = metadataStringFrom(meta, ['user_count', 'userCount', 'users'], 60);
  if (userCount) parts.push(`Sentry users ${userCount}`);
  const metadata = metadataObject(meta.metadata);
  const errorType = metadataString(metadata, 'type', 80);
  if (errorType) parts.push(`Sentry error type ${errorType}`);
  const errorValue = metadataString(metadata, 'value', 160);
  if (errorValue) parts.push(`Sentry error value ${errorValue}`);
  const filename = metadataString(metadata, 'filename', 160);
  if (filename) parts.push(`Sentry filename ${filename}`);
  return parts;
}

function renderGithubDetails(meta: Metadata): string[] {
  const github = metadataObject(meta.github);
  const parts: string[] = [];
  const type = metadataString(github, 'type');
  if (type) parts.push(`GitHub type ${type}`);
  const repo = metadataString(github, 'repo');
  if (repo) parts.push(`GitHub repo ${repo}`);
  const number = metadataString(github, 'number') ?? metadataString(github, 'pr_number');
  if (number) parts.push(`GitHub number ${number}`);
  const state = metadataString(github, 'state');
  if (state) parts.push(`GitHub state ${state}`);
  const base = metadataString(github, 'base');
  if (base) parts.push(`GitHub base ${base}`);
  const head = metadataString(github, 'head') ?? metadataString(github, 'head_branch');
  if (head) parts.push(`GitHub head ${head}`);
  const status = metadataString(github, 'status');
  if (status) parts.push(`GitHub status ${status}`);
  const conclusion = metadataString(github, 'conclusion');
  if (conclusion) parts.push(`GitHub conclusion ${conclusion}`);
  const event = metadataString(github, 'event');
  if (event) parts.push(`GitHub event ${event}`);
  const ref = metadataString(github, 'tag') ?? metadataString(github, 'sha');
  if (ref) parts.push(`GitHub ref ${ref}`);
  const draft = metadataValueString(github.draft);
  if (draft === 'true') parts.push('GitHub draft true');
  const prerelease = metadataValueString(github.prerelease);
  if (prerelease === 'true') parts.push('GitHub prerelease true');
  return parts;
}

function renderDriveDetails(meta: Metadata): string[] {
  const drive = metadataObject(meta.drive);
  const parts: string[] = [];
  const name = metadataString(drive, 'name');
  if (name) parts.push(`Drive file ${name}`);
  const mime = metadataString(drive, 'mime_type');
  if (mime) parts.push(`Drive mime ${mime}`);
  const modified = metadataString(drive, 'modified_time');
  if (modified) parts.push(`Drive modified ${modified}`);
  const driveId = metadataString(drive, 'drive_id');
  if (driveId) parts.push(`Drive shared drive ${driveId}`);
  const parents = metadataStringList(drive.parents);
  if (parents) parts.push(`Drive parents ${parents}`);
  return parts;
}

function renderTelegramContext(meta: Metadata): string | null {
  const parts = ['Telegram'];
  const chatType = metadataString(meta, 'tg_chat_type');
  if (chatType) parts.push(chatType === 'private' ? 'DM' : chatType);

  const senderName = metadataString(meta, 'tg_sender_name');
  const username = metadataString(meta, 'tg_username');
  const userId = metadataString(meta, 'tg_user_id');
  if (senderName) {
    parts.push(`sender ${senderName}`);
  } else if (username) {
    parts.push(`sender @${username.replace(/^@/, '')}`);
  } else if (userId) {
    parts.push(`sender Telegram user ${userId}`);
  }

  const chatTitle = metadataString(meta, 'tg_chat_title');
  const chatId = metadataString(meta, 'tg_chat_id');
  if (chatTitle) {
    parts.push(`chat ${chatTitle}`);
  } else if (chatId && chatType !== 'private') {
    parts.push(`chat ${chatId}`);
  }

  const caption = metadataString(meta, 'tg_caption', 240);
  if (caption) parts.push(`caption ${caption}`);

  return parts.length > 1 ? parts.join(' | ') : null;
}

function renderSlackContext(meta: Metadata): string | null {
  const parts = ['Slack'];
  const channelType = metadataString(meta, 'slack_channel_type');
  if (channelType) parts.push(channelType === 'im' ? 'DM' : channelType);

  const sender =
    metadataString(meta, 'slack_sender_name') ?? metadataString(meta, 'slack_sender_id');
  if (sender) parts.push(`sender ${sender}`);

  const channel =
    metadataString(meta, 'slack_channel_name') ?? metadataString(meta, 'slack_channel_id');
  if (channel && channelType !== 'im') parts.push(`conversation ${channel}`);

  const threadTs = metadataString(meta, 'slack_thread_ts');
  const messageTs = metadataString(meta, 'slack_message_ts');
  if (threadTs && threadTs !== messageTs) parts.push(`thread ${threadTs}`);

  const names = metadataAttachmentNames(meta);
  if (names.length > 0) parts.push(`attachments ${names.join(', ')}`);

  return parts.length > 1 ? parts.join(' | ') : null;
}

function renderWebContext(meta: Metadata): string | null {
  const parts = ['Web'];
  pushPart(parts, 'event', metadataStringFrom(meta, ['event_type', 'action', 'kind']));
  pushPart(parts, 'object', metadataStringFrom(meta, ['source_object_id', 'object_id']));
  pushPart(parts, 'url', metadataStringFrom(meta, ['url', 'web_url', 'source_url']));
  return parts.length > 1 ? parts.join(' | ') : null;
}

function renderMeetingContext(meta: Metadata): string | null {
  const parts = ['Meeting'];
  pushPart(parts, 'title', metadataStringFrom(meta, ['meeting_title', 'title'], 180));
  pushPart(parts, 'id', metadataString(meta, 'meeting_id'));
  pushPart(parts, 'platform', metadataString(meta, 'platform', 60));
  pushPart(parts, 'speakers', metadataStringList(meta.speakers, 8));
  pushPart(parts, 'duration minutes', metadataString(meta, 'duration_minutes', 30));
  pushPart(parts, 'chunks', metadataString(meta, 'chunk_count', 30));
  pushPart(parts, 'summary', metadataString(meta, 'summary', 240));
  const partialCapture = metadataValueString(meta.partial_capture);
  if (partialCapture === 'true') parts.push('partial capture true');
  return parts.length > 1 ? parts.join(' | ') : null;
}

function renderDocumentContext(meta: Metadata): string | null {
  const parts = ['Document'];
  pushPart(parts, 'action', metadataString(meta, 'action', 60));
  pushPart(parts, 'title', metadataStringFrom(meta, ['document_title', 'filename', 'name'], 180));
  pushPart(parts, 'id', metadataString(meta, 'document_id'));
  pushPart(parts, 'version', metadataString(meta, 'document_version_id'));
  pushPart(parts, 'folder', metadataString(meta, 'folder_id'));
  pushPart(parts, 'provider', metadataString(meta, 'integration_provider'));
  pushPart(parts, 'external object', metadataString(meta, 'integration_external_id'));
  return parts.length > 1 ? parts.join(' | ') : null;
}

function renderCalendarContext(meta: Metadata): string | null {
  const parts = ['Calendar'];
  pushPart(parts, 'title', metadataStringFrom(meta, ['calendar_title', 'title'], 180));
  pushPart(parts, 'action', metadataString(meta, 'action', 60));
  pushPart(parts, 'event', metadataString(meta, 'calendar_event_id'));
  pushPart(parts, 'meeting', metadataString(meta, 'meeting_id'));
  pushPart(parts, 'source', metadataString(meta, 'source', 60));
  return parts.length > 1 ? parts.join(' | ') : null;
}

function renderIngestWebhookContext(meta: Metadata): string | null {
  const parts = ['Ingest webhook'];
  pushPart(parts, 'name', metadataString(meta, 'ingest_webhook_name', 120));
  pushPart(parts, 'id', metadataString(meta, 'ingest_webhook_id'));
  pushPart(parts, 'dedup', metadataString(meta, 'ingest_webhook_dedup_key', 120));
  pushPart(parts, 'body sha256', metadataString(meta, 'ingest_webhook_body_sha256', 120));
  pushPart(parts, 'url', metadataStringFrom(meta, ['source_url', 'url']));
  return parts.length > 1 ? parts.join(' | ') : null;
}

function renderSystemContext(meta: Metadata): string | null {
  const parts = ['System'];
  pushPart(parts, 'kind', metadataStringFrom(meta, ['system_event_kind', 'kind', 'action'], 80));
  pushPart(parts, 'object', metadataString(meta, 'entity_id'));
  pushPart(parts, 'relationship', metadataString(meta, 'relationship_id'));
  pushPart(parts, 'note', metadataString(meta, 'note_id'));
  pushPart(parts, 'identity facet', metadataString(meta, 'identity_facet_id'));
  return parts.length > 1 ? parts.join(' | ') : null;
}

function renderEmailContext(meta: Metadata): string | null {
  const parts = ['Email'];
  const subject = metadataString(meta, 'subject', 180);
  if (subject) parts.push(`subject ${subject}`);

  const from = metadataPerson(meta.from);
  if (from) parts.push(`from ${from}`);

  const forwardedFrom = metadataObject(meta.forwarded_from);
  const forwardedSender = metadataPerson(forwardedFrom.from ?? meta.forwarded_from);
  if (forwardedSender) parts.push(`forwarded from ${forwardedSender}`);

  const names = metadataAttachmentNames(meta);
  if (names.length > 0) parts.push(`attachments ${names.join(', ')}`);

  return parts.length > 1 ? parts.join(' | ') : null;
}

const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
  google_drive: 'Google Drive',
  linear: 'Linear',
  monday: 'Monday.com',
  sentry: 'Sentry',
  slack: 'Slack',
};

const PROVIDER_CONTEXT_FIELDS: [string, string][] = [
  ['monday_workspace_name', 'Monday workspace'],
  ['monday_workspace_id', 'Monday workspace'],
  ['monday_board_name', 'Monday board'],
  ['monday_board_id', 'Monday board'],
  ['monday_item_name', 'Monday item'],
  ['monday_item_id', 'Monday item'],
  ['monday_parent_item_name', 'Monday parent item'],
  ['monday_parent_item_id', 'Monday parent item'],
  ['monday_record_kind', 'Monday record kind'],
  ['monday_doc_id', 'Monday doc'],
  ['monday_update_id', 'Monday update'],
  ['sentry_issue_id', 'Sentry issue'],
  ['sentry_short_id', 'Sentry short id'],
  ['sentry_org_slug', 'Sentry org'],
  ['sentry_project_slug', 'Sentry project'],
  ['github_repo', 'GitHub repo'],
  ['linear_identifier', 'Linear issue'],
];

function renderIntegrationContext(meta: Metadata): string | null {
  const provider = metadataString(meta, 'provider');
  const parts = [provider ? (PROVIDER_LABELS[provider] ?? provider) : 'Integration'];

  const eventType = metadataString(meta, 'event_type');
  if (eventType) parts.push(`event ${eventType}`);

  const externalObjectId = metadataString(meta, 'external_object_id');
  if (externalObjectId) parts.push(`external object ${externalObjectId}`);

  const externalEventId = metadataString(meta, 'external_event_id');
  if (externalEventId) parts.push(`external event ${externalEventId}`);

  const actor = metadataPerson(meta.actor);
  if (actor) parts.push(`actor ${actor}`);

  const url =
    metadataStringFrom(meta, ['url', 'web_url', 'html_url', 'external_url']) ??
    metadataPathString(meta, ['github', 'url']) ??
    metadataPathString(meta, ['linear', 'url']) ??
    metadataPathString(meta, ['drive', 'web_view_link']);
  if (url) parts.push(`url ${url}`);

  for (const [key, label] of PROVIDER_CONTEXT_FIELDS) {
    const value = metadataString(meta, key);
    if (value) parts.push(`${label} ${value}`);
  }
  parts.push(...renderMondayColumns(meta.monday_columns));
  parts.push(...renderSentryDetails(meta));
  parts.push(...renderGithubDetails(meta));

  const linear = metadataObject(meta.linear);
  const linearKind = metadataString(linear, 'kind');
  if (linearKind) parts.push(`Linear kind ${linearKind}`);
  const linearIdentifier =
    metadataString(linear, 'identifier') ?? metadataPathString(linear, ['issue', 'identifier']);
  if (linearIdentifier) parts.push(`Linear issue ${linearIdentifier}`);
  const linearTeam =
    metadataPathString(linear, ['team', 'name']) ?? metadataPathString(linear, ['team', 'key']);
  if (linearTeam) parts.push(`Linear team ${linearTeam}`);
  const linearProject = metadataPathString(linear, ['project', 'name']);
  if (linearProject) parts.push(`Linear project ${linearProject}`);
  const linearState =
    metadataPathString(linear, ['state', 'name']) ?? metadataString(linear, 'state');
  if (linearState) parts.push(`Linear state ${linearState}`);
  const linearPriority =
    metadataString(linear, 'priority_label') ?? metadataString(linear, 'priority');
  if (linearPriority) parts.push(`Linear priority ${linearPriority}`);
  const linearParent =
    metadataPathString(linear, ['parent', 'identifier']) ??
    metadataPathString(linear, ['parent', 'title']) ??
    metadataString(linear, 'parent');
  if (linearParent) parts.push(`Linear parent ${linearParent}`);

  parts.push(...renderDriveDetails(meta));

  return parts.length > 1 ? parts.join(' | ') : null;
}

function renderReplayContext(meta: Metadata): string | null {
  const parts: string[] = [];
  pushPart(parts, 'source ref', truncateMetadataValue(sourcePayloadRefFromMetadata(meta), 160));
  pushPart(parts, 'payload digest', truncateMetadataValue(payloadDigestFromMetadata(meta), 120));
  return parts.length > 0 ? parts.join(' | ') : null;
}

function appendContext(context: string | null, extra: string | null): string | null {
  if (!context) return extra;
  if (!extra) return context;
  return `${context} | ${extra}`;
}

function truncateMetadataValue(value: string | null, max: number): string | null {
  return value ? metadataString({ value }, 'value', max) : null;
}

/**
 * Render source metadata that changes the meaning of a raw event into the text
 * sent to extraction and embedding. `content_text` remains the exact captured
 * body; this helper only enriches the model-facing view.
 */
export function renderRawEventForAi(input: RawEventForAiInput): string | null {
  const body = input.contentText?.trim();
  if (!body) return null;

  const meta = metadataObject(input.sourceMetadata);
  let context: string | null;
  switch (input.source) {
    case 'telegram':
      context = renderTelegramContext(meta);
      break;
    case 'slack':
      context = renderSlackContext(meta);
      break;
    case 'email':
      context = renderEmailContext(meta);
      break;
    case 'web':
      context = renderWebContext(meta);
      break;
    case 'meeting':
      context = renderMeetingContext(meta);
      break;
    case 'document':
      context = renderDocumentContext(meta);
      break;
    case 'calendar':
      context = renderCalendarContext(meta);
      break;
    case 'ingest_webhook':
      context = renderIngestWebhookContext(meta);
      break;
    case 'system':
      context = renderSystemContext(meta);
      break;
    case 'integration':
      context = renderIntegrationContext(meta);
      break;
    default:
      context = null;
  }
  context = appendContext(context, renderReplayContext(meta));
  if (!context) return body;

  return `Source context: ${context}\n\nMessage:\n${body}`;
}
