import type { DailyDigestPayload } from '#src/messaging/types.js';

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

export function digestContentSections(
  digest: Pick<DailyDigestPayload, 'summary' | 'sections'>,
): NonNullable<DailyDigestPayload['sections']> {
  const sections =
    digest.sections?.map((section) => ({
      title: section.title,
      items: section.items.map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean),
    })) ?? [];
  return sections
    .filter((section) => section.items.length > 0)
    .sort((a, b) => (SECTION_ORDER.get(a.title) ?? 99) - (SECTION_ORDER.get(b.title) ?? 99));
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
  return `${event.title} (${formatDigestDateTime(event.startAt, timezone)})`;
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
          ...tasks.map((task) =>
            `• ${formatDigestTask(task, timezone, new Date(payload.windowEnd))}`,
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
