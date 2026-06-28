import { documentKindLabel, truncateFilenameMiddle } from '@timeline/shared/documents/presentation';

import type { TimelineArtifactCluster, TimelineEvent } from '@/lib/use-paginated-queries';

import { displayText } from '@/lib/display-dates';

export type ImpactKind =
  | 'task'
  | 'board'
  | 'object'
  | 'calendar'
  | 'document'
  | 'decision'
  | 'approval';

export interface ImpactItem {
  kind: ImpactKind;
  label: string;
  href?: string;
  count?: number;
  status?: string;
  sourceEventId?: string;
}

export interface TimelineMoment {
  id: string;
  dateKey: string;
  dateLabel: string;
  timeLabel: string;
  source: TimelineEvent['source'];
  sourceLabel: string;
  sourceIcon: string;
  actorLabel: string;
  contextLabel: string;
  summary: string;
  rawEvents: TimelineEvent[];
  impactItems: ImpactItem[];
  artifactClusters: TimelineArtifactCluster[];
}

export interface TimelineAuthor {
  id: string;
  name: string | null;
  email: string;
}

export type TimelineImpactFilter = ImpactKind | ImpactKind[] | 'all';

interface BuildTimelineMomentOptions {
  now?: Date;
  impactItemsByEventId?: Record<string, ImpactItem[]>;
  artifactClustersByEventId?: Record<string, TimelineArtifactCluster>;
  timezone?: string;
}

const SOURCE_LABEL: Record<TimelineEvent['source'], string> = {
  web: 'Web',
  telegram: 'Telegram',
  email: 'Email',
  system: 'System',
  document: 'Document',
  meeting: 'Meeting',
  integration: 'Integration',
  ingest_webhook: 'Ingest webhook',
  calendar: 'Calendar',
  slack: 'Slack',
};

const SOURCE_ICON: Record<TimelineEvent['source'], string> = {
  web: 'note',
  telegram: 'message',
  email: 'mail',
  system: 'system',
  document: 'document',
  meeting: 'meeting',
  integration: 'integration',
  ingest_webhook: 'webhook',
  calendar: 'calendar',
  slack: 'slack',
};

function eventDate(input: Date | string): Date {
  return input instanceof Date ? input : new Date(input);
}

function metaObject(meta: unknown): Record<string, unknown> {
  return typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : {};
}

function stringMeta(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function displayMeta(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  if (typeof value === 'string') return value.trim().length > 0 ? value : null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function telegramUsernameLabel(meta: Record<string, unknown>): string | null {
  const username = stringMeta(meta, 'tg_username');
  return username ? `@${username.replace(/^@/, '')}` : null;
}

function formatAddress(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const email = typeof record.email === 'string' ? record.email : null;
  if (!email) return null;
  const name = typeof record.name === 'string' && record.name ? record.name : null;
  return name ? `${name} <${email}>` : email;
}

function dateKey(input: Date | string, timezone?: string): string {
  return eventDate(input).toLocaleDateString('en-CA', { timeZone: timezone });
}

function previousDateKey(key: string): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function formatDateSection(
  input: Date | string,
  now = new Date(),
  timezone?: string,
): string {
  const d = eventDate(input);
  const today = dateKey(now, timezone);
  const key = dateKey(d, timezone);
  if (key === today) return 'Today';
  if (key === previousDateKey(today)) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: key.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
    timeZone: timezone,
  });
}

function formatTime(input: Date | string, timezone?: string): string {
  return eventDate(input).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  });
}

function timeLabel(events: TimelineEvent[], timezone?: string): string {
  const sorted = [...events].sort(
    (a: TimelineEvent, b: TimelineEvent) =>
      eventDate(a.occurredAt).getTime() - eventDate(b.occurredAt).getTime(),
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || first.id === last.id)
    return first ? formatTime(first.occurredAt, timezone) : '';
  const start = formatTime(first.occurredAt, timezone);
  const end = formatTime(last.occurredAt, timezone);
  return start === end ? start : `${start}-${end}`;
}

function fifteenMinuteBucket(input: Date | string, timezone?: string): string {
  const [hour = '00', rawMinute = '00'] = eventDate(input)
    .toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    })
    .split(':');
  const minute = Number(rawMinute);
  const bucket = Math.floor(minute / 15) * 15;
  return `${hour.padStart(2, '0')}:${String(bucket).padStart(2, '0')}`;
}

