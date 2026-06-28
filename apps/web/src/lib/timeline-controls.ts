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

export function parseTimelineSources(input: string | undefined): TimelineSource[] {
  if (!input) return [];
  const seen = new Set<TimelineSource>();
  const out: TimelineSource[] = [];
  for (const raw of input.split(',')) {
    const source = parseTimelineSource(raw.trim());
    if (source && !seen.has(source)) {
      seen.add(source);
      out.push(source);
    }
  }
  return out;
}

export function timelineSourceValues(
  input: TimelineSource | TimelineSource[] | undefined,
): ExactTimelineSource[] | undefined {
  if (!input || (Array.isArray(input) && input.length === 0)) return undefined;
  const sources = Array.isArray(input) ? input : [input];
  const out: ExactTimelineSource[] = [];
  const seen = new Set<ExactTimelineSource>();
  for (const source of sources) {
    const values =
      source === 'chat'
        ? (['telegram', 'slack'] as const)
        : source === 'integrations'
          ? (['integration', 'ingest_webhook'] as const)
          : ([source] as const);
    for (const value of values) {
      if (!seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
  }
  return out;
}

export function parseTimelineImpact(input: string | undefined): ImpactKind | undefined {
  if (!input) return undefined;
  return TIMELINE_IMPACT_FILTERS.some((value) => value === input)
    ? (input as ImpactKind)
    : undefined;
}

export function parseTimelineImpacts(input: string | undefined): ImpactKind[] {
  if (!input) return [];
  const seen = new Set<ImpactKind>();
  const out: ImpactKind[] = [];
  for (const raw of input.split(',')) {
    const impact = parseTimelineImpact(raw.trim());
    if (impact && !seen.has(impact)) {
      seen.add(impact);
      out.push(impact);
    }
  }
  return out;
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
