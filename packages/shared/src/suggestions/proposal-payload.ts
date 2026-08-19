const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_REF_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const DATETIME_LIKE_RE =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i;

export const RELATIONSHIP_KIND_VALUES = [
  'parent',
  'child',
  'related',
  'blocks',
  'blocked_by',
  'duplicate_of',
] as const;

export type RelationshipKind = (typeof RELATIONSHIP_KIND_VALUES)[number];

const RELATIONSHIP_KIND_ALIASES: Record<string, RelationshipKind> = {
  parent: 'parent',
  parent_of: 'parent',
  contains: 'parent',
  owns: 'parent',
  child: 'child',
  child_of: 'child',
  belongs_to: 'child',
  part_of: 'child',
  owned_by: 'child',
  related: 'related',
  related_to: 'related',
  relates: 'related',
  relates_to: 'related',
  associated: 'related',
  associated_with: 'related',
  association: 'related',
  mentions: 'related',
  mentioned: 'related',
  mentioned_in: 'related',
  linked: 'related',
  links: 'related',
  link: 'related',
  works_on: 'related',
  for: 'related',
  about: 'related',
  regarding: 'related',
  blocks: 'blocks',
  blocking: 'blocks',
  blocked_by: 'blocked_by',
  blocked: 'blocked_by',
  depends_on: 'blocked_by',
  dependency: 'blocked_by',
  duplicate_of: 'duplicate_of',
  duplicate: 'duplicate_of',
  duplicates: 'duplicate_of',
  dup: 'duplicate_of',
};

const CALENDAR_START_ALIASES = [
  'startsAt',
  'startTime',
  'start_at',
  'start',
  'startDateTime',
  'begin',
  'beginAt',
] as const;
const CALENDAR_END_ALIASES = [
  'endsAt',
  'endTime',
  'end_at',
  'end',
  'endDateTime',
  'finish',
  'finishAt',
] as const;
const CALENDAR_START_DATE_ALIASES = ['start_date', 'startsOn', 'startOn'] as const;
const CALENDAR_END_DATE_ALIASES = ['end_date', 'endsOn', 'endOn'] as const;
const CALENDAR_ALIAS_KEYS = [
  ...CALENDAR_START_ALIASES,
  ...CALENDAR_END_ALIASES,
  ...CALENDAR_START_DATE_ALIASES,
  ...CALENDAR_END_DATE_ALIASES,
  'all_day',
] as const;
const RELATIONSHIP_FROM_ALIASES = [
  'from',
  'from_entity_id',
  'fromId',
  'sourceId',
  'source',
  'sourceName',
] as const;
const RELATIONSHIP_TO_ALIASES = [
  'to',
  'to_entity_id',
  'toId',
  'targetId',
  'target',
  'targetName',
] as const;
const RELATIONSHIP_ALIAS_KEYS = [...RELATIONSHIP_FROM_ALIASES, ...RELATIONSHIP_TO_ALIASES] as const;

export interface ProposalPayloadItem {
  operation?: string;
  targetKind: string;
  title?: string;
  proposedPayload: unknown;
}

function omitKeys(
  payload: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const keySet = new Set(keys);
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !keySet.has(key)));
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

function localRefSlug(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '')
    .slice(0, 80)
    .replace(/[^a-z0-9]+$/, '');
  return LOCAL_REF_RE.test(normalized) ? normalized : null;
}

function looksLikeLocalRef(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed !== trimmed.toLowerCase() || /\s/.test(trimmed)) return false;
  const slug = localRefSlug(trimmed);
  return slug !== null && slug === trimmed && /[-_]/.test(trimmed);
}