export function timelineGroupKey(event: TimelineEvent, timezone?: string): string {
  const meta = metaObject(event.sourceMetadata);
  if (event.source === 'meeting') {
    return `meeting:${stringMeta(meta, 'meeting_id') ?? event.id}`;
  }
  if (event.source === 'email') {
    return `email:${stringMeta(meta, 'thread_root_id') ?? event.id}`;
  }
  if (event.source === 'slack') {
    const channel = stringMeta(meta, 'slack_channel_id') ?? stringMeta(meta, 'slack_channel_name');
    const thread = stringMeta(meta, 'slack_thread_ts') ?? stringMeta(meta, 'slack_message_ts');
    return channel && thread ? `slack:${channel}:${thread}` : `slack:${event.id}`;
  }
  if (event.source === 'telegram') {
    const chat = displayMeta(meta, 'tg_chat_id') ?? stringMeta(meta, 'tg_chat_title');
    return chat
      ? `telegram:${chat}:${dateKey(event.occurredAt, timezone)}:${fifteenMinuteBucket(
          event.occurredAt,
          timezone,
        )}`
      : `telegram:${event.id}`;
  }
  if (event.source === 'calendar') {
    return `calendar:${stringMeta(meta, 'calendar_event_id') ?? event.id}`;
  }
  if (event.source === 'document') {
    const doc = stringMeta(meta, 'document_id') ?? stringMeta(meta, 'documentId');
    const action = stringMeta(meta, 'action') ?? 'activity';
    return doc
      ? `document:${doc}:${dateKey(event.occurredAt, timezone)}:${action}`
      : `document:${event.id}`;
  }
  if (event.source === 'integration') {
    const provider = stringMeta(meta, 'provider') ?? 'provider';
    const external =
      stringMeta(meta, 'external_object_id') ?? stringMeta(meta, 'external_event_id');
    return external ? `integration:${provider}:${external}` : `integration:${event.id}`;
  }
  if (event.source === 'ingest_webhook') {
    const webhook = stringMeta(meta, 'ingest_webhook_id') ?? 'webhook';
    return `ingest_webhook:${webhook}:${dateKey(event.occurredAt, timezone)}:${fifteenMinuteBucket(
      event.occurredAt,
      timezone,
    )}`;
  }
  return `${event.source}:${event.id}`;
}

export function meetingDetailHrefForMoment(
  moment: Pick<TimelineMoment, 'source' | 'rawEvents'>,
): string | null {
  if (moment.source !== 'meeting') return null;
  for (const event of moment.rawEvents) {
    const meta = metaObject(event.sourceMetadata);
    const meetingId = stringMeta(meta, 'meeting_id');
    if (meetingId) return `/app/meetings/${meetingId}`;
  }
  return null;
}

function parentRawEventId(event: TimelineEvent): string | null {
  const meta = metaObject(event.sourceMetadata);
  return (
    stringMeta(meta, 'parent_raw_event_id') ??
    stringMeta(meta, 'tg_parent_raw_event_id') ??
    stringMeta(meta, 'slack_parent_raw_event_id')
  );
}

function authorName(event: TimelineEvent, authorMap: Map<string, TimelineAuthor>): string | null {
  if (!event.authorUserId) return null;
  const author = authorMap.get(event.authorUserId);
  return author ? (author.name ?? author.email) : null;
}

function actorLabel(event: TimelineEvent, authorMap: Map<string, TimelineAuthor>): string {
  const meta = metaObject(event.sourceMetadata);
  if (event.source === 'slack') {
    return stringMeta(meta, 'slack_sender_name') ?? authorName(event, authorMap) ?? 'Slack sender';
  }
  if (event.source === 'telegram') {
    return (
      stringMeta(meta, 'tg_sender_name') ??
      telegramUsernameLabel(meta) ??
      authorName(event, authorMap) ??
      'Telegram sender'
    );
  }
  if (event.source === 'email') {
    return formatAddress(meta.from) ?? authorName(event, authorMap) ?? 'Email sender';
  }
  if (event.source === 'meeting') {
    const speakers = meta.speakers;
    return Array.isArray(speakers) && speakers.length > 0
      ? speakers
          .filter((v): v is string => typeof v === 'string')
          .slice(0, 3)
          .join(', ')
      : (authorName(event, authorMap) ?? 'Meeting');
  }
  if (event.source === 'integration') {
    const actor = meta.actor;
    return typeof actor === 'string' ? actor : (authorName(event, authorMap) ?? 'Integration');
  }
  return authorName(event, authorMap) ?? SOURCE_LABEL[event.source];
}

