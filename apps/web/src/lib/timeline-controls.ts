import type { ImpactKind } from '@/lib/timeline-moments';

export const TIMELINE_SOURCES = [
  ['web', 'Web'],
  ['telegram', 'Telegram'],
  ['slack', 'Slack'],
  ['email', 'Email'],
  ['document', 'Document'],
  ['meeting', 'Meeting'],
  ['integration', 'Integration'],
  ['calendar', 'Calendar'],
  ['system', 'System'],
] as const;

export const TIMELINE_IMPACT_FILTERS = [
  'task',
  'object',
  'calendar',
  'document',
  'decision',
  'approval',
] as const satisfies readonly ImpactKind[];

export const TIMELINE_PRESETS = [
  { label: 'All', all: true },
  { label: 'Meetings', source: 'meeting' },
  { label: 'Slack', source: 'slack' },
  { label: 'Email', source: 'email' },
  { label: 'Documents', source: 'document' },
  { label: 'Calendar', source: 'calendar' },
  { label: 'Approvals', impact: 'approval' },
  { label: 'Tasks', impact: 'task' },
  { label: 'Decisions', impact: 'decision' },
] as const;

type TimelineDensity = 'comfortable' | 'dense';
type TimelineSource = (typeof TIMELINE_SOURCES)[number][0];

export function parseTimelineSource(input: string | undefined): TimelineSource | undefined {
  if (!input) return undefined;
  return TIMELINE_SOURCES.some(([value]) => value === input)
    ? (input as TimelineSource)
    : undefined;
}

export function parseTimelineImpact(input: string | undefined): ImpactKind | undefined {
  if (!input) return undefined;
  return TIMELINE_IMPACT_FILTERS.some((value) => value === input)
    ? (input as ImpactKind)
    : undefined;
}

export function parseTimelineDensity(input: string | undefined): TimelineDensity {
  return input === 'dense' ? 'dense' : 'comfortable';
}

export function timelineHref(
  params: Record<string, string | null | undefined>,
  next: Record<string, string | null | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...next })) {
    if (value) sp.set(key, value);
  }
  const query = sp.toString();
  return query ? `/app/timeline?${query}` : '/app/timeline';
}
