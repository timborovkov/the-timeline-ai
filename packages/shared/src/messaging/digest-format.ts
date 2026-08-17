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
  if (digest.activity) return digest.activity;
  const newObjectsByType = digest.objectChangesByType;
  return {
    newMoments: digest.momentCount ?? digest.eventCount,
    newProposals: digest.pendingApprovals,
    newTasks: digest.tasks.length,
    completedTasks: digest.completedTasks?.length ?? 0,
    newProjects: newObjectsByType.project ?? 0,
    newObjectsByType,
  };
}

export function formatDigestActivityLines(activity: DailyDigestActivity): string[] {
  return [
    formatDigestCount(activity.newMoments, 'new moment'),
    formatDigestCount(activity.newProposals, 'new proposal'),
    formatDigestCount(activity.newTasks, 'new task'),
    formatDigestCount(activity.completedTasks, 'completed task'),
    formatDigestCount(activity.newProjects, 'new project'),
    ...Object.entries(activity.newObjectsByType)
      .filter(([type]) => type !== 'task' && type !== 'follow_up' && type !== 'project')
      .map(([type, count]) => formatDigestCount(count, `new ${type.replaceAll('_', ' ')}`)),
  ];
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

export function formatDigestTask(
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
  return `${task.title} (${formatDigestTaskStatus(task.status)}, ${dueText})`;
}

export function formatDigestCalendarEvent(
  event: DailyDigestPayload['upcomingCalendar'][number],
  timezone?: string,
): string {
  const when = formatDigestDateTime(event.startAt, timezone);
  if (!event.repeating) return `${event.title} (${when})`;
  return `${event.title} (repeating · next ${when})`;
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