function telegramSourceActorLabel(event: TimelineEvent): string | null {
  if (event.source !== 'telegram') return null;
  const meta = metaObject(event.sourceMetadata);
  return stringMeta(meta, 'tg_sender_name') ?? telegramUsernameLabel(meta);
}

function displayLeadForGroup(sorted: TimelineEvent[], fallback: TimelineEvent): TimelineEvent {
  return (
    sorted.find((event) => event.source === 'telegram' || event.source === 'slack') ?? fallback
  );
}

export function actorLabelsByTelegramUserId(events: TimelineEvent[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const event of events) {
    if (event.source !== 'telegram') continue;
    const meta = metaObject(event.sourceMetadata);
    const userId = displayMeta(meta, 'tg_user_id');
    const label = stringMeta(meta, 'tg_sender_name') ?? telegramUsernameLabel(meta);
    if (userId && label && !labels.has(userId)) labels.set(userId, label);
  }
  return labels;
}

function actorLabelForGroup(
  event: TimelineEvent,
  group: TimelineEvent[],
  authorMap: Map<string, TimelineAuthor>,
): string {
  if (event.source !== 'telegram') return actorLabel(event, authorMap);
  const meta = metaObject(event.sourceMetadata);
  const direct = telegramSourceActorLabel(event);
  if (direct) return direct;
  const userId = displayMeta(meta, 'tg_user_id');
  const label = userId ? actorLabelsByTelegramUserId(group).get(userId) : null;
  return label ?? actorLabel(event, authorMap);
}

function contextLabel(event: TimelineEvent, timezone?: string): string {
  const meta = metaObject(event.sourceMetadata);
  const label = (value: string | null | undefined, fallback: string) =>
    value ? displayText(value, { timezone }) : fallback;
  if (event.source === 'slack') {
    return label(
      stringMeta(meta, 'slack_channel_name') ?? stringMeta(meta, 'slack_channel_id'),
      'Slack',
    );
  }
  if (event.source === 'telegram') {
    return label(stringMeta(meta, 'tg_chat_title') ?? stringMeta(meta, 'tg_chat_type'), 'Telegram');
  }
  if (event.source === 'email') {
    return label(stringMeta(meta, 'subject'), 'Email thread');
  }
  if (event.source === 'meeting') return label(stringMeta(meta, 'title'), 'Meeting transcript');
  if (event.source === 'calendar') return label(stringMeta(meta, 'title'), 'Calendar event');
  if (event.source === 'document') {
    return label(stringMeta(meta, 'document_name') ?? stringMeta(meta, 'name'), 'Document');
  }
  if (event.source === 'integration') {
    const provider = label(stringMeta(meta, 'provider'), 'Integration');
    const type = stringMeta(meta, 'event_type');
    return type ? `${provider} · ${type}` : provider;
  }
  if (event.source === 'ingest_webhook') {
    return label(stringMeta(meta, 'ingest_webhook_name'), 'Ingest webhook');
  }
  return SOURCE_LABEL[event.source];
}

function summaryForEvent(event: TimelineEvent, timezone?: string): string {
  const meta = metaObject(event.sourceMetadata);
  const content = event.contentText?.trim();
  if (event.source === 'meeting') {
    const summary = stringMeta(meta, 'summary');
    if (summary) return displayText(summary, { timezone });
  }
  if (event.source === 'email') {
    const subject = stringMeta(meta, 'subject');
    if (subject && content)
      return displayText(`${subject}: ${formatTimelineAttachmentText(content)}`, {
        timezone,
      });
  }
  if (content) return displayText(formatTimelineAttachmentText(content), { timezone });
  const attachmentSummary = timelineAttachmentSummaryFromMetadata(meta);
  if (attachmentSummary) return displayText(attachmentSummary, { timezone });
  if (event.contentAudioUrl) return 'Voice memo captured; transcript pending or unavailable.';
  return 'Source event captured.';
}

