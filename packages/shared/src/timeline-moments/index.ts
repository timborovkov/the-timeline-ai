import { documentKindLabel, truncateFilenameMiddle } from '#src/documents/presentation.js';

const ISO_INSTANT_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z\b/g;
const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
  linear: 'Linear',
  jira: 'Jira',
  asana: 'Asana',
  trello: 'Trello',
  basecamp: 'Basecamp',
  sentry: 'Sentry',
  datadog: 'Datadog',
  slack: 'Slack',
  monday: 'Monday.com',
  monday_com: 'Monday.com',
  google_drive: 'Google Drive',
  drive: 'Google Drive',
  notion: 'Notion',
  confluence: 'Confluence',
  figma: 'Figma',
  salesforce: 'Salesforce',
  hubspot: 'HubSpot',
  pipedrive: 'Pipedrive',
  attio: 'Attio',
  close: 'Close',
  zendesk: 'Zendesk',
  intercom: 'Intercom',
};

interface DisplayDateOptions {
  timezone?: string | undefined;
}

function formatDisplayDateTime(value: Date | string, options: DisplayDateOptions = {}): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: options.timezone,
  });
}

function displayText(value: string, options: DisplayDateOptions = {}): string {
  return value.replace(ISO_INSTANT_PATTERN, (match) => formatDisplayDateTime(match, options));
}

