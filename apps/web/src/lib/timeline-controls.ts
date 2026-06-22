import type { ImpactKind } from '@/lib/timeline-moments';

export const TIMELINE_SOURCES = [
  ['chat', 'Chat'],
  ['web', 'Web'],
  ['telegram', 'Telegram'],
  ['slack', 'Slack'],
  ['email', 'Email'],
  ['document', 'Document'],
  ['meeting', 'Meeting'],
  ['integrations', 'Integrations'],
  ['integration', 'Integration'],
  ['ingest_webhook', 'Ingest webhook'],
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

type TimelineSource = (typeof TIMELINE_SOURCES)[number][0];
type ExactTimelineSource = Exclude<TimelineSource, 'chat' | 'integrations'>;
type TimelinePreset = { label: string; all: true } | { label: string; source: TimelineSource };

export const TIMELINE_PRESETS = [
  { label: 'All', all: true },
  { label: 'Chat', source: 'chat' },
  { label: 'Meetings', source: 'meeting' },
  { label: 'Email', source: 'email' },
  { label: 'Documents', source: 'document' },
  { label: 'Calendar', source: 'calendar' },
  { label: 'Integrations', source: 'integrations' },
] as const satisfies readonly TimelinePreset[];

export function parseTimelineSource(input: string | undefined): TimelineSource | undefined {
  if (!input) return undefined;
  return TIMELINE_SOURCES.some(([value]) => value === input)
    ? (input as TimelineSource)
    : undefined;
}

export function timelineSourceValues(
  input: TimelineSource | undefined,
): ExactTimelineSource[] | undefined {
  if (!input) return undefined;
  if (input === 'chat') return ['telegram', 'slack'];
  if (input === 'integrations') return ['integration', 'ingest_webhook'];
  return [input];
}

export function parseTimelineImpact(input: string | undefined): ImpactKind | undefined {
  if (!input) return undefined;
  return TIMELINE_IMPACT_FILTERS.some((value) => value === input)
    ? (input as ImpactKind)
    : undefined;
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