function truncateAttachedFilenameText(text: string): string {
  const match = /^(Attached (?:image|file) )(.+)$/i.exec(text.trim());
  if (!match) return text;
  return `${match[1] ?? ''}${truncateFilenameMiddle(match[2] ?? '')}`;
}

export function formatTimelineAttachmentText(text: string): string {
  return truncateLongFilenamesInText(truncateAttachedFilenameText(text));
}

function truncateLongFilenamesInText(text: string): string {
  return text.replace(/\b[A-Za-z0-9_+=/@-]{24,}\.[A-Za-z0-9]{2,8}\b/g, (filename) =>
    truncateFilenameMiddle(filename),
  );
}

export function timelineAttachmentSummaryFromMetadata(
  meta: Record<string, unknown>,
): string | null {
  const attachments = meta.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) return null;
  const labels = attachments
    .map(attachmentLabel)
    .filter((label): label is string => Boolean(label))
    .slice(0, 2);
  if (labels.length === 0) return null;
  if (attachments.length === 1) return labels[0] ?? null;
  const remainder = attachments.length - labels.length;
  return `${String(attachments.length)} attachments · ${labels.join(', ')}${
    remainder > 0 ? `, +${String(remainder)}` : ''
  }`;
}

function attachmentLabel(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const filename = stringMeta(record, 'filename') ?? stringMeta(record, 'name');
  if (!filename) return null;
  const contentType =
    stringMeta(record, 'content_type') ??
    stringMeta(record, 'contentType') ??
    stringMeta(record, 'mimetype') ??
    stringMeta(record, 'mime_type');
  const kind = documentKindLabel(contentType);
  const noun = kind === 'image' ? 'image' : 'file';
  return `Attached ${noun} ${truncateFilenameMiddle(filename)}`;
}

function clipped(text: string, max = 220): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function impactItemsForEvent(
  event: TimelineEvent,
  options: { includeVisibilityScopedMetadata: boolean; timezone?: string } = {
    includeVisibilityScopedMetadata: true,
  },
): ImpactItem[] {
  const meta = metaObject(event.sourceMetadata);
  const items: ImpactItem[] = [];
  if (event.source === 'meeting') {
    const actionItems = meta.action_items;
    if (Array.isArray(actionItems) && actionItems.length > 0) {
      items.push({
        kind: 'task',
        label: `${String(actionItems.length)} action item${actionItems.length === 1 ? '' : 's'}`,
        count: actionItems.length,
        sourceEventId: event.id,
      });
    }
    if (stringMeta(meta, 'summary')) {
      items.push({ kind: 'decision', label: 'Summary extracted', sourceEventId: event.id });
    }
  }
  if (
    options.includeVisibilityScopedMetadata &&
    (event.source === 'calendar' || stringMeta(meta, 'calendar_event_id'))
  ) {
    const calendarId = stringMeta(meta, 'calendar_event_id');
    items.push({
      kind: 'calendar',
      label: displayText(stringMeta(meta, 'title') ?? 'Calendar event', {
        timezone: options.timezone,
      }),
      href: calendarId ? '/app/calendar' : undefined,
      sourceEventId: event.id,
    });
  }
  if (
    options.includeVisibilityScopedMetadata &&
    (event.source === 'document' ||
      stringMeta(meta, 'document_id') ||
      stringMeta(meta, 'documentId'))
  ) {
    const documentId = stringMeta(meta, 'document_id') ?? stringMeta(meta, 'documentId');
    items.push({
      kind: 'document',
      label: stringMeta(meta, 'document_name') ?? stringMeta(meta, 'name') ?? 'Document',
      href: documentId ? `/app/documents/${documentId}` : undefined,
      sourceEventId: event.id,
    });
  }
  if (
    event.source === 'integration' &&
    (stringMeta(meta, 'external_object_id') || stringMeta(meta, 'provider'))
  ) {
    items.push({
      kind: 'object',
      label:
        stringMeta(meta, 'external_object_id') ?? stringMeta(meta, 'provider') ?? 'External object',
      sourceEventId: event.id,
    });
  }
  const attachments = meta.attachments;
  if (Array.isArray(attachments) && attachments.length > 0) {
    items.push({
      kind: 'document',
      label: `${String(attachments.length)} attachment${attachments.length === 1 ? '' : 's'}`,
      count: attachments.length,
      sourceEventId: event.id,
    });
  }
  return items;
}

