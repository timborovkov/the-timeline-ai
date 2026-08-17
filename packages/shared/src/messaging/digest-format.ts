import type {
  DailyDigestActivity,
  DailyDigestCalendarEvent,
  DailyDigestPayload,
  DailyDigestSection,
} from '#src/messaging/types.js';

import { localDateFromInstant, presentDueDate } from '#src/time/index.js';

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z0-9])/;
const BANNED_PR_NUMBER = /(?:\bPR\s*#?\s*\d+\b|\bpull requests?\s+#?\d+|#\d{2,}\b)/gi;
const BANNED_GIT_SHA = /\b(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi;
const BANNED_TICKET_KEY = /\b[A-Z]{2,10}-\d+\b/g;
const BANNED_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const BANNED_CI_RUN = /\b(?:workflow run|ci run|run id)\s*[#:]?\s*\d+\b/gi;
const SECTION_ORDER = new Map<string, number>([
  ['Highlights', 0],
  ['Status', 1],
  ['Completed', 2],
  ['In progress', 3],
  ['Decisions', 4],
  ['Risks', 5],
  ['Follow-ups', 6],
]);

const OBJECT_TYPE_LABELS: Record<string, string> = {
  person: 'person',
  company: 'company',
  project: 'project',
  topic: 'topic',
  other: 'object',
  deal: 'deal',
  vendor: 'vendor',
  incident: 'incident',
  document: 'document',
  hiring_loop: 'hiring loop',
};

export function digestContainsBannedInventory(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  BANNED_PR_NUMBER.lastIndex = 0;
  BANNED_CI_RUN.lastIndex = 0;
  BANNED_TICKET_KEY.lastIndex = 0;
  BANNED_UUID.lastIndex = 0;
  BANNED_GIT_SHA.lastIndex = 0;
  return (
    BANNED_PR_NUMBER.test(normalized) ||
    BANNED_CI_RUN.test(normalized) ||
    BANNED_TICKET_KEY.test(normalized) ||
    BANNED_UUID.test(normalized) ||
    BANNED_GIT_SHA.test(normalized)
  );
}

export function scrubDigestArtifactIds(text: string): string {
  BANNED_PR_NUMBER.lastIndex = 0;
  BANNED_CI_RUN.lastIndex = 0;
  BANNED_TICKET_KEY.lastIndex = 0;
  BANNED_UUID.lastIndex = 0;
  BANNED_GIT_SHA.lastIndex = 0;
  return text
    .replace(BANNED_PR_NUMBER, '')
    .replace(BANNED_CI_RUN, '')
    .replace(BANNED_TICKET_KEY, '')
    .replace(BANNED_UUID, '')
    .replace(BANNED_GIT_SHA, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

export function digestSummaryParagraphs(summary: string): string[] {
  const explicitParagraphs = summary
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (explicitParagraphs.length > 1) return explicitParagraphs;

  const normalized = summary.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentences = normalized.split(SENTENCE_BOUNDARY).filter(Boolean);
  if (sentences.length <= 2) return [normalized];

  const paragraphs: string[] = [];
  for (let index = 0; index < sentences.length; index += 2) {
    paragraphs.push(sentences.slice(index, index + 2).join(' '));
  }
  return paragraphs;
}

export function digestSectionBody(section: DailyDigestSection): string {
  const body = section.body?.replace(/\s+/g, ' ').trim();
  if (body) return body;
  return section.items
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

export function canonicalDigestSectionTitle(
  title: DailyDigestSection['title'],
): Exclude<DailyDigestSection['title'], 'Product status'> {
  return title === 'Product status' ? 'Status' : title;
}

export function digestContentSections(
  digest: Pick<DailyDigestPayload, 'summary' | 'sections'>,
): DailyDigestSection[] {
  const byTitle = new Map<string, DailyDigestSection>();
  for (const section of digest.sections ?? []) {
    const title = canonicalDigestSectionTitle(section.title);
    const body = section.body?.replace(/\s+/g, ' ').trim();
    const items = section.items.map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!body && items.length === 0) continue;
    const existing = byTitle.get(title);
    if (!existing) {
      byTitle.set(title, { title, ...(body ? { body } : {}), items: body ? [] : items });
      continue;
    }
    const mergedBody = [existing.body, body].filter(Boolean).join(' ').trim();
    if (mergedBody) {
      existing.body = mergedBody;
      existing.items = [];
    } else {
      for (const item of items) {
        if (!existing.items.includes(item)) existing.items.push(item);
      }
    }
  }
  return [...byTitle.values()].sort(
    (a, b) => (SECTION_ORDER.get(a.title) ?? 99) - (SECTION_ORDER.get(b.title) ?? 99),
  );
}

export function digestActivityStats(
  digest: Pick<
    DailyDigestPayload,
    | 'activity'
    | 'momentCount'
    | 'eventCount'
    | 'pendingApprovals'
    | 'objectChangesByType'
    | 'tasks'
    | 'completedTasks'
  >,
): DailyDigestActivity {
  if (digest.activity) {
    return {
      ...digest.activity,
      pendingApprovals: digest.activity.pendingApprovals ?? digest.pendingApprovals,
    };
  }
  return {
    newMoments: digest.momentCount ?? digest.eventCount,
    newProposals: 0,
    pendingApprovals: digest.pendingApprovals,
    newTasks: 0,
    completedTasks: digest.completedTasks?.length ?? 0,
    newProjects: 0,
    newObjectsByType: {},
  };
}

export function formatDigestActivityLines(activity: DailyDigestActivity): string[] {
  const lines = [
    formatDigestCount(activity.newMoments, 'new moment'),
    formatDigestCount(activity.newProposals, 'new proposal'),
    formatDigestCount(activity.pendingApprovals ?? 0, 'pending approval'),
    formatDigestCount(activity.newTasks, 'new task'),
    formatDigestCount(activity.completedTasks, 'completed task'),
    formatDigestCount(activity.newProjects, 'new project'),
    ...Object.entries(activity.newObjectsByType)
      .filter(
        ([type, count]) =>
          type !== 'task' && type !== 'follow_up' && type !== 'project' && count > 0,
      )
      .map(([type, count]) => formatDigestCount(count, `new ${type.replaceAll('_', ' ')}`)),
  ].filter((line) => !line.startsWith('0 '));
  return lines;
}

function formatDigestCount(count: number, singular: string): string {
  return `${String(count)} ${count === 1 ? singular : `${singular}s`}`;
}

export function formatDigestDate(value: string, timezone?: string): string {
  return formatDigestDateValue(value, timezone, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDigestDateTime(value: string, timezone?: string): string {
  return formatDigestDateValue(value, timezone, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function formatDigestWindowRange(
  windowStart: string,
  windowEnd: string,
  timezone?: string,
): string {
  const start = formatDigestDateValue(windowStart, timezone, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const end = formatDigestDateValue(windowEnd, timezone, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return `${start} – ${end}`;
}

export function formatDigestObjectType(type: string): string {
  return OBJECT_TYPE_LABELS[type] ?? type.replaceAll('_', ' ');
}

export function digestCalendarHref(
  event: Pick<DailyDigestCalendarEvent, 'id' | 'startAt'>,
  timezone?: string,
): string {
  const params = new URLSearchParams();
  params.set('view', 'day');
  try {
    params.set('date', localDateFromInstant(event.startAt, timezone ?? 'UTC'));
  } catch {
    const fallback = event.startAt.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fallback)) params.set('date', fallback);
  }
  params.set('event', event.id);
  return `/app/calendar?${params.toString()}`;
}

export function formatDigestTaskStatus(status: string): string {
  return status.replaceAll('_', ' ');
}

export function formatDigestTaskDetail(
  task: DailyDigestPayload['tasks'][number],
  timezone?: string,
  now?: Date,
): string {
  const due = presentDueDate(task.dueAt, { timezone: timezone ?? 'UTC', ...(now ? { now } : {}) });
  const dueText =
    due.status === 'invalid'
      ? due.compactText
      : due.dateLabel
        ? `${due.label} · ${due.dateLabel}`
        : due.compactText;
  return `(${formatDigestTaskStatus(task.status)}, ${dueText})`;
}

export function formatDigestTask(
  task: DailyDigestPayload['tasks'][number],
  timezone?: string,
  now?: Date,
): string {
  return `${task.title} ${formatDigestTaskDetail(task, timezone, now)}`;
}

export function digestAppHref(href: string): string | null {
  const path = href.trim();
  if (path.startsWith('//') || path.includes('\\')) return null;
  if (
    path === '/app' ||
    path.startsWith('/app/') ||
    path.startsWith('/app?') ||
    path.startsWith('/app#')
  ) {
    return path;
  }
  return null;
}

export function absoluteDigestAppUrl(baseUrl: string, href: string): string | null {
  const relative = digestAppHref(href);
  try {
    const base = new URL(baseUrl);
    const url = relative ? new URL(relative, base.origin) : new URL(href.trim());
    if (url.origin !== base.origin || !isDigestAppPathname(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isDigestAppPathname(pathname: string): boolean {
  return pathname === '/app' || pathname.startsWith('/app/');
}

export function formatDigestCalendarEventDetail(
  event: DailyDigestPayload['upcomingCalendar'][number],
  timezone?: string,
): string {
  const when = formatDigestDateTime(event.startAt, timezone);
  if (!event.repeating) return `(${when})`;
  return `(repeating · next ${when})`;
}

export function formatDigestCalendarEvent(
  event: DailyDigestPayload['upcomingCalendar'][number],
  timezone?: string,
): string {
  return `${event.title} ${formatDigestCalendarEventDetail(event, timezone)}`;
}

export function collapseDigestCalendarEvents(
  events: {
    id: string;
    title: string;
    startAt: Date | string;
    endAt: Date | string;
    href?: string;
    recurringParentId?: string | null;
    rrule?: string | null;
  }[],
): DailyDigestCalendarEvent[] {
  type Group = DailyDigestCalendarEvent & { occurrenceCount: number };
  const groups = new Map<string, Group>();
  const order: string[] = [];

  for (const event of events) {
    const startAt = isoTimestamp(event.startAt);
    const endAt = isoTimestamp(event.endAt);
    const repeating = Boolean(event.recurringParentId ?? event.rrule);
    const key = event.recurringParentId
      ? `series:${event.recurringParentId}`
      : event.rrule
        ? `self:${event.id}`
        : `once:${event.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.occurrenceCount += 1;
      if (startAt < existing.startAt) {
        existing.id = event.recurringParentId ?? event.id;
        existing.title = event.title;
        existing.startAt = startAt;
        existing.endAt = endAt;
      }
      continue;
    }
    groups.set(key, {
      id: event.recurringParentId ?? event.id,
      title: event.title,
      startAt,
      endAt,
      href: event.href ?? '/app/calendar',
      repeating,
      occurrenceCount: 1,
    });
    order.push(key);
  }

  return order.map((key) => {
    const group = groups.get(key);
    if (!group) {
      throw new Error(`Missing collapsed calendar group for ${key}`);
    }
    if (!group.repeating) {
      return {
        id: group.id,
        title: group.title,
        startAt: group.startAt,
        endAt: group.endAt,
        href: group.href,
      };
    }
    return {
      id: group.id,
      title: group.title,
      startAt: group.startAt,
      endAt: group.endAt,
      href: group.href,
      repeating: true,
      occurrenceCount: group.occurrenceCount,
    };
  });
}

function isoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

const CHAT_DIGEST_MAX_LENGTH = 3900;

export function formatDigestChatText(input: {
  payload: DailyDigestPayload;
  digestUrl: string;
  maxLength?: number;
}): string {
  const payload = input.payload;
  const timezone = payload.timezone;
  const range = formatDigestWindowRange(payload.windowStart, payload.windowEnd, timezone);
  const sections = digestContentSections(payload);
  const summaryParagraphs = digestSummaryParagraphs(payload.summary);
  const tasks = payload.tasks.slice(0, 5);
  const objects = (payload.newObjects ?? []).slice(0, 5);
  const windowCalendar = (payload.windowCalendar ?? []).slice(0, 3);
  const calendar = payload.upcomingCalendar.slice(0, 3);
  const activity = formatDigestActivityLines(digestActivityStats(payload));
  const lines = [
    `Daily digest · ${payload.teamName}`,
    `Covering ${range}`,
    '',
    ...summaryParagraphs,
    '',
    ...sections.flatMap((section) => {
      if (section.body) return [section.title, digestSectionBody(section), ''];
      return [section.title, ...section.items.map((item) => `• ${item}`), ''];
    }),
    ...(activity.length ? [activity.join(' · ')] : []),
    ...(tasks.length
      ? [
          '',
          'New tasks',
          ...tasks.map(
            (task) => `• ${formatDigestTask(task, timezone, new Date(payload.windowEnd))}`,
          ),
        ]
      : []),
    ...(objects.length
      ? [
          '',
          'New objects',
          ...objects.map((object) => `• ${object.title} (${formatDigestObjectType(object.type)})`),
        ]
      : []),
    ...(windowCalendar.length
      ? [
          '',
          'Calendar this window',
          ...windowCalendar.map((event) => `• ${formatDigestCalendarEvent(event, timezone)}`),
        ]
      : []),
    ...(calendar.length
      ? [
          '',
          'Upcoming',
          ...calendar.map((event) => `• ${formatDigestCalendarEvent(event, timezone)}`),
        ]
      : []),
    '',
    `Open digest: ${input.digestUrl}`,
  ];
  const text = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const maxLength = input.maxLength ?? CHAT_DIGEST_MAX_LENGTH;
  if (text.length <= maxLength) return text;
  const suffix = `\n\nOpen digest: ${input.digestUrl}`;
  const budget = Math.max(0, maxLength - suffix.length - 1);
  return `${text.slice(0, budget).trimEnd()}…${suffix}`;
}

function formatDigestDateValue(
  value: string,
  timezone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat('en', { ...options, timeZone: timezone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', options).format(date);
  }
}
