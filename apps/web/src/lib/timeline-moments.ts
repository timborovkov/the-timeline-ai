import type { TimelineEvent } from '@/lib/use-paginated-queries';

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
}

export interface TimelineAuthor {
  id: string;
  name: string | null;
  email: string;
}

export type TimelineImpactFilter = ImpactKind | 'all';

interface BuildTimelineMomentOptions {
  now?: Date;
  impactItemsByEventId?: Record<string, ImpactItem[]>;
}

const SOURCE_LABEL: Record<TimelineEvent['source'], string> = {
  web: 'Web',
  telegram: 'Telegram',
  email: 'Email',
  system: 'System',
  document: 'Document',
  meeting: 'Meeting',
  integration: 'Integration',
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

function dateKey(input: Date | string): string {
  return eventDate(input).toLocaleDateString('en-CA');
}

export function formatDateSection(input: Date | string, now = new Date()): string {
  const d = eventDate(input);
  const today = dateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const key = dateKey(d);
  if (key === today) return 'Today';
  if (key === dateKey(yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

function formatTime(input: Date | string): string {
  return eventDate(input).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function timeLabel(events: TimelineEvent[]): string {
  const sorted = [...events].sort(
    (a, b) => eventDate(a.occurredAt).getTime() - eventDate(b.occurredAt).getTime(),
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || first.id === last.id) return first ? formatTime(first.occurredAt) : '';
  const start = formatTime(first.occurredAt);
  const end = formatTime(last.occurredAt);
  return start === end ? start : `${start}-${end}`;
}

function fifteenMinuteBucket(input: Date | string): string {
  const d = eventDate(input);
  const bucket = Math.floor(d.getMinutes() / 15) * 15;
  return `${String(d.getHours()).padStart(2, '0')}:${String(bucket).padStart(2, '0')}`;
}

export function timelineGroupKey(event: TimelineEvent): string {
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
      ? `telegram:${chat}:${dateKey(event.occurredAt)}:${fifteenMinuteBucket(event.occurredAt)}`
      : `telegram:${event.id}`;
  }
  if (event.source === 'calendar') {
    return `calendar:${stringMeta(meta, 'calendar_event_id') ?? event.id}`;
  }
  if (event.source === 'document') {
    const doc = stringMeta(meta, 'document_id') ?? stringMeta(meta, 'documentId');
    const action = stringMeta(meta, 'action') ?? 'activity';
    return doc ? `document:${doc}:${dateKey(event.occurredAt)}:${action}` : `document:${event.id}`;
  }
  if (event.source === 'integration') {
    const provider = stringMeta(meta, 'provider') ?? 'provider';
    const external =
      stringMeta(meta, 'external_object_id') ?? stringMeta(meta, 'external_event_id');
    return external ? `integration:${provider}:${external}` : `integration:${event.id}`;
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
  const direct = actorLabel(event, new Map());
  if (direct !== 'Telegram sender') return direct;
  const userId = displayMeta(meta, 'tg_user_id');
  const label = userId ? actorLabelsByTelegramUserId(group).get(userId) : null;
  return label ?? actorLabel(event, authorMap);
}

function contextLabel(event: TimelineEvent): string {
  const meta = metaObject(event.sourceMetadata);
  if (event.source === 'slack') {
    return (
      stringMeta(meta, 'slack_channel_name') ?? stringMeta(meta, 'slack_channel_id') ?? 'Slack'
    );
  }
  if (event.source === 'telegram') {
    return stringMeta(meta, 'tg_chat_title') ?? stringMeta(meta, 'tg_chat_type') ?? 'Telegram';
  }
  if (event.source === 'email') {
    return stringMeta(meta, 'subject') ?? 'Email thread';
  }
  if (event.source === 'meeting') return stringMeta(meta, 'title') ?? 'Meeting transcript';
  if (event.source === 'calendar') return stringMeta(meta, 'title') ?? 'Calendar event';
  if (event.source === 'document') {
    return stringMeta(meta, 'document_name') ?? stringMeta(meta, 'name') ?? 'Document';
  }
  if (event.source === 'integration') {
    const provider = stringMeta(meta, 'provider') ?? 'Integration';
    const type = stringMeta(meta, 'event_type');
    return type ? `${provider} · ${type}` : provider;
  }
  return SOURCE_LABEL[event.source];
}

function summaryForEvent(event: TimelineEvent): string {
  const meta = metaObject(event.sourceMetadata);
  if (event.source === 'meeting') {
    const summary = stringMeta(meta, 'summary');
    if (summary) return summary;
  }
  if (event.source === 'email') {
    const subject = stringMeta(meta, 'subject');
    if (subject && event.contentText) return `${subject}: ${event.contentText}`;
  }
  const content = event.contentText?.trim();
  if (content) return content;
  if (event.contentAudioUrl) return 'Voice memo captured; transcript pending or unavailable.';
  return 'Source event captured.';
}

function clipped(text: string, max = 220): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function impactItemsForEvent(
  event: TimelineEvent,
  options: { includeVisibilityScopedMetadata: boolean } = {
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
      label: stringMeta(meta, 'title') ?? 'Calendar event',
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

export function buildTimelineMoments(
  events: TimelineEvent[],
  authorMap: Map<string, TimelineAuthor>,
  options: Date | BuildTimelineMomentOptions = {},
): TimelineMoment[] {
  const now = options instanceof Date ? options : (options.now ?? new Date());
  const hydrated = options instanceof Date ? {} : (options.impactItemsByEventId ?? {});
  const hasAuthoritativeHydration =
    !(options instanceof Date) && options.impactItemsByEventId !== undefined;
  const groups = new Map<string, TimelineEvent[]>();
  const baseGroupKeyByEventId = new Map(
    events.map((event) => [event.id, `${dateKey(event.occurredAt)}:${timelineGroupKey(event)}`]),
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
        (a, b) => eventDate(b.occurredAt).getTime() - eventDate(a.occurredAt).getTime(),
      );
      const lead = sorted[0];
      if (!lead) return [];
      const displayLead = displayLeadForGroup(sorted, lead);
      const summary =
        sorted.length === 1
          ? summaryForEvent(lead)
          : sorted.map(summaryForEvent).slice(0, 3).join(' / ');
      return [
        {
          id: `moment:${key}`,
          dateKey: dateKey(lead.occurredAt),
          dateLabel: formatDateSection(lead.occurredAt, now),
          timeLabel: timeLabel(sorted),
          source: displayLead.source,
          sourceLabel: SOURCE_LABEL[displayLead.source],
          sourceIcon: SOURCE_ICON[displayLead.source],
          actorLabel: actorLabelForGroup(displayLead, sorted, authorMap),
          contextLabel: contextLabel(displayLead),
          summary: clipped(summary),
          rawEvents: sorted,
          impactItems: dedupeImpact(
            sorted.flatMap((event) => [
              ...(hydrated[event.id] ?? []),
              ...impactItemsForEvent(event, {
                includeVisibilityScopedMetadata: !hasAuthoritativeHydration,
              }),
            ]),
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
  if (impactFilter === 'all') return moments;
  return moments.filter((moment) => moment.impactItems.some((item) => item.kind === impactFilter));
}