function dedupeImpact(items: ImpactItem[]): ImpactItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.label}:${item.href ?? ''}:${item.status ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeArtifactClusters(clusters: TimelineArtifactCluster[]): TimelineArtifactCluster[] {
  const seen = new Set<string>();
  return clusters.filter((cluster) => {
    if (seen.has(cluster.id)) return false;
    seen.add(cluster.id);
    return true;
  });
}

export function buildTimelineMoments(
  events: TimelineEvent[],
  authorMap: Map<string, TimelineAuthor>,
  options: Date | BuildTimelineMomentOptions = {},
): TimelineMoment[] {
  const now = options instanceof Date ? options : (options.now ?? new Date());
  const hydrated = options instanceof Date ? {} : (options.impactItemsByEventId ?? {});
  const artifactClustersByEventId =
    options instanceof Date ? {} : (options.artifactClustersByEventId ?? {});
  const timezone = options instanceof Date ? undefined : options.timezone;
  const hasAuthoritativeHydration =
    !(options instanceof Date) && options.impactItemsByEventId !== undefined;
  const groups = new Map<string, TimelineEvent[]>();
  const baseGroupKeyByEventId = new Map(
    events.map((event) => [
      event.id,
      `${dateKey(event.occurredAt, timezone)}:${timelineGroupKey(event, timezone)}`,
    ]),
  );
  for (const event of events) {
    const parentId = parentRawEventId(event);
    const key =
      (parentId ? baseGroupKeyByEventId.get(parentId) : undefined) ??
      baseGroupKeyByEventId.get(event.id);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) existing.push(event);
    else groups.set(key, [event]);
  }

  return Array.from(groups.entries())
    .flatMap(([key, group]) => {
      const sorted = [...group].sort(
        (a: TimelineEvent, b: TimelineEvent) =>
          eventDate(b.occurredAt).getTime() - eventDate(a.occurredAt).getTime(),
      );
      const lead = sorted[0];
      if (!lead) return [];
      const displayLead = displayLeadForGroup(sorted, lead);
      const summary =
        sorted.length === 1
          ? summaryForEvent(lead, timezone)
          : sorted
              .map((event) => summaryForEvent(event, timezone))
              .slice(0, 3)
              .join(' / ');
      return [
        {
          id: `moment:${key}`,
          dateKey: dateKey(lead.occurredAt, timezone),
          dateLabel: formatDateSection(lead.occurredAt, now, timezone),
          timeLabel: timeLabel(sorted, timezone),
          source: displayLead.source,
          sourceLabel: SOURCE_LABEL[displayLead.source],
          sourceIcon: SOURCE_ICON[displayLead.source],
          actorLabel: actorLabelForGroup(displayLead, sorted, authorMap),
          contextLabel: contextLabel(displayLead, timezone),
          summary: clipped(summary),
          rawEvents: sorted,
          impactItems: dedupeImpact(
            sorted.flatMap((event) => [
              ...(hydrated[event.id] ?? []),
              ...impactItemsForEvent(event, {
                includeVisibilityScopedMetadata: !hasAuthoritativeHydration,
                timezone,
              }),
            ]),
          ),
          artifactClusters: dedupeArtifactClusters(
            sorted
              .map((event) => artifactClustersByEventId[event.id])
              .filter((cluster): cluster is TimelineArtifactCluster => Boolean(cluster)),
          ),
        },
      ];
    })
    .sort(
      (a, b) =>
        eventDate(b.rawEvents[0]?.occurredAt ?? new Date(0)).getTime() -
        eventDate(a.rawEvents[0]?.occurredAt ?? new Date(0)).getTime(),
    );
}

export function filterTimelineMomentsByImpact(
  moments: TimelineMoment[],
  impactFilter: TimelineImpactFilter,
): TimelineMoment[] {
  if (impactFilter === 'all' || (Array.isArray(impactFilter) && impactFilter.length === 0)) {
    return moments;
  }
  const allowed = new Set(Array.isArray(impactFilter) ? impactFilter : [impactFilter]);
  return moments.filter((moment) => moment.impactItems.some((item) => allowed.has(item.kind)));
}
