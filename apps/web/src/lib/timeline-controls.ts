import { localDateFromInstant, localDateSpanToUtcRange } from '@timeline/shared/time';

import type { ImpactKind } from '@/lib/timeline-moments';
import type { TimelineOriginFilter, TimelineSourceFacet } from '@timeline/shared/team-scope';

export const TIMELINE_UPCOMING_DAYS = 7;

export interface TimelineDateWindow {
  from: Date | undefined;
  to: Date;
  todayInput: string;
  maxUpcomingInput: string;
  effectiveToInput: string;
  wasUpcomingClamped: boolean;
}

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

export interface TimelineSourceSelection {
  source: string;
  origin: string;
}

function isDateInput(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function addDateInputDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startOfDateInput(value: string | null | undefined, timezone: string): Date | undefined {
  if (!isDateInput(value)) return undefined;
  try {
    return localDateSpanToUtcRange(value, addDateInputDays(value, 1), timezone).from;
  } catch {
    return undefined;
  }
}

function endOfDateInput(value: string | null | undefined, timezone: string): Date | undefined {
  if (!isDateInput(value)) return undefined;
  try {
    return localDateSpanToUtcRange(value, addDateInputDays(value, 1), timezone).to;
  } catch {
    return undefined;
  }
}

/**
 * Timeline is an activity archive. Upcoming calendar occurrences are opt-in and
 * bounded; the Calendar surface owns the full future schedule.
 */
export function resolveTimelineDateWindow(
  input: { from?: string | null; to?: string | null },
  timezone: string,
  now = new Date(),
): TimelineDateWindow {
  const todayInput = localDateFromInstant(now.toISOString(), timezone);
  const maxUpcomingInput = addDateInputDays(todayInput, TIMELINE_UPCOMING_DAYS);
  const requestedTo = endOfDateInput(input.to, timezone);
  const maxUpcomingTo = endOfDateInput(maxUpcomingInput, timezone) ?? now;
  const wasUpcomingClamped = Boolean(requestedTo && requestedTo > maxUpcomingTo);
  const to = requestedTo ? new Date(Math.min(requestedTo.getTime(), maxUpcomingTo.getTime())) : now;

  return {
    from: startOfDateInput(input.from, timezone),
    to,
    todayInput,
    maxUpcomingInput,
    effectiveToInput: requestedTo ? (wasUpcomingClamped ? maxUpcomingInput : (input.to ?? '')) : '',
    wasUpcomingClamped,
  };
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
  const unnamedSlackChannels = facets.filter(
    (facet) => facet.filter.kind === 'slack_channel' && facet.label === 'Unnamed channel',
  );
  const unnamedSlackChannelNumbers = new Map(
    unnamedSlackChannels
      .map((facet) => timelineOriginValue(facet.filter))
      .sort()
      .map((value, index) => [value, index + 1]),
  );

  return facets.map((facet) => {
    const value = timelineOriginValue(facet.filter);
    const unnamedChannelNumber = unnamedSlackChannelNumbers.get(value);
    const resourceLabel =
      unnamedChannelNumber && unnamedSlackChannels.length > 1
        ? `Unnamed channel ${unnamedChannelNumber}`
        : facet.label;
    return {
      value,
      label: `${originGroupLabel(facet.filter)} · ${
        facet.filter.kind === 'provider' ? 'All activity' : resourceLabel
      }`,
    };
  });
}

export function updateTimelineSourceSelection(
  current: TimelineSourceSelection,
  update: Partial<TimelineSourceSelection>,
): TimelineSourceSelection {
  if (update.source !== undefined) {
    return {
      source: update.source,
      origin: update.source ? '' : current.origin,
    };
  }
  if (update.origin !== undefined) {
    return {
      source: update.origin ? '' : current.source,
      origin: update.origin,
    };
  }
  return current;
}

export function isTimelinePresetActive(
  preset: TimelinePreset,
  input: {
    sourceFilters: readonly TimelineSource[];
    impactCount: number;
    hasOriginFilter: boolean;
  },
): boolean {
  if ('source' in preset) {
    return input.sourceFilters.length === 1 && preset.source === input.sourceFilters[0];
  }
  return input.sourceFilters.length === 0 && input.impactCount === 0 && !input.hasOriginFilter;
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

/** Primary loaded count: moments in Moments mode, events in All events. */
export function timelineLoadedCount(
  mode: 'moments' | 'events',
  momentCount: number,
  eventCount: number,
): number {
  return mode === 'moments' ? momentCount : eventCount;
}

export function timelineLoadedSrLabel(mode: 'moments' | 'events', loadedCount: number): string {
  if (mode === 'moments') {
    return loadedCount === 1 ? '1 moment loaded' : `${loadedCount} moments loaded`;
  }
  return loadedCount === 1 ? '1 event loaded' : `${loadedCount} events loaded`;
}

/** Preset footer: one primary count matching the active mode. */
export function timelinePresetCountLabel(
  mode: 'moments' | 'events',
  momentCount: number,
  eventCount: number,
): string {
  if (mode === 'moments') {
    return momentCount === 1 ? '1 moment' : `${momentCount} moments`;
  }
  return eventCount === 1 ? '1 source event' : `${eventCount} source events`;
}