function coerceIsoDateTime(value: string): string | null {
  const trimmed = value.trim();
  if (!DATETIME_LIKE_RE.test(trimmed)) return null;
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)
    ? trimmed.replace(' ', 'T')
    : `${trimmed.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function calendarInstantOrDate(value: unknown): { instant?: string; date?: string } {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { instant: value.toISOString() };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1e12 ? value * 1000 : value;
    const parsed = new Date(ms);
    if (!Number.isNaN(parsed.getTime())) return { instant: parsed.toISOString() };
    return {};
  }
  const text = trimmedString(value);
  if (!text) return {};
  if (LOCAL_DATE_RE.test(text)) return { date: text };
  const instant = coerceIsoDateTime(text);
  return instant ? { instant } : {};
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

function firstPresent(payload: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(payload, key) && isPresent(payload[key])) {
      return payload[key];
    }
  }
  return undefined;
}

function assignCalendarBound(
  payload: Record<string, unknown>,
  instantKey: 'startAt' | 'endAt',
  dateKey: 'startDate' | 'endDate',
  aliases: readonly string[],
): void {
  if (!Object.hasOwn(payload, instantKey)) {
    const aliased = firstPresent(payload, aliases);
    if (aliased !== undefined) payload[instantKey] = aliased;
  }
  const bound = calendarInstantOrDate(payload[instantKey]);
  if (bound.date) {
    if (dateKey === 'startDate' && !Object.hasOwn(payload, 'startDate')) {
      payload.startDate = bound.date;
    } else if (dateKey === 'endDate' && !Object.hasOwn(payload, 'endDate')) {
      payload.endDate = bound.date;
    }
    if (instantKey === 'startAt') delete payload.startAt;
    else delete payload.endAt;
    return;
  }
  if (bound.instant) payload[instantKey] = bound.instant;
}

export function normalizeCalendarProposalAliases(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...payload };
  if (!Object.hasOwn(normalized, 'startDate')) {
    const aliased = firstPresent(normalized, CALENDAR_START_DATE_ALIASES);
    if (typeof aliased === 'string') normalized.startDate = aliased;
  }
  if (!Object.hasOwn(normalized, 'endDate')) {
    const aliased = firstPresent(normalized, CALENDAR_END_DATE_ALIASES);
    if (typeof aliased === 'string') normalized.endDate = aliased;
  }
  assignCalendarBound(normalized, 'startAt', 'startDate', CALENDAR_START_ALIASES);
  assignCalendarBound(normalized, 'endAt', 'endDate', CALENDAR_END_ALIASES);
  if (!Object.hasOwn(normalized, 'allDay') && typeof normalized.all_day === 'boolean') {
    normalized.allDay = normalized.all_day;
  }
  return omitKeys(normalized, CALENDAR_ALIAS_KEYS);
}

export function coerceMemberIdFields(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...payload };
  if (
    !isUuid(normalized.ownerUserId) &&
    normalized.ownerUserId !== null &&
    normalized.ownerUserId !== undefined &&
    normalized.ownerUserId !== ''
  ) {
    if (trimmedString(normalized.ownerName) === null) {
      const nameFromId = trimmedString(normalized.ownerUserId);
      if (nameFromId) normalized.ownerName = nameFromId;
    }
    delete normalized.ownerUserId;
  }
  if (
    !isUuid(normalized.assigneeUserId) &&
    normalized.assigneeUserId !== null &&
    normalized.assigneeUserId !== undefined &&
    normalized.assigneeUserId !== ''
  ) {
    if (trimmedString(normalized.assigneeName) === null) {
      const nameFromId = trimmedString(normalized.assigneeUserId);
      if (nameFromId) normalized.assigneeName = nameFromId;
    }
    delete normalized.assigneeUserId;
  }
  return normalized;
}

function pickRelationshipEndpoint(
  payload: Record<string, unknown>,
  aliases: readonly string[],
  idValue: unknown,
  refValue: unknown,
  nameValue: unknown,
): { id?: string; ref?: string; name?: string } {
  let id = idValue;
  let ref = refValue;
  let name = nameValue;
  if (!isPresent(id) && !isPresent(ref) && trimmedString(name) === null) {
    const aliased = firstPresent(payload, aliases);
    if (aliased !== undefined) id = aliased;
  }

  if (typeof id === 'string' && !isUuid(id)) {
    const text = id.trim();
    if (looksLikeLocalRef(text)) {
      if (trimmedString(ref) === null) ref = localRefSlug(text);
    } else if (trimmedString(name) === null && text) {
      name = text;
    }
    id = undefined;
  } else if (isPresent(id) && !isUuid(id)) {
    id = undefined;
  }

  if (isUuid(id) && typeof id === 'string') return { id };
  const slug = trimmedString(ref) ? localRefSlug(trimmedString(ref) ?? '') : null;
  if (slug) return { ref: slug };
  const endpointName = trimmedString(name);
  if (endpointName) return { name: endpointName };
  return {};
}

export function normalizeRelationshipKind(value: unknown): RelationshipKind {
  if (typeof value !== 'string') return 'related';
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return RELATIONSHIP_KIND_ALIASES[normalized] ?? 'related';
}

export function normalizeRelationshipProposalPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const from = pickRelationshipEndpoint(
    payload,
    RELATIONSHIP_FROM_ALIASES,
    payload.fromEntityId,
    payload.fromRef,
    payload.fromName,
  );
  const to = pickRelationshipEndpoint(
    payload,
    RELATIONSHIP_TO_ALIASES,
    payload.toEntityId,
    payload.toRef,
    payload.toName,
  );
  const canonical = omitKeys(payload, [
    ...RELATIONSHIP_ALIAS_KEYS,
    'fromEntityId',
    'fromRef',
    'fromName',
    'toEntityId',
    'toRef',
    'toName',
    'kind',
  ]);
  canonical.kind = normalizeRelationshipKind(payload.kind);
  if (from.id) canonical.fromEntityId = from.id;
  else if (from.ref) canonical.fromRef = from.ref;
  else if (from.name) canonical.fromName = from.name;
  if (to.id) canonical.toEntityId = to.id;
  else if (to.ref) canonical.toRef = to.ref;
  else if (to.name) canonical.toName = to.name;
  if (
    canonical.kind === 'related' &&
    isUuid(canonical.fromEntityId) &&
    isUuid(canonical.toEntityId)
  ) {
    const [fromEntityId, toEntityId] = [canonical.fromEntityId, canonical.toEntityId].sort();
    canonical.fromEntityId = fromEntityId;
    canonical.toEntityId = toEntityId;
  }
  return canonical;
}

export function relationshipEndpointCount(
  payload: Record<string, unknown>,
  side: 'from' | 'to',
): number {
  return [`${side}EntityId`, `${side}Ref`, `${side}Name`].filter((key) =>
    Boolean(trimmedString(payload[key]) ?? (isUuid(payload[key]) ? payload[key] : null)),
  ).length;
}

export function normalizeProposalPayload(item: ProposalPayloadItem): Record<string, unknown> {
  let payload = coerceMemberIdFields(recordFromUnknown(item.proposedPayload));
  if (item.targetKind === 'calendar_event') {
    payload = normalizeCalendarProposalAliases(payload);
  }
  if (item.targetKind === 'object_relationship') {
    payload = normalizeRelationshipProposalPayload(payload);
  }
  return payload;
}

export function canonicalProposalPayloadIssues(item: ProposalPayloadItem): string[] {
  const payload = normalizeProposalPayload(item);
  const issues: string[] = [];
  for (const key of [
    'ownerUserId',
    'assigneeUserId',
    'fromEntityId',
    'toEntityId',
    'parentObjectId',
  ]) {
    const value = payload[key];
    if (value === null || value === undefined || value === '') continue;
    if (!isUuid(value)) {
      issues.push(`${key} is not a UUID`);
    }
  }
  if (item.targetKind === 'calendar_event' && item.operation === 'create') {
    const hasTimeHint = [
      'startAt',
      'endAt',
      'startDate',
      'endDate',
      ...CALENDAR_START_ALIASES,
      ...CALENDAR_END_ALIASES,
      ...CALENDAR_START_DATE_ALIASES,
      ...CALENDAR_END_DATE_ALIASES,
    ].some((key) => isPresent(payload[key]));
    if (hasTimeHint) {
      if (typeof payload.startAt !== 'string' && typeof payload.startDate !== 'string') {
        issues.push('calendar create is missing startAt/startDate');
      }
      if (
        typeof payload.endAt !== 'string' &&
        typeof payload.endDate !== 'string' &&
        typeof payload.startAt !== 'string' &&
        typeof payload.startDate !== 'string'
      ) {
        issues.push('calendar create is missing endAt/endDate');
      }
    }
  }
  if (item.targetKind === 'object_relationship') {
    if (
      !RELATIONSHIP_KIND_VALUES.includes(payload.kind as RelationshipKind) ||
      typeof payload.kind !== 'string'
    ) {
      issues.push('relationship kind is invalid');
    }
    if (relationshipEndpointCount(payload, 'from') !== 1) {
      issues.push('relationship source endpoint is not unique');
    }
    if (relationshipEndpointCount(payload, 'to') !== 1) {
      issues.push('relationship target endpoint is not unique');
    }
  }
  return issues;
}