function titleCaseWords(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function providerDisplayName(provider: string | null | undefined): string {
  if (!provider) return 'Integration';
  const normalized = provider.trim().toLowerCase();
  return PROVIDER_LABELS[normalized] ?? titleCaseWords(provider);
}

export type TimelineEventSource =
  | 'web'
  | 'telegram'
  | 'email'
  | 'system'
  | 'document'
  | 'meeting'
  | 'integration'
  | 'ingest_webhook'
  | 'calendar'
  | 'slack';

export interface TimelineMomentEvent {
  id: string;
  teamId?: string | undefined;
  authorUserId: string | null;
  contentText: string | null;
  contentAudioUrl: string | null;
  occurredAt: Date | string;
  createdAt?: Date | string | undefined;
  visibility?: string | undefined;
  visibilityUserIds?: string[] | null | undefined;
  visibilityOwnerUserId?: string | null | undefined;
  sourceMetadata: unknown;
  source: TimelineEventSource;
}

export interface TimelineArtifactCluster {
  id: string;
  artifactType: string;
  canonicalName: string;
  status: string;
  relatedEvidence: {
    rawEventId: string | null;
    source: TimelineEventSource | null;
    provider: string | null;
    externalObjectId: string | null;
    role: string;
    strength: string;
    authoritative: boolean;
    occurredAt: string | null;
    snippet: string | null;
  }[];
}

export type TimelineEvent = TimelineMomentEvent;

export type ImpactKind =
  | 'task'
  | 'board'
  | 'object'
  | 'calendar'
  | 'document'
  | 'decision'
  | 'approval';

export type TimelineMomentKind =
  | 'conversation'
  | 'meeting'
  | 'email_thread'
  | 'calendar'
  | 'document'
  | 'code_review'
  | 'ci_deploy'
  | 'incident'
  | 'integration_activity'
  | 'webhook'
  | 'system'
  | 'note';

export type TimelineMomentConfidence = 'deterministic' | 'ai_suggested' | 'user_confirmed';
export type TimelineMomentVersion = 'timeline_moment.v1';
export type TimelineMomentsPageVersion = 'timeline_moments_page.v1';
export type TimelineGroupingVersion = 'timeline_grouping.v1';

export type TimelineMomentDto<
  TEvent extends TimelineMomentEvent = TimelineMomentEvent,
  TArtifactCluster extends TimelineArtifactCluster = TimelineArtifactCluster,
> = Omit<TimelineMoment<TEvent, TArtifactCluster>, 'rawEvents'> & {
  rawEventIds: string[];
};

export interface TimelineMomentLookupPlan {
  source: TimelineEventSource;
  from?: Date | undefined;
  to?: Date | undefined;
  limit: number;
  metadataPredicates?: TimelineMomentMetadataPredicate[] | undefined;
  metadataPredicateGroups?: TimelineMomentMetadataPredicate[][] | undefined;
}

export interface TimelineMomentMetadataPredicate {
  path: string[];
  equals: string;
}

export interface TimelineMomentDiagnostic {
  code: 'missing_grouping_metadata';
  severity: 'warning';
  source: TimelineEventSource;
  provider: string | null;
  eventId: string;
  missingFields: string[];
  groupingKey: string;
  groupingStrategy: string;
  message: string;
}

export interface ImpactItem {
  kind: ImpactKind;
  label: string;
  href?: string | undefined;
  count?: number | undefined;
  status?: string | undefined;
  sourceEventId?: string | undefined;
}

export interface TimelineMoment<
  TEvent extends TimelineMomentEvent = TimelineMomentEvent,
  TArtifactCluster extends TimelineArtifactCluster = TimelineArtifactCluster,
> {
  id: string;
  version: TimelineMomentVersion;
  anchorId: string;
  kind: TimelineMomentKind;
  dateKey: string;
  dateLabel: string;
  timeLabel: string;
  source: TEvent['source'];
  sourceLabel: string;
  sourceIcon: string;
  actorLabel: string;
  contextLabel: string;
  title: string;
  subtitle: string | null;
  preview: string | null;
  confidence: TimelineMomentConfidence;
  grouping: {
    strategy: string;
    key: string;
    sourceFamilies: TEvent['source'][];
  };
  evidenceSummary: {
    rawEventCount: number;
    sourceLabels: string[];
    actorLabels: string[];
    contextLabels: string[];
    timeRange: string;
  };
  summary: string;
  rawEvents: TEvent[];
  impactItems: ImpactItem[];
  artifactClusters: TArtifactCluster[];
}

export interface TimelineAuthor {
  id: string;
  name: string | null;
  email: string;
}

export type TimelineImpactFilter = ImpactKind | ImpactKind[] | 'all';

export interface BuildTimelineMomentOptions<
  TArtifactCluster extends TimelineArtifactCluster = TimelineArtifactCluster,
> {
  now?: Date;
  impactItemsByEventId?: Record<string, ImpactItem[]>;
  artifactClustersByEventId?: Record<string, TArtifactCluster>;
  timezone?: string | undefined;
  groupingMode?: 'moments' | 'events' | undefined;
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

function numberMeta(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nestedRecord(meta: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = meta[key];
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function metadataValueExists(meta: Record<string, unknown>, key: string): boolean {
  const value = meta[key];
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return value !== null && value !== undefined;
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

function humanList(items: string[], empty: string, limit = 3): string {
  if (items.length === 0) return empty;
  const visible = items.slice(0, limit);
  const extra = items.length - visible.length;
  return extra > 0 ? `${visible.join(', ')} +${String(extra)}` : visible.join(', ');
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
    const github = nestedRecord(meta, 'github');
    const githubType = stringMeta(github, 'type');
    if (provider === 'github' && githubType === 'workflow_run') {
      const repo = stringMeta(github, 'repo') ?? 'repo';
      const branch = stringMeta(github, 'head_branch') ?? 'branch';
      const name = workflowNameFromContent(event) ?? 'workflow';
      return `integration:github:workflow_run:${repo}:${name}:${branch}:${dateKey(
        event.occurredAt,
        timezone,
      )}`;
    }
    if (provider === 'github' && (githubType === 'pull_request' || githubType === 'review')) {
      const repo = stringMeta(github, 'repo') ?? 'repo';
      const prNumber = numberMeta(github, 'pr_number') ?? numberMeta(github, 'number');
      if (prNumber) return `integration:github:pr:${repo}:${String(prNumber)}`;
    }
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

export function timelineMomentAnchorId(momentId: string): string {
  return `tm-${encodeURIComponent(momentId).replace(/%/g, '_')}`;
}

export function timelineMomentLookupPlan(momentId: string): TimelineMomentLookupPlan | null {
  if (!momentId.startsWith('moment:')) return null;
  const key = momentId.slice('moment:'.length);
  const parts = key.split(':');
  const family = parts[0];
  if (family === 'meeting') {
    const meetingId = parts.slice(1).join(':');
    return meetingId ? metadataLookupPlan('meeting', [[['meeting_id'], meetingId]], 100) : null;
  }
  if (family === 'email') {
    const threadId = parts.slice(1).join(':');
    return threadId ? metadataLookupPlan('email', [[['thread_root_id'], threadId]], 300) : null;
  }
  if (family === 'calendar') {
    const calendarEventId = parts.slice(1).join(':');
    return calendarEventId
      ? metadataLookupPlan('calendar', [[['calendar_event_id'], calendarEventId]], 100)
      : null;
  }
  if (family === 'integration' && parts[1] === 'github' && parts[2] === 'workflow_run') {
    const date = parts.at(-1);
    const branch = parts.at(-2);
    const workflowName = parts.at(-3);
    const repo = parts.slice(3, -3).join(':');
    return date && isDateKey(date) && repo && workflowName && branch
      ? {
          ...dayLookupPlan('integration', date),
          metadataPredicates: [
            { path: ['provider'], equals: 'github' },
            { path: ['github', 'type'], equals: 'workflow_run' },
            { path: ['github', 'repo'], equals: repo },
            { path: ['github', 'head_branch'], equals: branch },
          ],
        }
      : null;
  }
  if (family === 'integration' && parts[1] === 'github' && parts[2] === 'pr') {
    const prNumber = parts.at(-1);
    const repo = parts.slice(3, -1).join(':');
    return repo && prNumber
      ? metadataLookupPlan(
          'integration',
          [
            [['provider'], 'github'],
            [['github', 'repo'], repo],
            [['github', 'pr_number'], prNumber],
          ],
          300,
        )
      : null;
  }
  if (family === 'integration' && parts[1]) {
    const provider = parts[1];
    const externalId = parts.slice(2).join(':');
    return externalId
      ? {
          ...metadataLookupPlan('integration', [[['provider'], provider]], 300),
          metadataPredicateGroups: [
            [
              { path: ['external_object_id'], equals: externalId },
              { path: ['external_event_id'], equals: externalId },
            ],
          ],
        }
      : null;
  }
  if (family === 'telegram' || family === 'ingest_webhook') {
    const minute = parts.at(-1);
    const hour = parts.at(-2);
    const date = parts.at(-3);
    const context = parts.slice(1, -3).join(':');
    const bucket = hour && minute ? `${hour}:${minute}` : null;
    if (!date || !bucket || !isDateKey(date) || !isTimeBucket(bucket)) return null;
    const plan = bucketLookupPlan(family, date, bucket);
    if (family === 'telegram' && context) {
      plan.metadataPredicateGroups = [
        [
          { path: ['tg_chat_id'], equals: context },
          { path: ['tg_chat_title'], equals: context },
        ],
      ];
    }
    if (family === 'ingest_webhook' && context) {
      plan.metadataPredicates = [{ path: ['ingest_webhook_id'], equals: context }];
    }
    return plan;
  }
  if (family === 'document') {
    const date = parts.at(-2);
    const action = parts.at(-1);
    const documentId = parts.slice(1, -2).join(':');
    return date && isDateKey(date) && action && documentId
      ? {
          ...dayLookupPlan('document', date),
          metadataPredicates: [
            { path: ['document_id'], equals: documentId },
            { path: ['action'], equals: action },
          ],
        }
      : null;
  }
  if (family === 'slack') {
    const threadTs = parts.at(-1);
    const channel = parts.slice(1, -1).join(':');
    if (!threadTs || !channel) return null;
    const seconds = threadTs ? Number(threadTs) : Number.NaN;
    if (!Number.isFinite(seconds)) return null;
    return {
      ...centeredLookupPlan('slack', new Date(seconds * 1000), 24, 24, 300),
      metadataPredicateGroups: [
        [
          { path: ['slack_channel_id'], equals: channel },
          { path: ['slack_channel_name'], equals: channel },
        ],
        [
          { path: ['slack_thread_ts'], equals: threadTs },
          { path: ['slack_message_ts'], equals: threadTs },
        ],
      ],
    };
  }
  return null;
}

function metadataLookupPlan(
  source: TimelineEventSource,
  predicates: [string[], string][],
  limit: number,
): TimelineMomentLookupPlan {
  return {
    source,
    limit,
    metadataPredicates: predicates.map(([path, equals]) => ({ path, equals })),
  };
}

function isDateKey(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(input);
}

function isTimeBucket(input: string): boolean {
  return /^\d{2}:\d{2}$/.test(input);
}

function dayLookupPlan(source: TimelineEventSource, date: string): TimelineMomentLookupPlan {
  return centeredLookupPlan(source, new Date(`${date}T12:00:00.000Z`), 36, 36, 300);
}

function bucketLookupPlan(
  source: TimelineEventSource,
  date: string,
  bucket: string,
): TimelineMomentLookupPlan {
  return centeredLookupPlan(source, new Date(`${date}T${bucket}:00.000Z`), 6, 30, 300);
}

function centeredLookupPlan(
  source: TimelineEventSource,
  center: Date,
  beforeHours: number,
  afterHours: number,
  limit: number,
): TimelineMomentLookupPlan {
  return {
    source,
    from: new Date(center.getTime() - beforeHours * 60 * 60 * 1000),
    to: new Date(center.getTime() + afterHours * 60 * 60 * 1000),
    limit,
  };
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
    if (typeof actor === 'string') return actor;
    if (typeof actor === 'object' && actor !== null) {
      const record = actor as Record<string, unknown>;
      const name = stringMeta(record, 'name') ?? stringMeta(record, 'login');
      if (name) return name;
    }
    return authorName(event, authorMap) ?? 'Integration';
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
    const provider = providerDisplayName(stringMeta(meta, 'provider'));
    const type = eventTypeLabel(stringMeta(meta, 'event_type'));
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

function clippedTitle(text: string, fallback: string): string {
  const firstLine = text
    .replace(/\s+/g, ' ')
    .split(/[.!?](?:\s|$)/)[0]
    ?.trim();
  return clipped(firstLine && firstLine.length > 0 ? firstLine : fallback, 92);
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : pluralLabel}`;
}

function workflowNameFromContent(event: TimelineEvent): string | null {
  const match = /GitHub workflow "([^"]+)"/.exec(event.contentText ?? '');
  return match?.[1] ?? null;
}

function githubPullRequestTitleFromContent(event: TimelineEvent): string | null {
  const text = event.contentText?.trim();
  if (!text) return null;
  return text.split('—')[1]?.trim() ?? /#\d+\s+\w+:\s*(.+)$/i.exec(text)?.[1]?.trim() ?? null;
}

function eventTypeLabel(value: string | null): string | null {
  if (!value) return null;
  return value
    .split('.')
    .filter(Boolean)
    .map((part) => part.replace(/_/g, ' '))
    .join(' ');
}

function firstStringMeta(
  meta: Record<string, unknown>,
  paths: (string | readonly string[])[],
): string | null {
  for (const path of paths) {
    const value = typeof path === 'string' ? stringMeta(meta, path) : stringMetaAtPath(meta, path);
    if (value) return value;
  }
  return null;
}

function stringMetaAtPath(meta: Record<string, unknown>, path: readonly string[]): string | null {
  let current: unknown = meta;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' && current.trim().length > 0 ? current.trim() : null;
}

function formatIntegrationResourceLabel(label: string): string {
  const trimmed = label.trim();
  if (/\.[A-Za-z0-9]{2,8}$/.test(trimmed) && trimmed.length > 36) {
    return truncateFilenameMiddle(trimmed);
  }
  return clipped(trimmed, 80);
}

function providerContentResourceLabel(
  provider: string | null | undefined,
  contentText: string | null | undefined,
): string | null {
  if (!provider || !contentText) return null;
  const firstLine = contentText.split(/\r?\n/)[0]?.trim();
  if (!firstLine) return null;
  const normalizedProvider = provider.trim().toLowerCase();
  if (normalizedProvider === 'monday' || normalizedProvider === 'monday_com') {
    const update = /^Monday update on ([^:]+):/i.exec(firstLine)?.[1];
    const activity = /^Monday .+ on [^:]+: (.+)$/i.exec(firstLine)?.[1];
    return update ?? activity ?? null;
  }
  if (normalizedProvider === 'linear') {
    return /^Linear project "([^"]+)"/i.exec(firstLine)?.[1] ?? null;
  }
  return null;
}

function integrationResourceLabel(
  meta: Record<string, unknown>,
  contentText?: string | null,
): string | null {
  const provider = stringMeta(meta, 'provider');
  const normalizedProvider = provider?.trim().toLowerCase();
  const issueTrackerLabel = firstStringMeta(meta, [
    ['linear', 'identifier'],
    ['linear', 'issue', 'identifier'],
    ['linear', 'issue', 'title'],
    ['linear', 'issue'],
    ['linear', 'project', 'name'],
    ['jira', 'key'],
    ['jira', 'issue_key'],
    ['jira', 'summary'],
    ['asana', 'task_name'],
    ['asana', 'name'],
    ['trello', 'card_name'],
    ['trello', 'name'],
    ['basecamp', 'todo_title'],
    ['basecamp', 'title'],
    'issue_key',
    'ticket_key',
    'task_key',
    'card_name',
    'item_name',
    'resource_name',
  ]);
  const incidentLabel = firstStringMeta(meta, [
    'sentry_short_id',
    'sentry_issue_id',
    'release_version',
    ['datadog', 'incident_title'],
    ['datadog', 'monitor_name'],
    ['datadog', 'title'],
    'incident_title',
    'monitor_name',
    'short_id',
  ]);
  const documentLabel = firstStringMeta(meta, [
    ['drive', 'name'],
    ['notion', 'title'],
    ['notion', 'page_title'],
    ['confluence', 'title'],
    ['figma', 'file_name'],
    ['figma', 'name'],
    'document_name',
    'file_name',
    'page_title',
    'name',
    'resource_name',
  ]);
  const crmLabel = firstStringMeta(meta, [
    ['salesforce', 'opportunity_name'],
    ['salesforce', 'account_name'],
    ['hubspot', 'deal_name'],
    ['hubspot', 'company_name'],
    ['pipedrive', 'deal_name'],
    ['attio', 'record_name'],
    ['close', 'lead_name'],
    'deal_name',
    'opportunity_name',
    'company_name',
    'contact_name',
    'account_name',
    'record_name',
    'resource_name',
  ]);
  const supportLabel = firstStringMeta(meta, [
    ['zendesk', 'ticket_subject'],
    ['zendesk', 'ticket_key'],
    ['intercom', 'conversation_title'],
    ['intercom', 'conversation_subject'],
    'ticket_subject',
    'conversation_title',
    'subject',
    'resource_name',
  ]);
  const contentLabel = providerContentResourceLabel(provider, contentText);
  const mondayItemLabel = firstStringMeta(meta, ['monday_item_name', 'monday_parent_item_name']);
  const mondayBoardLabel = firstStringMeta(meta, ['monday_board_name']);
  const label =
    (normalizedProvider === 'linear' ||
    normalizedProvider === 'jira' ||
    normalizedProvider === 'asana' ||
    normalizedProvider === 'trello' ||
    normalizedProvider === 'basecamp'
      ? issueTrackerLabel
      : null) ??
    (normalizedProvider === 'sentry' || normalizedProvider === 'datadog' ? incidentLabel : null) ??
    (normalizedProvider === 'google_drive' ||
    normalizedProvider === 'drive' ||
    normalizedProvider === 'notion' ||
    normalizedProvider === 'confluence' ||
    normalizedProvider === 'figma'
      ? documentLabel
      : null) ??
    (normalizedProvider === 'salesforce' ||
    normalizedProvider === 'hubspot' ||
    normalizedProvider === 'pipedrive' ||
    normalizedProvider === 'attio' ||
    normalizedProvider === 'close'
      ? crmLabel
      : null) ??
    (normalizedProvider === 'zendesk' || normalizedProvider === 'intercom' ? supportLabel : null) ??
    (normalizedProvider === 'monday' || normalizedProvider === 'monday_com'
      ? (mondayItemLabel ?? contentLabel ?? issueTrackerLabel ?? mondayBoardLabel)
      : null) ??
    contentLabel ??
    stringMeta(meta, 'resource_name') ??
    stringMeta(meta, 'external_object_id') ??
    stringMeta(meta, 'external_event_id');

  return label ? formatIntegrationResourceLabel(label) : null;
}

function githubTitleForGroup(
  sorted: TimelineEvent[],
  meta: Record<string, unknown>,
): string | null {
  const github = nestedRecord(meta, 'github');
  const type = stringMeta(github, 'type');
  const repo = stringMeta(github, 'repo');
  const eventType = stringMeta(meta, 'event_type');
  const latest = sorted[0];
  if (!latest) return null;
  if (type === 'workflow_run') {
    const failures = sorted.filter((event) =>
      stringMeta(metaObject(event.sourceMetadata), 'event_type')?.includes('failure'),
    ).length;
    const cancelled = sorted.filter((event) =>
      stringMeta(metaObject(event.sourceMetadata), 'event_type')?.includes('cancelled'),
    ).length;
    const name = workflowNameFromContent(latest) ?? 'workflow';
    const state = failures > 0 ? 'failed' : cancelled > 0 ? 'was cancelled' : 'passed';
    return `${name} ${state}${repo ? ` on ${repo}` : ''}`;
  }
  if (type === 'pull_request') {
    const number = numberMeta(github, 'number');
    const title = githubPullRequestTitleFromContent(latest);
    const state =
      eventType === 'pr.merged' ? 'merged' : eventType === 'pr.closed' ? 'closed' : 'updated';
    return `PR${number ? ` #${String(number)}` : ''} ${state}${title ? `: ${title}` : ''}`;
  }
  if (type === 'review') {
    const prNumber = numberMeta(github, 'pr_number');
    const state = stringMeta(github, 'state') ?? eventTypeLabel(eventType) ?? 'reviewed';
    return `PR${prNumber ? ` #${String(prNumber)}` : ''} review ${state.toLowerCase()}`;
  }
  if (type === 'commit') return `Commit pushed${repo ? ` to ${repo}` : ''}`;
  if (type === 'release') {
    const tag = stringMeta(github, 'tag');
    return `Release${tag ? ` ${tag}` : ''} published${repo ? ` for ${repo}` : ''}`;
  }
  return null;
}

function momentKindForGroup(sorted: TimelineEvent[]): TimelineMomentKind {
  const lead = sorted[0];
  if (!lead) return 'note';
  const meta = metaObject(lead.sourceMetadata);
  if (lead.source === 'telegram' || lead.source === 'slack') return 'conversation';
  if (lead.source === 'meeting') return 'meeting';
  if (lead.source === 'email') return 'email_thread';
  if (lead.source === 'calendar') return 'calendar';
  if (lead.source === 'document') return 'document';
  if (lead.source === 'ingest_webhook') return 'webhook';
  if (lead.source === 'system') return 'system';
  if (lead.source === 'integration') {
    const github = nestedRecord(meta, 'github');
    const githubType = stringMeta(github, 'type');
    if (githubType === 'pull_request' || githubType === 'review' || githubType === 'commit') {
      return 'code_review';
    }
    if (githubType === 'workflow_run' || githubType === 'release') return 'ci_deploy';
    const eventType = stringMeta(meta, 'event_type');
    if (eventType?.includes('incident') || eventType?.includes('issue.resolved')) {
      return 'incident';
    }
    return 'integration_activity';
  }
  return 'note';
}

function titleForGroup(
  sorted: TimelineEvent[],
  displayLead: TimelineEvent,
  timezone?: string,
): string {
  const meta = metaObject(displayLead.sourceMetadata);
  if (displayLead.source === 'telegram' || displayLead.source === 'slack') {
    const context = contextLabel(displayLead, timezone);
    if (sorted.length > 1)
      return `${displayLead.source === 'telegram' ? 'Telegram' : 'Slack'} conversation in ${context}`;
    return clippedTitle(
      summaryForEvent(displayLead, timezone),
      `${displayLead.source === 'telegram' ? 'Telegram' : 'Slack'} message`,
    );
  }
  if (displayLead.source === 'meeting') {
    const title = stringMeta(meta, 'title');
    if (title) return displayText(title, { timezone });
    if (stringMeta(meta, 'summary')) return 'Meeting summary captured';
    return displayLead.contentText
      ? clippedTitle(summaryForEvent(displayLead, timezone), 'Meeting captured')
      : 'Meeting captured without transcript';
  }
  if (displayLead.source === 'email') {
    const subject = stringMeta(meta, 'subject');
    if (subject) return displayText(subject, { timezone });
    return sorted.length > 1 ? 'Email thread captured' : 'Email captured';
  }
  if (displayLead.source === 'calendar') {
    return displayText(stringMeta(meta, 'title') ?? summaryForEvent(displayLead, timezone), {
      timezone,
    });
  }
  if (displayLead.source === 'document') {
    const action = stringMeta(meta, 'action');
    const documentName = stringMeta(meta, 'document_name') ?? stringMeta(meta, 'name');
    const verb =
      action === 'new_version' ? 'Updated' : action === 'rename' ? 'Renamed' : 'Uploaded';
    return documentName
      ? `${verb} ${truncateFilenameMiddle(documentName)}`
      : 'Document activity captured';
  }
  if (displayLead.source === 'integration') {
    const provider = stringMeta(meta, 'provider');
    if (provider === 'github') {
      const title = githubTitleForGroup(sorted, meta);
      if (title) return displayText(title, { timezone });
    }
    const resource = integrationResourceLabel(meta, displayLead.contentText);
    const eventType = eventTypeLabel(stringMeta(meta, 'event_type')) ?? 'activity';
    return `${providerDisplayName(provider)} ${eventType}${resource ? ` · ${resource}` : ''}`;
  }
  if (displayLead.source === 'ingest_webhook') {
    return `${stringMeta(meta, 'ingest_webhook_name') ?? 'Webhook'} evidence received`;
  }
  return clippedTitle(
    summaryForEvent(displayLead, timezone),
    `${SOURCE_LABEL[displayLead.source]} event captured`,
  );
}

function subtitleForGroup(
  sorted: TimelineEvent[],
  displayLead: TimelineEvent,
  actors: string[],
  contexts: string[],
): string | null {
  const meta = metaObject(displayLead.sourceMetadata);
  const count = sorted.length;
  if (displayLead.source === 'telegram' || displayLead.source === 'slack') {
    return [
      humanList(contexts, SOURCE_LABEL[displayLead.source], 1),
      plural(count, 'message'),
      humanList(actors, 'unknown sender'),
    ].join(' · ');
  }
  if (displayLead.source === 'meeting') {
    return [humanList(actors, 'Meeting'), count > 1 ? plural(count, 'source') : null]
      .filter(Boolean)
      .join(' · ');
  }
  if (displayLead.source === 'integration') {
    const provider = stringMeta(meta, 'provider') ?? 'Integration';
    const eventTypes = uniqueStrings(
      sorted.map((event) =>
        eventTypeLabel(stringMeta(metaObject(event.sourceMetadata), 'event_type')),
      ),
    );
    return [
      providerDisplayName(provider),
      humanList(eventTypes, 'activity'),
      plural(count, 'event'),
    ].join(' · ');
  }
  if (displayLead.source === 'document' || displayLead.source === 'calendar') {
    return count > 1
      ? plural(count, 'source event')
      : humanList(actors, SOURCE_LABEL[displayLead.source]);
  }
  return count > 1
    ? plural(count, 'source event')
    : humanList(contexts, SOURCE_LABEL[displayLead.source]);
}

function previewForGroup(sorted: TimelineEvent[], timezone?: string): string | null {
  for (const event of sorted) {
    const value = clipped(summaryForEvent(event, timezone), 160);
    if (value.length > 0 && value !== 'Source event captured.') return value;
  }
  return null;
}

function uniqueStrings(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function impactItemsForEvent(
  event: TimelineEvent,
  options: { includeVisibilityScopedMetadata: boolean; timezone?: string | undefined } = {
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
        integrationResourceLabel(meta, event.contentText) ??
        providerDisplayName(stringMeta(meta, 'provider')),
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

function dedupeArtifactClusters<TArtifactCluster extends TimelineArtifactCluster>(
  clusters: TArtifactCluster[],
): TArtifactCluster[] {
  const seen = new Set<string>();
  return clusters.filter((cluster) => {
    if (seen.has(cluster.id)) return false;
    seen.add(cluster.id);
    return true;
  });
}

function timelineGroupingStrategy(event: TimelineEvent): string {
  const meta = metaObject(event.sourceMetadata);
  if (parentRawEventId(event)) return 'parent_raw_event';
  if (
    event.source === 'telegram' ||
    event.source === 'slack' ||
    event.source === 'ingest_webhook'
  ) {
    return 'source_time_window';
  }
  if (event.source === 'integration') {
    const provider = stringMeta(meta, 'provider');
    const githubType = stringMeta(nestedRecord(meta, 'github'), 'type');
    if (provider === 'github' && githubType === 'workflow_run') return 'provider_workflow_window';
    return 'provider_object';
  }
  if (event.source === 'email') return 'email_thread';
  if (event.source === 'meeting') return 'meeting_id';
  if (event.source === 'calendar') return 'calendar_event_id';
  if (event.source === 'document') return 'document_action';
  return 'single_event';
}

function githubNumberExists(github: Record<string, unknown>): boolean {
  return metadataValueExists(github, 'number') || metadataValueExists(github, 'pr_number');
}

function integrationMissingGroupingFields(event: TimelineEvent): string[] {
  const meta = metaObject(event.sourceMetadata);
  const missing: string[] = [];
  const provider = stringMeta(meta, 'provider');
  if (!provider) missing.push('provider');
  if (!stringMeta(meta, 'event_type')) missing.push('event_type');

  if (provider === 'github') {
    const github = nestedRecord(meta, 'github');
    const githubType = stringMeta(github, 'type');
    if (!githubType) missing.push('github.type');
    if (githubType === 'workflow_run') {
      if (!stringMeta(github, 'repo')) missing.push('github.repo');
      if (!stringMeta(github, 'head_branch')) missing.push('github.head_branch');
      if (!workflowNameFromContent(event) && !stringMeta(github, 'workflow_name')) {
        missing.push('github.workflow_name');
      }
      return missing;
    }
    if (githubType === 'review') {
      if (!stringMeta(github, 'repo')) missing.push('github.repo');
      if (!githubNumberExists(github)) missing.push('github.pr_number');
      return missing;
    }
    if (githubType === 'pull_request' || githubType === 'issue') {
      if (!stringMeta(github, 'repo')) missing.push('github.repo');
      if (!githubNumberExists(github)) missing.push('github.number');
      return missing;
    }
    if (githubType === 'commit') {
      if (!stringMeta(github, 'repo')) missing.push('github.repo');
      if (!stringMeta(github, 'sha') && !stringMeta(github, 'head_sha')) {
        missing.push('github.sha');
      }
      return missing;
    }
    if (githubType === 'release') {
      if (!stringMeta(github, 'repo')) missing.push('github.repo');
      if (!stringMeta(github, 'tag')) missing.push('github.tag');
      return missing;
    }
  }

  if (!stringMeta(meta, 'external_object_id') && !stringMeta(meta, 'external_event_id')) {
    missing.push('external_object_id');
  }

  return missing;
}

function missingGroupingFields(event: TimelineEvent): string[] {
  const meta = metaObject(event.sourceMetadata);
  if (event.source === 'integration') return integrationMissingGroupingFields(event);
  if (event.source === 'ingest_webhook' && !stringMeta(meta, 'ingest_webhook_id')) {
    return ['ingest_webhook_id'];
  }
  return [];
}

export function timelineMomentDiagnostics(
  events: TimelineEvent[],
  options: { timezone?: string | undefined } = {},
): TimelineMomentDiagnostic[] {
  return events.flatMap((event) => {
    const missingFields = missingGroupingFields(event);
    if (missingFields.length === 0) return [];
    const meta = metaObject(event.sourceMetadata);
    const provider = stringMeta(meta, 'provider');
    const groupingKey = timelineGroupKey(event, options.timezone);
    const groupingStrategy = timelineGroupingStrategy(event);
    return [
      {
        code: 'missing_grouping_metadata' as const,
        severity: 'warning' as const,
        source: event.source,
        provider,
        eventId: event.id,
        missingFields,
        groupingKey,
        groupingStrategy,
        message: `${SOURCE_LABEL[event.source]} event is missing ${missingFields.join(
          ', ',
        )}; grouping used ${groupingStrategy}.`,
      },
    ];
  });
}

export function buildTimelineMoments<
  TEvent extends TimelineMomentEvent,
  TArtifactCluster extends TimelineArtifactCluster = TimelineArtifactCluster,
>(
  events: TEvent[],
  authorMap: Map<string, TimelineAuthor>,
  options: Date | BuildTimelineMomentOptions<TArtifactCluster> = {},
): TimelineMoment<TEvent, TArtifactCluster>[] {
  const now = options instanceof Date ? options : (options.now ?? new Date());
  const hydrated = options instanceof Date ? {} : (options.impactItemsByEventId ?? {});
  const artifactClustersByEventId =
    options instanceof Date ? {} : (options.artifactClustersByEventId ?? {});
  const timezone = options instanceof Date ? undefined : options.timezone;
  const groupingMode = options instanceof Date ? 'moments' : (options.groupingMode ?? 'moments');
  const hasAuthoritativeHydration =
    !(options instanceof Date) && options.impactItemsByEventId !== undefined;
  const groups = new Map<string, TEvent[]>();
  const baseGroupKeyByEventId = new Map(
    events.map((event) => [
      event.id,
      groupingMode === 'events' ? `${event.source}:${event.id}` : timelineGroupKey(event, timezone),
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
        (a: TEvent, b: TEvent) =>
          eventDate(b.occurredAt).getTime() - eventDate(a.occurredAt).getTime(),
      );
      const lead = sorted[0];
      if (!lead) return [];
      const displayLead = displayLeadForGroup(sorted, lead);
      const actorByTelegramUserId = actorLabelsByTelegramUserId(sorted);
      const actorLabels = uniqueStrings(
        sorted.map((event) =>
          event.source === 'telegram'
            ? (telegramSourceActorLabel(event) ??
              (displayMeta(metaObject(event.sourceMetadata), 'tg_user_id')
                ? actorByTelegramUserId.get(
                    displayMeta(metaObject(event.sourceMetadata), 'tg_user_id') ?? '',
                  )
                : null) ??
              authorName(event, authorMap))
            : actorLabel(event, authorMap),
        ),
      );
      const contextLabels = uniqueStrings(sorted.map((event) => contextLabel(event, timezone)));
      const sourceLabels = uniqueStrings(sorted.map((event) => SOURCE_LABEL[event.source]));
      const summary =
        sorted.length === 1
          ? summaryForEvent(lead, timezone)
          : sorted
              .map((event) => summaryForEvent(event, timezone))
              .slice(0, 3)
              .join(' / ');
      const kind = momentKindForGroup(sorted);
      const title = titleForGroup(sorted, displayLead, timezone);
      const subtitle = subtitleForGroup(sorted, displayLead, actorLabels, contextLabels);
      const preview = previewForGroup(sorted, timezone);
      const sourceFamilies = uniqueStrings(
        sorted.map((event) => event.source),
      ) as TEvent['source'][];
      return [
        {
          id: `moment:${key}`,
          version: 'timeline_moment.v1' as const,
          anchorId: timelineMomentAnchorId(`moment:${key}`),
          kind,
          dateKey: dateKey(lead.occurredAt, timezone),
          dateLabel: formatDateSection(lead.occurredAt, now, timezone),
          timeLabel: timeLabel(sorted, timezone),
          source: displayLead.source,
          sourceLabel: SOURCE_LABEL[displayLead.source],
          sourceIcon: SOURCE_ICON[displayLead.source],
          actorLabel: actorLabelForGroup(displayLead, sorted, authorMap),
          contextLabel: contextLabel(displayLead, timezone),
          title,
          subtitle,
          preview,
          confidence: 'deterministic' as const,
          grouping: {
            strategy: timelineGroupingStrategy(displayLead),
            key,
            sourceFamilies,
          },
          evidenceSummary: {
            rawEventCount: sorted.length,
            sourceLabels,
            actorLabels,
            contextLabels,
            timeRange: timeLabel(sorted, timezone),
          },
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
              .filter((cluster): cluster is TArtifactCluster => Boolean(cluster)),
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

export function filterTimelineMomentsByImpact<TMoment extends TimelineMoment>(
  moments: TMoment[],
  impactFilter: TimelineImpactFilter,
): TMoment[] {
  if (impactFilter === 'all' || (Array.isArray(impactFilter) && impactFilter.length === 0)) {
    return moments;
  }
  const allowed = new Set(Array.isArray(impactFilter) ? impactFilter : [impactFilter]);
  return moments.filter((moment) => moment.impactItems.some((item) => allowed.has(item.kind)));
}

export function toTimelineMomentDto<
  TEvent extends TimelineMomentEvent,
  TArtifactCluster extends TimelineArtifactCluster = TimelineArtifactCluster,
>(moment: TimelineMoment<TEvent, TArtifactCluster>): TimelineMomentDto<TEvent, TArtifactCluster> {
  const { rawEvents, ...rest } = moment;
  return {
    ...rest,
    rawEventIds: rawEvents.map((event) => event.id),
  };
}
