import type {
  DailyDigestActivity,
  DailyDigestCalendarEvent,
  DailyDigestPayload,
  DailyDigestSection,
} from '#src/messaging/types.js';

import { presentDueDate } from '#src/time/index.js';

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z0-9])/;
const SECTION_ORDER = new Map<string, number>([
  ['Highlights', 0],
  ['Product status', 1],
  ['Completed', 2],
  ['In progress', 3],
  ['Decisions', 4],
  ['Risks', 5],
  ['Follow-ups', 6],
]);

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

export function digestContentSections(
  digest: Pick<DailyDigestPayload, 'summary' | 'sections'>,
): DailyDigestSection[] {
  const sections =
    digest.sections?.map((section) => {
      const body = section.body?.replace(/\s+/g, ' ').trim();
      return {
        title: section.title,
        ...(body ? { body } : {}),
        items: section.items.map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean),
      };
    }) ?? [];
  return sections
    .filter((section) => Boolean(section.body) || section.items.length > 0)
    .sort((a, b) => (SECTION_ORDER.get(a.title) ?? 99) - (SECTION_ORDER.get(b.title) ?? 99));
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
  return lines.length > 0
    ? lines
    : ['No new moments, proposals, tasks, objects, or pending approvals'];
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
  const date = formatDigestDate(payload.windowEnd, timezone);
  const sections = digestContentSections(payload);
  const summaryParagraphs = digestSummaryParagraphs(payload.summary);
  const tasks = payload.tasks.slice(0, 5);
  const calendar = payload.upcomingCalendar.slice(0, 3);
  const lines = [
    `Daily digest · ${payload.teamName} · ${date}`,
    '',
    ...summaryParagraphs,
    '',
    ...sections.flatMap((section) => [
      section.title,
      ...section.items.map((item) => `• ${item}`),
      '',
    ]),
    `${payload.pendingApprovals} pending approvals · ${payload.momentCount ?? payload.eventCount} moments`,
    ...(tasks.length
      ? [
          '',
          'Tasks',
          ...tasks.map(
            (task) => `• ${formatDigestTask(task, timezone, new Date(payload.windowEnd))}`,
          ),
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
