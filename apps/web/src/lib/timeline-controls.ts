import type { ImpactKind } from '@/lib/timeline-moments';
import type { TimelineOriginFilter, TimelineSourceFacet } from '@timeline/shared/team-scope';

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

export interface TimelineOriginOption {
  value: string;
  label: string;
}

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

export function parseTimelineOrigins(input: string | undefined): TimelineOriginFilter[] {
  if (!input) return [];
  const seen = new Set<string>();
  const origins: TimelineOriginFilter[] = [];
  for (const raw of input.split(',')) {
    const token = raw.trim();
    if (!token || token.length > 300 || seen.has(token)) continue;
    const parts = token.split(':');
    const [kind, first, second] = parts;
    let origin: TimelineOriginFilter | undefined;
    if (kind === 'provider' && parts.length === 2 && isSafeOriginPart(first)) {
      origin = { kind: 'provider', provider: first };
    } else if (kind === 'monday' && parts.length === 2 && isSafeOriginPart(first)) {
      origin = { kind: 'monday_board', boardId: first };
    } else if (kind === 'github' && parts.length === 2 && isSafeOriginPart(first)) {
      origin = { kind: 'github_repo', repo: first };
    } else if (
      kind === 'slack' &&
      parts.length === 3 &&
      isSafeOriginPart(first) &&
      isSafeOriginPart(second)
    ) {
      origin = { kind: 'slack_channel', workspaceId: first, channelId: second };
    } else if (kind === 'slack' && parts.length === 2 && isSafeOriginPart(first)) {
      origin = { kind: 'slack_channel', channelId: first };
    } else if (kind === 'telegram' && parts.length === 2 && isSafeOriginPart(first)) {
      origin = { kind: 'telegram_chat', chatId: first };
    }
    if (!origin) continue;
    seen.add(token);
    origins.push(origin);
  }
  return origins;
}

export function timelineOriginValue(origin: TimelineOriginFilter): string {
  switch (origin.kind) {
    case 'provider':
      return `provider:${origin.provider}`;
    case 'monday_board':
      return `monday:${origin.boardId}`;
    case 'github_repo':
      return `github:${origin.repo}`;
    case 'slack_channel':
      return origin.workspaceId
        ? `slack:${origin.workspaceId}:${origin.channelId}`
        : `slack:${origin.channelId}`;
    case 'telegram_chat':
      return `telegram:${origin.chatId}`;
  }
}

export function timelineOriginOptions(
  facets: readonly TimelineSourceFacet[],
): TimelineOriginOption[] {
  return facets.map((facet) => ({
    value: timelineOriginValue(facet.filter),
    label: `${originGroupLabel(facet.filter)} · ${
      facet.filter.kind === 'provider' ? 'All activity' : facet.label
    }`,
  }));
}

function isSafeOriginPart(value: string | undefined): value is string {
  return Boolean(value && value.length <= 200 && !/[\s,]/.test(value));
}

function originGroupLabel(origin: TimelineOriginFilter): string {
  switch (origin.kind) {
    case 'provider':
      return providerDisplayLabel(origin.provider);
    case 'monday_board':
      return 'Monday.com board';
    case 'github_repo':
      return 'GitHub repository';
    case 'slack_channel':
      return 'Slack channel';
    case 'telegram_chat':
      return 'Telegram chat';
  }
}

function providerDisplayLabel(provider: string): string {
  const labels: Record<string, string> = {
    github: 'GitHub',
    google_drive: 'Google Drive',
    linear: 'Linear',
    monday: 'Monday.com',
    sentry: 'Sentry',
    slack: 'Slack integration',
  };
  return labels[provider] ?? provider;
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
