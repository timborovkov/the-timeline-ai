import { createHash } from 'node:crypto';

import {
  agentSuggestionEvidence,
  agentSuggestionItems,
  agentSuggestions,
  calendarEvents,
  entities,
  objectIdentityFacets,
  objectNotes,
  notifications,
  rawEvents,
  teamMembers,
  type Db,
} from '@timeline/db';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { BoardScope } from '#src/boards/index.js';
import type {
  CalendarScope,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
} from '#src/calendar/index.js';
import type {
  CreateObjectInput,
  IdentityFacetInput,
  ObjectPatch,
  ObjectScope,
  ObjectType,
} from '#src/objects/index.js';
import type { TeamRole } from '#src/team-scope.js';

import { childLogger } from '#src/logger.js';
import { OBJECT_TYPES } from '#src/objects/index.js';
import { localDateFromInstant, localDateSpanToUtcRange } from '#src/time/index.js';

type Visibility = 'private' | 'team' | 'specific_users';
type SuggestionStatus = 'pending' | 'partially_resolved' | 'accepted' | 'rejected' | 'superseded';
type ItemStatus = 'pending' | 'accepted' | 'rejected' | 'failed' | 'superseded';
type Operation = 'create' | 'update' | 'archive_or_cancel' | 'merge';
type TargetKind =
  | 'object'
  | 'task'
  | 'calendar_event'
  | 'identity_facet'
  | 'object_note'
  | 'object_relationship'
  | 'object_merge'
  | 'board_membership'
  | 'board_item_update';

const EXPECTED_SUGGESTION_APPLY_FAILURE_CODE = 'TIMELINE_EXPECTED_SUGGESTION_APPLY_FAILURE';
const ENTITY_CANONICAL_NAME_UNIQUE_CONSTRAINT = 'entities_team_type_canonical_name_unq';

class ExpectedSuggestionApplyFailure extends Error {
  readonly code = EXPECTED_SUGGESTION_APPLY_FAILURE_CODE;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExpectedSuggestionApplyFailure';
  }
}

function errorCode(err: unknown): unknown {
  return err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
}

function errorConstraint(err: unknown): unknown {
  return err && typeof err === 'object' ? (err as { constraint?: unknown }).constraint : undefined;
}

function errorCause(err: unknown): unknown {
  return err && typeof err === 'object' ? (err as { cause?: unknown }).cause : undefined;
}

function errorMessageIncludes(err: unknown, value: string): boolean {
  return err instanceof Error && err.message.includes(value);
}

function isEntityCanonicalNameDuplicate(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (
    errorCode(err) === '23505' &&
    (errorConstraint(err) === ENTITY_CANONICAL_NAME_UNIQUE_CONSTRAINT ||
      errorMessageIncludes(err, ENTITY_CANONICAL_NAME_UNIQUE_CONSTRAINT))
  ) {
    return true;
  }
  const cause = errorCause(err);
  return cause ? isEntityCanonicalNameDuplicate(cause) : false;
}

function isExpectedApplyFailure(err: unknown): boolean {
  return err instanceof z.ZodError || isEntityCanonicalNameDuplicate(err);
}

export interface SuggestionScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (role?: TeamRole) => Promise<TeamRole>;
  requireTeamMember: (otherUserId: string) => Promise<void>;
  objects: ObjectScope;
  boards: BoardScope;
  calendar: CalendarScope;
}

export interface SuggestionItemInput {
  operation: Operation;
  targetKind: TargetKind;
  targetId?: string | null;
  title: string;
  description?: string | null;
  dedupeKey: string;
  proposedPayload: Record<string, unknown>;
}

export interface SuggestionEvidenceInput {
  rawEventId: string;
  quote?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateSuggestionInput {
  source: 'chat' | 'background';
  title: string;
  summary?: string | null;
  reason?: string | null;
  confidence?: 'low' | 'medium' | 'high';
  dedupeKey: string;
  visibility?: Visibility;
  visibilityOwnerUserId?: string | null;
  visibilityUserIds?: string[] | null;
  metadata?: Record<string, unknown>;
  evidence?: SuggestionEvidenceInput[];
  items: SuggestionItemInput[];
}

export type SuggestionListStatus = 'pending' | 'resolved' | 'failed' | 'all';

export interface SuggestionBundle {
  id: string;
  source: 'chat' | 'background';
  status: SuggestionStatus;
  title: string;
  summary: string | null;
  reason: string | null;
  confidence: string;
  visibility: Visibility;
  visibilityOwnerUserId: string | null;
  visibilityUserIds: string[] | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  items: SuggestionItem[];
  evidence: SuggestionEvidence[];
}

export interface SuggestionItem {
  id: string;
  status: ItemStatus;
  operation: Operation;
  targetKind: TargetKind;
  targetId: string | null;
  resultId: string | null;
  title: string;
  description: string | null;
  proposedPayload: Record<string, unknown>;
  failureReason: string | null;
  supersededByItemId: string | null;
  supersededReason: string | null;
}

export interface SuggestionEvidence {
  id: string;
  rawEventId: string;
  quote: string | null;
  occurredAt: Date | null;
  source: string | null;
}

export interface DuplicatePendingApprovalPair {
  supersededItemId: string;
  supersededSuggestionId: string;
  survivorItemId: string;
  survivorSuggestionId: string;
  reason: string;
}

export interface DuplicatePendingApprovalReconcileResult {
  scanned: number;
  superseded: number;
  pairs: DuplicatePendingApprovalPair[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const uuid = z.string().regex(UUID_RE);
const localRef = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);

const objectPayloadFields = {
  aliases: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  stage: z.string().trim().max(40).nullable().optional(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  ownerUserId: uuid.nullable().optional(),
  assigneeUserId: uuid.nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

const objectCreatePayload = z.object({
  ...objectPayloadFields,
  type: z.string().optional(),
  canonicalName: z.string().trim().max(200).optional(),
  parentObjectId: uuid.nullable().optional(),
  sourceEventId: uuid.nullable().optional(),
});

const objectUpdatePayload = z.object({
  ...objectPayloadFields,
  canonicalName: z.string().trim().min(1).max(200).optional(),
});

const identityFacetPayload = z.object({
  entityId: uuid,
  kind: z.enum(['email', 'phone', 'telegram', 'slack', 'github', 'timeline_user', 'other']),
  value: z.string().trim().min(1).max(300),
  normalizedValue: z.string().trim().min(1).max(300).optional(),
  provider: z.string().trim().min(1).max(80).nullable().optional(),
  externalId: z.string().trim().min(1).max(200).nullable().optional(),
  linkedUserId: uuid.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const objectNotePayload = z.object({
  entityId: uuid.optional(),
  entityName: z.string().trim().min(1).max(200).optional(),
  entityType: z.string().trim().min(1).max(40).optional(),
  noteId: uuid.optional(),
  body: z.string().trim().min(1).max(5000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const objectRelationshipPayload = z
  .object({
    fromEntityId: uuid.optional(),
    toEntityId: uuid.optional(),
    fromRef: localRef.optional(),
    toRef: localRef.optional(),
    kind: z.enum(['parent', 'child', 'related', 'blocks', 'blocked_by', 'duplicate_of']),
  })
  .superRefine((payload, ctx) => {
    if (Boolean(payload.fromEntityId) === Boolean(payload.fromRef)) {
      ctx.addIssue({
        code: 'custom',
        path: ['fromEntityId'],
        message: 'Provide exactly one relationship source endpoint',
      });
    }
    if (Boolean(payload.toEntityId) === Boolean(payload.toRef)) {
      ctx.addIssue({
        code: 'custom',
        path: ['toEntityId'],
        message: 'Provide exactly one relationship target endpoint',
      });
    }
  });

const objectMergePayload = z.object({
  objectIds: z.array(uuid).min(2).max(10),
  survivorId: uuid,
  reason: z.string().trim().max(1000).optional(),
});

const boardMembershipPayload = z.object({
  boardId: uuid,
  entityId: uuid,
  laneId: uuid.nullable().optional(),
  sourceEventId: uuid.nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

const boardItemUpdatePayload = z.object({
  boardItemId: uuid,
  field: z.enum([
    'laneId',
    'position',
    'responsibleUserId',
    'dueAt',
    'priority',
    'nextStep',
    'notes',
    'customFields',
  ]),
  newValue: z.unknown(),
  sourceEventId: uuid.nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

const calendarCreatePayload = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  startDate: z.string().regex(LOCAL_DATE_RE).optional(),
  endDate: z.string().regex(LOCAL_DATE_RE).optional(),
  timezone: z.string().max(100).default('UTC'),
  allDay: z.boolean().default(false),
  location: z.string().trim().max(500).nullable().optional(),
  showAs: z.enum(['busy', 'free', 'tentative']).optional(),
  rrule: z.string().trim().max(2000).nullable().optional(),
  recurrenceEditMode: z.enum(['single', 'series', 'this_and_future']).optional(),
  visibility: z.enum(['team', 'private', 'specific_users']).default('team'),
  visibilityUserIds: z.array(uuid).nullable().optional(),
  reminderMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  linkedEntityIds: z.array(uuid).max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  proposalGroupId: z.string().trim().max(120).optional(),
  proposalStatus: z.enum(['tentative', 'confirmed']).optional(),
  proposalRole: z.enum(['slot', 'selected_slot']).optional(),
});

const calendarUpdatePayload = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  startAt: z.iso.datetime().optional(),
  endAt: z.iso.datetime().optional(),
  startDate: z.string().regex(LOCAL_DATE_RE).optional(),
  endDate: z.string().regex(LOCAL_DATE_RE).optional(),
  timezone: z.string().max(100).optional(),
  allDay: z.boolean().optional(),
  location: z.string().trim().max(500).nullable().optional(),
  showAs: z.enum(['busy', 'free', 'tentative']).optional(),
  rrule: z.string().trim().max(2000).nullable().optional(),
  recurrenceEditMode: z.enum(['single', 'series', 'this_and_future']).optional(),
  visibility: z.enum(['team', 'private', 'specific_users']).optional(),
  visibilityUserIds: z.array(uuid).nullable().optional(),
  reminderMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  linkedEntityIds: z.array(uuid).max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  proposalGroupId: z.string().trim().max(120).optional(),
  proposalStatus: z.enum(['tentative', 'confirmed']).optional(),
  proposalRole: z.enum(['slot', 'selected_slot']).optional(),
});

function normalizeCalendarPayload(
  item: typeof agentSuggestionItems.$inferSelect,
  opts: {
    fallbackTitle: boolean;
    defaultTimezone?: string;
    inferAllDayFromDateOnly?: boolean;
    materializeDefaultTimezone?: boolean;
  },
): Record<string, unknown> {
  const payload = item.proposedPayload as Record<string, unknown>;
  const normalized = { ...payload };
  if (!Object.hasOwn(normalized, 'title') && opts.fallbackTitle) normalized.title = item.title;
  if (!Object.hasOwn(normalized, 'startDate') && typeof payload.start_date === 'string') {
    normalized.startDate = payload.start_date;
  }
  if (!Object.hasOwn(normalized, 'endDate') && typeof payload.end_date === 'string') {
    normalized.endDate = payload.end_date;
  }
  if (!Object.hasOwn(normalized, 'startAt')) {
    if (typeof payload.startTime === 'string') normalized.startAt = payload.startTime;
    else if (typeof payload.start_at === 'string') normalized.startAt = payload.start_at;
    else if (typeof payload.start === 'string') normalized.startAt = payload.start;
  }
  if (!Object.hasOwn(normalized, 'endAt')) {
    if (typeof payload.endTime === 'string') normalized.endAt = payload.endTime;
    else if (typeof payload.end_at === 'string') normalized.endAt = payload.end_at;
    else if (typeof payload.end === 'string') normalized.endAt = payload.end;
  }
  if (!Object.hasOwn(normalized, 'allDay') && typeof payload.all_day === 'boolean') {
    normalized.allDay = payload.all_day;
  }
  if (
    opts.inferAllDayFromDateOnly === true &&
    !Object.hasOwn(normalized, 'allDay') &&
    typeof normalized.startDate === 'string' &&
    LOCAL_DATE_RE.test(normalized.startDate) &&
    !Object.hasOwn(normalized, 'startAt') &&
    !Object.hasOwn(normalized, 'endAt')
  ) {
    normalized.allDay = true;
  }
  if (
    normalized.allDay === true &&
    typeof normalized.startDate === 'string' &&
    LOCAL_DATE_RE.test(normalized.startDate) &&
    (typeof normalized.endDate !== 'string' || LOCAL_DATE_RE.test(normalized.endDate)) &&
    !Object.hasOwn(normalized, 'startAt') &&
    !Object.hasOwn(normalized, 'endAt')
  ) {
    const timezone =
      typeof normalized.timezone === 'string'
        ? normalized.timezone
        : (opts.defaultTimezone ?? 'UTC');
    const endDate =
      typeof normalized.endDate === 'string'
        ? normalized.endDate
        : oneDayAfter(normalized.startDate);
    const range = localDateSpanToUtcRange(normalized.startDate, endDate, timezone);
    if (!Object.hasOwn(normalized, 'startAt')) normalized.startAt = range.from.toISOString();
    if (!Object.hasOwn(normalized, 'endAt')) normalized.endAt = range.to.toISOString();
    if (opts.materializeDefaultTimezone === true && !Object.hasOwn(normalized, 'timezone')) {
      normalized.timezone = timezone;
    }
  }
  return normalized;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function suggestionDedupeKey(parts: unknown): string {
  return createHash('sha256').update(stableStringify(parts)).digest('hex');
}

const ACTIONABLE_ITEM_STATUSES: ItemStatus[] = ['pending', 'failed'];
const log = childLogger('suggestions');

function actionableItemExistsPredicate() {
  return sql`EXISTS (
    SELECT 1 FROM ${agentSuggestionItems}
    WHERE ${agentSuggestionItems.suggestionId} = ${agentSuggestions.id}
      AND ${agentSuggestionItems.status} IN ('pending', 'failed')
  )`;
}

function suggestionVisibilityPredicate(teamId: string, userId: string) {
  return and(
    eq(agentSuggestions.teamId, teamId),
    or(
      eq(agentSuggestions.visibility, 'team'),
      and(
        eq(agentSuggestions.visibility, 'private'),
        eq(agentSuggestions.visibilityOwnerUserId, userId),
      ),
      and(
        eq(agentSuggestions.visibility, 'specific_users'),
        sql`${userId}::uuid = ANY(${agentSuggestions.visibilityUserIds})`,
      ),
    ),
  );
}

function itemPayloadKeys(item: typeof agentSuggestionItems.$inferSelect): Set<string> {
  return new Set(Object.keys(normalizeLifecyclePayload(item)));
}

function payloadKeysOverlap(
  left: typeof agentSuggestionItems.$inferSelect,
  right: typeof agentSuggestionItems.$inferSelect,
): boolean {
  const leftKeys = itemPayloadKeys(left);
  const rightKeys = itemPayloadKeys(right);
  if (leftKeys.size === 0 || rightKeys.size === 0) return true;
  for (const key of leftKeys) {
    if (rightKeys.has(key)) return true;
  }
  return false;
}

function itemArtifactIds(item: typeof agentSuggestionItems.$inferSelect): Set<string> {
  if (item.targetKind === 'object_note' && item.operation === 'create') {
    return new Set([item.resultId].filter((id): id is string => Boolean(id)));
  }
  return new Set([item.targetId, item.resultId].filter((id): id is string => Boolean(id)));
}

function artifactExternalKey(item: typeof agentSuggestionItems.$inferSelect): string | null {
  const record = normalizeLifecyclePayload(item);
  const metadata =
    record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : {};
  const provider =
    typeof metadata.integration_provider === 'string'
      ? metadata.integration_provider
      : typeof record.provider === 'string'
        ? record.provider
        : null;
  const externalObjectId =
    typeof metadata.integration_external_id === 'string'
      ? metadata.integration_external_id
      : typeof record.externalObjectId === 'string'
        ? record.externalObjectId
        : null;
  if (provider && externalObjectId)
    return `${item.targetKind}:integration:${provider}:${externalObjectId}`;

  const externalCalendarId =
    typeof record.externalCalendarId === 'string' ? record.externalCalendarId : null;
  const externalEventId =
    typeof record.externalEventId === 'string' ? record.externalEventId : null;
  if (externalCalendarId && externalEventId) {
    return `${item.targetKind}:calendar:${externalCalendarId}:${externalEventId}`;
  }
  return null;
}

const APPROVAL_TOKEN_STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'ask',
  'call',
  'create',
  'from',
  'have',
  'into',
  'make',
  'next',
  'please',
  'task',
  'that',
  'their',
  'this',
  'with',
  'would',
  'kysy',
  'luo',
  'soita',
  'tehtava',
  'viel',
]);

const OBJECT_TYPE_SET = new Set<string>(OBJECT_TYPES);
type LifecycleStatusType = 'task' | 'follow_up' | 'project';

function objectTypeFromValue(value: unknown): ObjectType | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return OBJECT_TYPE_SET.has(trimmed) ? (trimmed as ObjectType) : null;
}

function lifecycleStatusTypeForPayload(
  item: Pick<typeof agentSuggestionItems.$inferSelect, 'targetKind'>,
  payload: Record<string, unknown>,
  objectType?: ObjectType | null,
): LifecycleStatusType | null {
  if (item.targetKind === 'task') return 'task';
  if (item.targetKind !== 'object') return null;
  const type = objectType ?? objectTypeFromValue(payload.type);
  return type === 'task' || type === 'follow_up' || type === 'project' ? type : null;
}

function normalizeLifecycleStatus(value: unknown, type: LifecycleStatusType): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (type === 'project') {
    if (normalized === 'proposed') return 'planning';
    if (
      normalized === 'in progress' ||
      normalized === 'in_progress' ||
      normalized === 'in-progress'
    ) {
      return 'active';
    }
    if (normalized === 'started' || normalized === 'doing') return 'active';
    if (normalized === 'complete' || normalized === 'completed' || normalized === 'finished') {
      return 'shipped';
    }
    if (normalized === 'done') return 'shipped';
    if (normalized === 'canceled') return 'cancelled';
    return normalized;
  }
  if (normalized === 'proposed' || normalized === 'suggested' || normalized === 'pending') {
    return 'todo';
  }
  if (
    normalized === 'in progress' ||
    normalized === 'in_progress' ||
    normalized === 'in-progress' ||
    normalized === 'started'
  ) {
    return 'doing';
  }
  if (normalized === 'complete' || normalized === 'completed' || normalized === 'finished') {
    return 'done';
  }
  if (normalized === 'open') return 'todo';
  if (normalized === 'canceled') return 'cancelled';
  return normalized;
}

function normalizeLifecyclePayload(
  item: Pick<typeof agentSuggestionItems.$inferSelect, 'targetKind' | 'proposedPayload'> & {
    objectType?: ObjectType | null;
  },
): Record<string, unknown> {
  const payload =
    item.proposedPayload &&
    typeof item.proposedPayload === 'object' &&
    !Array.isArray(item.proposedPayload)
      ? { ...(item.proposedPayload as Record<string, unknown>) }
      : {};
  const lifecycleType = lifecycleStatusTypeForPayload(item, payload, item.objectType);
  if (lifecycleType && Object.hasOwn(payload, 'status')) {
    payload.status = normalizeLifecycleStatus(payload.status, lifecycleType);
  }
  if (
    item.targetKind === 'object_relationship' &&
    payload.kind === 'related' &&
    typeof payload.fromEntityId === 'string' &&
    typeof payload.toEntityId === 'string'
  ) {
    const [fromEntityId, toEntityId] = [payload.fromEntityId, payload.toEntityId].sort();
    payload.fromEntityId = fromEntityId;
    payload.toEntityId = toEntityId;
  }
  return payload;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function mergeAliases(existing: string[], proposed: string[]): string[] {
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const alias of [...existing, ...proposed]) {
    const trimmed = alias.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(trimmed);
  }
  return aliases;
}

function normalizedApprovalText(value: unknown): string {
  return typeof value === 'string'
    ? value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    : '';
}

function normalizedLocalRef(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

function approvalTextForItem(item: typeof agentSuggestionItems.$inferSelect): string {
  const payload = normalizeLifecyclePayload(item);
  return [
    item.title,
    item.description,
    payload.canonicalName,
    payload.title,
    payload.name,
    payload.description,
  ]
    .map(normalizedApprovalText)
    .filter(Boolean)
    .join(' ');
}

function distinctiveApprovalTokens(item: typeof agentSuggestionItems.$inferSelect): string[] {
  return [
    ...new Set(
      approvalTextForItem(item)
        .split(/\s+/)
        .filter((token) => token.length >= 8 && !APPROVAL_TOKEN_STOPWORDS.has(token)),
    ),
  ];
}

function sameLongTokenFamily(left: string, right: string): boolean {
  const leftVariants = tokenFamilyVariants(left);
  const rightVariants = tokenFamilyVariants(right);
  return leftVariants.some((leftVariant) =>
    rightVariants.some((rightVariant) => {
      if (leftVariant === rightVariant) return true;
      const shortest = Math.min(leftVariant.length, rightVariant.length);
      return shortest >= 10 && leftVariant.slice(0, shortest) === rightVariant.slice(0, shortest);
    }),
  );
}

function tokenFamilyVariants(token: string): string[] {
  const variants = new Set([token]);
  for (const suffix of ['kselle', 'kselta', 'ksessa', 'ksesta', 'ksella']) {
    if (token.endsWith(suffix) && token.length > suffix.length + 6) {
      variants.add(`${token.slice(0, -suffix.length)}s`);
    }
  }
  return [...variants];
}

function sharesDistinctiveApprovalSubject(
  left: typeof agentSuggestionItems.$inferSelect,
  right: typeof agentSuggestionItems.$inferSelect,
): boolean {
  const rightTokens = distinctiveApprovalTokens(right);
  return distinctiveApprovalTokens(left).some((leftToken) =>
    rightTokens.some((rightToken) => sameLongTokenFamily(leftToken, rightToken)),
  );
}

function normalizedPrimaryApprovalName(item: typeof agentSuggestionItems.$inferSelect): string {
  const payload = normalizeLifecyclePayload(item);
  return (
    normalizedApprovalText(payload.canonicalName) ||
    normalizedApprovalText(payload.title) ||
    normalizedApprovalText(item.title)
  );
}

function samePendingCreateApprovalSubject(args: {
  olderItem: typeof agentSuggestionItems.$inferSelect;
  olderSuggestion: typeof agentSuggestions.$inferSelect;
  newerItem: typeof agentSuggestionItems.$inferSelect;
  newerSuggestion: typeof agentSuggestions.$inferSelect;
}): boolean {
  const { olderItem, olderSuggestion, newerItem, newerSuggestion } = args;
  if (olderItem.operation !== 'create' || newerItem.operation !== 'create') return false;
  if (olderItem.targetId || newerItem.targetId) return false;
  if (!sameConversationReview(olderSuggestion, newerSuggestion)) return false;

  const olderName = normalizedPrimaryApprovalName(olderItem);
  const newerName = normalizedPrimaryApprovalName(newerItem);
  if (olderName && olderName === newerName) return true;

  return (
    olderSuggestion.id === newerSuggestion.id &&
    sharesDistinctiveApprovalSubject(olderItem, newerItem)
  );
}

function sameAudience(
  left: typeof agentSuggestions.$inferSelect,
  right: typeof agentSuggestions.$inferSelect,
): boolean {
  return (
    left.visibility === right.visibility &&
    left.visibilityOwnerUserId === right.visibilityOwnerUserId &&
    stableStringify(left.visibilityUserIds ?? []) === stableStringify(right.visibilityUserIds ?? [])
  );
}

function sameConversationReview(
  left: typeof agentSuggestions.$inferSelect,
  right: typeof agentSuggestions.$inferSelect,
): boolean {
  const leftMetadata =
    left.metadata && typeof left.metadata === 'object'
      ? (left.metadata as Record<string, unknown>)
      : {};
  const rightMetadata =
    right.metadata && typeof right.metadata === 'object'
      ? (right.metadata as Record<string, unknown>)
      : {};
  return (
    typeof leftMetadata.conversation_review_id === 'string' &&
    leftMetadata.conversation_review_id === rightMetadata.conversation_review_id
  );
}

function shouldSupersedePendingItem(args: {
  olderItem: typeof agentSuggestionItems.$inferSelect;
  olderSuggestion: typeof agentSuggestions.$inferSelect;
  newerItem: typeof agentSuggestionItems.$inferSelect;
  newerSuggestion: typeof agentSuggestions.$inferSelect;
}): boolean {
  const { olderItem, olderSuggestion, newerItem, newerSuggestion } = args;
  if (!sameAudience(olderSuggestion, newerSuggestion)) return false;
  if (olderItem.id === newerItem.id) return false;
  if (olderItem.targetKind !== newerItem.targetKind) return false;

  if (olderItem.targetKind === 'object_merge' && newerItem.targetKind === 'object_merge') {
    const olderPayload = objectMergePayload.safeParse(olderItem.proposedPayload);
    const newerPayload = objectMergePayload.safeParse(newerItem.proposedPayload);
    if (!olderPayload.success || !newerPayload.success) return false;
    return (
      stableStringify([...olderPayload.data.objectIds].sort()) ===
      stableStringify([...newerPayload.data.objectIds].sort())
    );
  }

  const olderExternalKey = artifactExternalKey(olderItem);
  if (olderExternalKey && olderExternalKey === artifactExternalKey(newerItem)) return true;

  const newerArtifactIds = itemArtifactIds(newerItem);
  const sameArtifact = [...itemArtifactIds(olderItem)].some((id) => newerArtifactIds.has(id));
  if (sameArtifact) {
    if (
      olderItem.operation === 'archive_or_cancel' ||
      newerItem.operation === 'archive_or_cancel'
    ) {
      return true;
    }
    if (olderItem.operation === 'create' || newerItem.operation === 'create') {
      return payloadKeysOverlap(olderItem, newerItem);
    }
    return olderItem.operation === newerItem.operation && payloadKeysOverlap(olderItem, newerItem);
  }

  return (
    !olderItem.targetId &&
    !newerItem.targetId &&
    olderItem.operation === newerItem.operation &&
    (olderItem.dedupeKey === newerItem.dedupeKey ||
      olderItem.title === newerItem.title ||
      samePendingCreateApprovalSubject(args)) &&
    sameConversationReview(olderSuggestion, newerSuggestion)
  );
}

function rawEventVisibilityPredicate(teamId: string, userId: string) {
  return and(
    eq(rawEvents.teamId, teamId),
    or(
      eq(rawEvents.visibility, 'team'),
      and(eq(rawEvents.visibility, 'private'), eq(rawEvents.authorUserId, userId)),
      and(
        eq(rawEvents.visibility, 'specific_users'),
        sql`${userId}::uuid = ANY(${rawEvents.visibilityUserIds})`,
      ),
    ),
  );
}

function oneDayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function normalizeAllDayRange(payload: {
  startAt: string;
  endAt: string;
  timezone: string;
  startDate?: string;
  endDate?: string;
}): {
  startAt: Date;
  endAt: Date;
} {
  const startDate = payload.startDate ?? localDateFromInstant(payload.startAt, payload.timezone);
  let endDate = payload.endDate ?? localDateFromInstant(payload.endAt, payload.timezone);
  if (endDate <= startDate) endDate = oneDayAfter(startDate);
  const range = localDateSpanToUtcRange(startDate, endDate, payload.timezone);
  return { startAt: range.from, endAt: range.to };
}

function toBundle(
  row: typeof agentSuggestions.$inferSelect,
  items: (typeof agentSuggestionItems.$inferSelect)[],
  evidence: (typeof agentSuggestionEvidence.$inferSelect & {
    occurredAt?: Date | null;
    source?: string | null;
  })[],
): SuggestionBundle {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    title: row.title,
    summary: row.summary,
    reason: row.reason,
    confidence: row.confidence,
    visibility: row.visibility,
    visibilityOwnerUserId: row.visibilityOwnerUserId,
    visibilityUserIds: row.visibilityUserIds,
    metadata:
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items: items.map((item) => ({
      id: item.id,
      status: item.status,
      operation: item.operation,
      targetKind: item.targetKind,
      targetId: item.targetId,
      resultId: item.resultId,
      title: item.title,
      description: item.description,
      proposedPayload: item.proposedPayload as Record<string, unknown>,
      failureReason: item.failureReason,
      supersededByItemId: item.supersededByItemId,
      supersededReason: item.supersededReason,
    })),
    evidence: evidence.map((ev) => ({
      id: ev.id,
      rawEventId: ev.rawEventId,
      quote: ev.quote,
      occurredAt: ev.occurredAt ?? null,
      source: ev.source ?? null,
    })),
  };
}

export function createSuggestionScope(deps: SuggestionScopeDeps) {
  const { db, teamId, userId, ensureMember, objects, boards, calendar } = deps;

  async function resolveCurrentObjectId(entityId: string): Promise<string | null> {
    if (!UUID_RE.test(entityId)) return null;
    const seen = new Set<string>();
    let currentId = entityId;
    for (;;) {
      if (seen.has(currentId)) return null;
      seen.add(currentId);
      const rows = await db
        .select({ id: entities.id, mergedIntoId: entities.mergedIntoId })
        .from(entities)
        .where(and(eq(entities.id, currentId), eq(entities.teamId, teamId)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      if (!row.mergedIntoId) return row.id;
      currentId = row.mergedIntoId;
    }
  }

  async function resolveCurrentObjectIds(entityIds: string[]): Promise<string[]> {
    const resolved: string[] = [];
    for (const entityId of entityIds) {
      const currentId = await resolveCurrentObjectId(entityId);
      if (currentId && !resolved.includes(currentId)) resolved.push(currentId);
    }
    return resolved;
  }

  async function loadBundle(id: string): Promise<SuggestionBundle | null> {
    await ensureMember();
    const rows = await db
      .select()
      .from(agentSuggestions)
      .where(and(eq(agentSuggestions.id, id), suggestionVisibilityPredicate(teamId, userId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const bundles = await hydrateBundles([row]);
    return bundles[0] ?? null;
  }

  async function hydrateBundles(
    rows: (typeof agentSuggestions.$inferSelect)[],
  ): Promise<SuggestionBundle[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [items, evidence] = await Promise.all([
      db
        .select()
        .from(agentSuggestionItems)
        .where(inArray(agentSuggestionItems.suggestionId, ids))
        .orderBy(
          asc(agentSuggestionItems.suggestionId),
          asc(agentSuggestionItems.createdAt),
          asc(agentSuggestionItems.id),
        ),
      db
        .select({
          id: agentSuggestionEvidence.id,
          suggestionId: agentSuggestionEvidence.suggestionId,
          teamId: agentSuggestionEvidence.teamId,
          rawEventId: agentSuggestionEvidence.rawEventId,
          quote: agentSuggestionEvidence.quote,
          metadata: agentSuggestionEvidence.metadata,
          createdAt: agentSuggestionEvidence.createdAt,
          occurredAt: rawEvents.occurredAt,
          source: rawEvents.source,
        })
        .from(agentSuggestionEvidence)
        .leftJoin(rawEvents, eq(rawEvents.id, agentSuggestionEvidence.rawEventId))
        .where(inArray(agentSuggestionEvidence.suggestionId, ids))
        .orderBy(asc(agentSuggestionEvidence.suggestionId), asc(agentSuggestionEvidence.createdAt)),
    ]);
    const itemsBySuggestion = new Map<string, (typeof agentSuggestionItems.$inferSelect)[]>();
    for (const item of items) {
      const existing = itemsBySuggestion.get(item.suggestionId) ?? [];
      existing.push(item);
      itemsBySuggestion.set(item.suggestionId, existing);
    }
    const evidenceBySuggestion = new Map<string, typeof evidence>();
    for (const ev of evidence) {
      const existing = evidenceBySuggestion.get(ev.suggestionId) ?? [];
      existing.push(ev);
      evidenceBySuggestion.set(ev.suggestionId, existing);
    }
    return rows.map((row) =>
      toBundle(row, itemsBySuggestion.get(row.id) ?? [], evidenceBySuggestion.get(row.id) ?? []),
    );
  }

  async function refreshBundleStatus(suggestionId: string, resolvedByUserId?: string) {
    const items = await db
      .select({ status: agentSuggestionItems.status })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.suggestionId, suggestionId));
    const actionable = items.filter((i) => ACTIONABLE_ITEM_STATUSES.includes(i.status)).length;
    const accepted = items.filter((i) => i.status === 'accepted').length;
    const rejected = items.filter((i) => i.status === 'rejected').length;
    const superseded = items.filter((i) => i.status === 'superseded').length;
    const status: SuggestionStatus =
      actionable > 0
        ? accepted > 0 || rejected > 0 || superseded > 0
          ? 'partially_resolved'
          : 'pending'
        : superseded > 0 && accepted === 0 && rejected === 0
          ? 'superseded'
          : accepted > 0 && rejected === 0 && superseded === 0
            ? 'accepted'
            : rejected > 0 && accepted === 0 && superseded === 0
              ? 'rejected'
              : 'partially_resolved';
    await db
      .update(agentSuggestions)
      .set({
        status,
        updatedAt: new Date(),
        ...(actionable === 0
          ? { resolvedAt: new Date(), resolvedByUserId: resolvedByUserId ?? null }
          : {}),
      })
      .where(eq(agentSuggestions.id, suggestionId));
  }

  async function supersedeItem(
    itemId: string,
    supersededByItemId: string | null,
    reason: string,
  ): Promise<boolean> {
    const [row] = await db
      .update(agentSuggestionItems)
      .set({
        status: 'superseded',
        supersededByItemId,
        supersededReason: reason,
        resolvedAt: new Date(),
        resolvedByUserId: null,
        updatedAt: new Date(),
        failureReason: null,
      })
      .where(
        and(
          eq(agentSuggestionItems.id, itemId),
          inArray(agentSuggestionItems.status, ACTIONABLE_ITEM_STATUSES),
        ),
      )
      .returning();
    if (!row) return false;
    await supersedeRelationshipDependents(row);
    await refreshBundleStatus(row.suggestionId);
    return true;
  }

  function isOlderPendingItem(
    candidate: typeof agentSuggestionItems.$inferSelect,
    newerItem: typeof agentSuggestionItems.$inferSelect,
  ): boolean {
    if (candidate.id === newerItem.id) return false;
    const candidateTime = candidate.createdAt.getTime();
    const newerTime = newerItem.createdAt.getTime();
    return (
      candidateTime < newerTime || (candidateTime === newerTime && candidate.id < newerItem.id)
    );
  }

  async function reconcileNewSuggestionItems(suggestionId: string): Promise<void> {
    const [newerSuggestion] = await db
      .select()
      .from(agentSuggestions)
      .where(eq(agentSuggestions.id, suggestionId))
      .limit(1);
    if (!newerSuggestion) return;
    const newerItems = await db
      .select()
      .from(agentSuggestionItems)
      .where(
        and(
          eq(agentSuggestionItems.suggestionId, suggestionId),
          inArray(agentSuggestionItems.status, ACTIONABLE_ITEM_STATUSES),
        ),
      );
    if (newerItems.length === 0) return;
    const newerTargetKinds = [...new Set(newerItems.map((item) => item.targetKind))];

    const candidateRows = await db
      .select({ item: agentSuggestionItems, suggestion: agentSuggestions })
      .from(agentSuggestionItems)
      .innerJoin(agentSuggestions, eq(agentSuggestions.id, agentSuggestionItems.suggestionId))
      .where(
        and(
          eq(agentSuggestionItems.teamId, teamId),
          inArray(agentSuggestionItems.status, ACTIONABLE_ITEM_STATUSES),
          inArray(agentSuggestionItems.targetKind, newerTargetKinds),
          inArray(agentSuggestions.status, ['pending', 'partially_resolved']),
        ),
      );

    for (const newerItem of newerItems) {
      for (const candidate of candidateRows) {
        if (!isOlderPendingItem(candidate.item, newerItem)) continue;
        if (
          shouldSupersedePendingItem({
            olderItem: candidate.item,
            olderSuggestion: candidate.suggestion,
            newerItem,
            newerSuggestion,
          })
        ) {
          await supersedeItem(
            candidate.item.id,
            newerItem.id,
            'Replaced by newer workspace reconciliation evidence.',
          );
        }
      }
    }
    await refreshBundleStatus(suggestionId);
  }

  async function reconcileAcceptedItem(
    item: typeof agentSuggestionItems.$inferSelect,
  ): Promise<void> {
    const [acceptedSuggestion] = await db
      .select()
      .from(agentSuggestions)
      .where(eq(agentSuggestions.id, item.suggestionId))
      .limit(1);
    if (!acceptedSuggestion) return;
    const candidateRows = await db
      .select({ item: agentSuggestionItems, suggestion: agentSuggestions })
      .from(agentSuggestionItems)
      .innerJoin(agentSuggestions, eq(agentSuggestions.id, agentSuggestionItems.suggestionId))
      .where(
        and(
          eq(agentSuggestionItems.teamId, teamId),
          inArray(agentSuggestionItems.status, ACTIONABLE_ITEM_STATUSES),
          eq(agentSuggestionItems.targetKind, item.targetKind),
          inArray(agentSuggestions.status, ['pending', 'partially_resolved']),
        ),
      );

    for (const candidate of candidateRows) {
      if (
        shouldSupersedePendingItem({
          olderItem: candidate.item,
          olderSuggestion: candidate.suggestion,
          newerItem: item,
          newerSuggestion: acceptedSuggestion,
        })
      ) {
        await supersedeItem(
          candidate.item.id,
          item.id,
          'Canonical state changed through an accepted approval.',
        );
      }
    }
  }

  async function reconcileAcceptedItemBestEffort(
    item: typeof agentSuggestionItems.$inferSelect,
  ): Promise<void> {
    try {
      await reconcileAcceptedItem(item);
    } catch (err) {
      log.error(
        {
          err,
          teamId,
          suggestionItemId: item.id,
          suggestionId: item.suggestionId,
          targetKind: item.targetKind,
          targetId: item.targetId,
          resultId: item.resultId,
        },
        'post_accept_reconciliation_failed',
      );
    }
  }

  async function staleObjectTargetReason(entityId: string | null): Promise<string | null> {
    if (!entityId || !UUID_RE.test(entityId)) return null;
    const [row] = await db
      .select({
        id: entities.id,
        teamId: entities.teamId,
        mergedIntoId: entities.mergedIntoId,
        archivedAt: entities.archivedAt,
      })
      .from(entities)
      .where(eq(entities.id, entityId))
      .limit(1);
    if (!row) return null;
    if (row.teamId !== teamId) return null;
    if (row.mergedIntoId) return 'The target object was merged into another object.';
    if (row.archivedAt) return 'The target object was archived.';
    return null;
  }

  async function staleCalendarTargetReason(calendarEventId: string | null): Promise<string | null> {
    if (!calendarEventId || !UUID_RE.test(calendarEventId)) return null;
    const [row] = await db
      .select({
        id: calendarEvents.id,
        teamId: calendarEvents.teamId,
        deletedAt: calendarEvents.deletedAt,
      })
      .from(calendarEvents)
      .where(eq(calendarEvents.id, calendarEventId))
      .limit(1);
    if (!row) return null;
    if (row.teamId !== teamId) return null;
    if (row.deletedAt) return 'The target calendar event was deleted.';
    return null;
  }

  async function staleObjectNoteTargetReason(
    item: typeof agentSuggestionItems.$inferSelect,
    payload: z.infer<typeof objectNotePayload>,
  ): Promise<string | null> {
    if (item.operation === 'create') {
      return staleObjectTargetReason(payload.entityId ?? item.targetId);
    }
    const noteId = item.targetId ?? payload.noteId ?? null;
    if (!noteId || !UUID_RE.test(noteId)) return null;
    const [row] = await db
      .select({
        teamId: objectNotes.teamId,
        entityId: objectNotes.entityId,
        deletedAt: objectNotes.deletedAt,
      })
      .from(objectNotes)
      .where(eq(objectNotes.id, noteId))
      .limit(1);
    if (!row) return null;
    if (row.teamId !== teamId) return null;
    if (row.deletedAt) return 'The target object note was deleted.';
    return staleObjectTargetReason(row.entityId);
  }

  async function staleObjectMergeTargetReason(objectIds: string[]): Promise<string | null> {
    const resolvedObjectIds = await resolveCurrentObjectIds(objectIds);
    if (resolvedObjectIds.length < 2) {
      return 'Objects in this merge suggestion were already merged or removed.';
    }
    for (const objectId of resolvedObjectIds) {
      const reason = await staleObjectTargetReason(objectId);
      if (reason) return reason;
    }
    return null;
  }

  async function staleActionableItemReason(
    item: typeof agentSuggestionItems.$inferSelect,
  ): Promise<string | null> {
    if (item.status !== 'pending' && item.status !== 'failed') return null;
    if (item.targetKind === 'object' || item.targetKind === 'task') {
      if (item.operation === 'create') return null;
      return staleObjectTargetReason(item.targetId);
    }
    if (item.targetKind === 'calendar_event') {
      if (item.operation === 'create') return null;
      return staleCalendarTargetReason(item.targetId);
    }
    const payload =
      item.proposedPayload &&
      typeof item.proposedPayload === 'object' &&
      !Array.isArray(item.proposedPayload)
        ? (item.proposedPayload as Record<string, unknown>)
        : {};
    if (item.targetKind === 'identity_facet') {
      const parsed = identityFacetPayload.safeParse(payload);
      return parsed.success ? staleObjectTargetReason(parsed.data.entityId) : null;
    }
    if (item.targetKind === 'object_note') {
      const parsed = objectNotePayload.safeParse(payload);
      if (!parsed.success) return null;
      return staleObjectNoteTargetReason(item, parsed.data);
    }
    if (item.targetKind === 'object_relationship') {
      const parsed = objectRelationshipPayload.safeParse(payload);
      if (!parsed.success) return null;
      for (const entityId of [parsed.data.fromEntityId, parsed.data.toEntityId]) {
        const reason = await staleObjectTargetReason(entityId ?? null);
        if (reason) return reason;
      }
      return null;
    }
    if (item.targetKind === 'object_merge') {
      const parsed = objectMergePayload.safeParse(payload);
      if (!parsed.success) return null;
      return staleObjectMergeTargetReason(parsed.data.objectIds);
    }
    return null;
  }

  async function reconcileStaleActionableItems(input: { suggestionId: string }): Promise<number> {
    const candidateRows = await db
      .select({ item: agentSuggestionItems, suggestion: agentSuggestions })
      .from(agentSuggestionItems)
      .innerJoin(agentSuggestions, eq(agentSuggestions.id, agentSuggestionItems.suggestionId))
      .where(
        and(
          eq(agentSuggestionItems.teamId, teamId),
          eq(agentSuggestionItems.suggestionId, input.suggestionId),
          eq(agentSuggestionItems.status, 'failed'),
          inArray(agentSuggestions.status, ['pending', 'partially_resolved']),
        ),
      );

    let superseded = 0;
    for (const candidate of candidateRows) {
      const reason = await staleActionableItemReason(candidate.item);
      if (!reason) continue;
      if (await supersedeItem(candidate.item.id, null, reason)) superseded += 1;
    }
    return superseded;
  }

  async function reconcileStaleSuggestionItem(itemId: string): Promise<boolean> {
    await ensureMember();
    const rows = await db
      .select({ item: agentSuggestionItems, suggestion: agentSuggestions })
      .from(agentSuggestionItems)
      .innerJoin(agentSuggestions, eq(agentSuggestions.id, agentSuggestionItems.suggestionId))
      .where(
        and(
          eq(agentSuggestionItems.id, itemId),
          suggestionVisibilityPredicate(teamId, userId),
          inArray(agentSuggestionItems.status, ACTIONABLE_ITEM_STATUSES),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return false;
    const reason = await staleActionableItemReason(row.item);
    if (!reason) return false;
    return supersedeItem(row.item.id, null, reason);
  }

  async function reconcileStaleActionableItemsBestEffort(context: {
    suggestionItemId?: string;
    suggestionId: string;
    op: string;
  }): Promise<number> {
    try {
      return await reconcileStaleActionableItems({ suggestionId: context.suggestionId });
    } catch (err) {
      log.error(
        {
          err,
          teamId,
          userId,
          suggestionItemId: context.suggestionItemId,
          suggestionId: context.suggestionId,
          op: context.op,
        },
        'stale_suggestion_reconciliation_failed',
      );
      return 0;
    }
  }

  async function reconcileCanonicalChange(input: {
    targetKind: Extract<TargetKind, 'object' | 'task' | 'calendar_event'>;
    targetId: string;
    operation?: Extract<Operation, 'update' | 'archive_or_cancel'>;
    patch?: Record<string, unknown>;
    reason?: string;
  }): Promise<number> {
    await ensureMember();
    const operation = input.operation ?? 'update';
    const patchKeys = new Set(Object.keys(input.patch ?? {}));
    const candidateRows = await db
      .select({ item: agentSuggestionItems, suggestion: agentSuggestions })
      .from(agentSuggestionItems)
      .innerJoin(agentSuggestions, eq(agentSuggestions.id, agentSuggestionItems.suggestionId))
      .where(
        and(
          eq(agentSuggestionItems.teamId, teamId),
          eq(agentSuggestionItems.targetKind, input.targetKind),
          eq(agentSuggestionItems.targetId, input.targetId),
          inArray(agentSuggestionItems.status, ACTIONABLE_ITEM_STATUSES),
          inArray(agentSuggestions.status, ['pending', 'partially_resolved']),
        ),
      );

    let superseded = 0;
    for (const candidate of candidateRows) {
      const candidateKeys = itemPayloadKeys(candidate.item);
      const conflicts =
        operation === 'archive_or_cancel' ||
        candidate.item.operation === 'archive_or_cancel' ||
        patchKeys.size === 0 ||
        candidateKeys.size === 0 ||
        [...patchKeys].some((key) => candidateKeys.has(key));
      if (!conflicts) continue;
      if (
        await supersedeItem(
          candidate.item.id,
          null,
          input.reason ?? 'Canonical state changed outside this pending approval.',
        )
      ) {
        superseded += 1;
      }
    }
    return superseded;
  }

  async function reconcileObjectMerge(input: {
    survivorId: string;
    mergedIds: string[];
    reason?: string;
  }): Promise<number> {
    await ensureMember();
    const affectedIds = new Set([input.survivorId, ...input.mergedIds]);
    const candidateRows = await db
      .select({ item: agentSuggestionItems, suggestion: agentSuggestions })
      .from(agentSuggestionItems)
      .innerJoin(agentSuggestions, eq(agentSuggestions.id, agentSuggestionItems.suggestionId))
      .where(
        and(
          eq(agentSuggestionItems.teamId, teamId),
          eq(agentSuggestionItems.targetKind, 'object_merge'),
          inArray(agentSuggestionItems.status, ACTIONABLE_ITEM_STATUSES),
          inArray(agentSuggestions.status, ['pending', 'partially_resolved']),
        ),
      )
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    let changed = 0;
    const survivingItemByPairKey = new Map<string, typeof agentSuggestionItems.$inferSelect>();
    const refreshIds = new Set<string>();
    for (const candidate of candidateRows) {
      const parsed = objectMergePayload.safeParse(candidate.item.proposedPayload);
      if (!parsed.success) continue;
      const mentionsMergedObject = parsed.data.objectIds.some((id) => affectedIds.has(id));
      if (!mentionsMergedObject) {
        const key = stableStringify([...parsed.data.objectIds].sort());
        const duplicateItem = survivingItemByPairKey.get(key);
        if (!duplicateItem) {
          survivingItemByPairKey.set(key, candidate.item);
        } else if (isOlderPendingItem(duplicateItem, candidate.item)) {
          if (
            await supersedeItem(
              duplicateItem.id,
              candidate.item.id,
              'Replaced by an identical pending object cleanup suggestion.',
            )
          ) {
            changed += 1;
          }
          survivingItemByPairKey.set(key, candidate.item);
        } else if (
          await supersedeItem(
            candidate.item.id,
            duplicateItem.id,
            'Replaced by an identical pending object cleanup suggestion.',
          )
        ) {
          changed += 1;
        }
        continue;
      }

      const objectIds = await resolveCurrentObjectIds(parsed.data.objectIds);
      if (objectIds.length < 2) {
        if (
          await supersedeItem(
            candidate.item.id,
            null,
            input.reason ?? 'Objects in this merge suggestion were already merged.',
          )
        ) {
          changed += 1;
        }
        continue;
      }

      const fallbackSurvivorId = objectIds[0];
      if (!fallbackSurvivorId) continue;
      const resolvedSurvivorId =
        (await resolveCurrentObjectId(parsed.data.survivorId)) ?? fallbackSurvivorId;
      const survivorId = objectIds.includes(resolvedSurvivorId)
        ? resolvedSurvivorId
        : fallbackSurvivorId;
      const pairKey = stableStringify([...objectIds].sort());
      const duplicateItem = survivingItemByPairKey.get(pairKey);
      if (duplicateItem) {
        if (isOlderPendingItem(duplicateItem, candidate.item)) {
          if (
            await supersedeItem(
              duplicateItem.id,
              candidate.item.id,
              'Replaced by an identical pending object cleanup suggestion.',
            )
          ) {
            changed += 1;
          }
          survivingItemByPairKey.set(pairKey, candidate.item);
        } else {
          if (
            await supersedeItem(
              candidate.item.id,
              duplicateItem.id,
              'Replaced by an identical pending object cleanup suggestion.',
            )
          ) {
            changed += 1;
          }
          continue;
        }
      }
      if (!duplicateItem) survivingItemByPairKey.set(pairKey, candidate.item);

      const payloadChanged =
        stableStringify(parsed.data.objectIds) !== stableStringify(objectIds) ||
        parsed.data.survivorId !== survivorId ||
        candidate.item.targetId !== survivorId;
      if (!payloadChanged) continue;

      await db
        .update(agentSuggestionItems)
        .set({
          targetId: survivorId,
          proposedPayload: { ...parsed.data, objectIds, survivorId },
          updatedAt: new Date(),
          failureReason: null,
        })
        .where(eq(agentSuggestionItems.id, candidate.item.id));
      refreshIds.add(candidate.suggestion.id);
      changed += 1;
    }

    for (const suggestionId of refreshIds) await refreshBundleStatus(suggestionId);
    return changed;
  }

  async function reconcileDuplicatePendingApprovals(
    opts: { dryRun?: boolean; limit?: number } = {},
  ): Promise<DuplicatePendingApprovalReconcileResult> {
    await ensureMember();
    const limit = Math.min(Math.max(opts.limit ?? 2000, 1), 5000);
    const rows = await db
      .select({ item: agentSuggestionItems, suggestion: agentSuggestions })
      .from(agentSuggestionItems)
      .innerJoin(agentSuggestions, eq(agentSuggestions.id, agentSuggestionItems.suggestionId))
      .where(
        and(
          eq(agentSuggestionItems.teamId, teamId),
          inArray(agentSuggestionItems.status, ACTIONABLE_ITEM_STATUSES),
          inArray(agentSuggestions.status, ['pending', 'partially_resolved']),
        ),
      )
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id))
      .limit(limit);

    const pairs: DuplicatePendingApprovalPair[] = [];
    const supersededIds = new Set<string>();
    for (let newerIndex = 0; newerIndex < rows.length; newerIndex += 1) {
      const newer = rows[newerIndex];
      if (!newer || supersededIds.has(newer.item.id)) continue;
      for (let olderIndex = 0; olderIndex < newerIndex; olderIndex += 1) {
        const older = rows[olderIndex];
        if (!older || supersededIds.has(older.item.id)) continue;
        if (!isOlderPendingItem(older.item, newer.item)) continue;
        if (
          !shouldSupersedePendingItem({
            olderItem: older.item,
            olderSuggestion: older.suggestion,
            newerItem: newer.item,
            newerSuggestion: newer.suggestion,
          })
        ) {
          continue;
        }
        const pair = {
          supersededItemId: older.item.id,
          supersededSuggestionId: older.suggestion.id,
          survivorItemId: newer.item.id,
          survivorSuggestionId: newer.suggestion.id,
          reason: 'Replaced by duplicate pending approval cleanup.',
        };
        pairs.push(pair);
        supersededIds.add(older.item.id);
        if (!opts.dryRun) {
          await supersedeItem(older.item.id, newer.item.id, pair.reason);
        }
      }
    }

    if (!opts.dryRun) {
      for (const suggestionId of new Set(pairs.map((pair) => pair.survivorSuggestionId))) {
        await refreshBundleStatus(suggestionId);
      }
    }

    return { scanned: rows.length, superseded: pairs.length, pairs };
  }

  async function notifySuggestion(row: typeof agentSuggestions.$inferSelect): Promise<void> {
    const recipients = new Set<string>();
    if (row.visibility === 'team') {
      const members = await db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), isNull(teamMembers.removedAt)));
      for (const member of members) recipients.add(member.userId);
    } else {
      if (row.visibilityOwnerUserId) recipients.add(row.visibilityOwnerUserId);
      for (const uid of row.visibilityUserIds ?? []) recipients.add(uid);
    }
    if (recipients.size === 0) return;
    await db
      .insert(notifications)
      .values(
        Array.from(recipients).map((uid) => ({
          teamId,
          userId: uid,
          kind: 'agent_suggestion' as const,
          agentSuggestionId: row.id,
          summary: `Approval needed: ${row.title}`,
          payload: { suggestion_id: row.id },
        })),
      )
      .onConflictDoNothing();
  }

  async function validateEvidenceVisible(rawEventIds: string[]): Promise<void> {
    const ids = Array.from(new Set(rawEventIds));
    if (ids.length === 0) return;
    const rows = await db
      .select({ id: rawEvents.id })
      .from(rawEvents)
      .where(and(inArray(rawEvents.id, ids), rawEventVisibilityPredicate(teamId, userId)));
    if (rows.length !== ids.length) {
      throw new Error('Suggestion evidence must reference visible events in this team');
    }
  }

  async function existingResultForItem(
    item: typeof agentSuggestionItems.$inferSelect,
  ): Promise<string | null> {
    if (item.operation !== 'create') return null;
    if (item.targetKind === 'task' || item.targetKind === 'object') {
      const rows = await db
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            eq(entities.teamId, teamId),
            sql`${entities.metadata} ->> 'agent_suggestion_item_id' = ${item.id}`,
          ),
        )
        .limit(1);
      return rows[0]?.id ?? null;
    }
    if (item.targetKind === 'identity_facet') {
      const rows = await db
        .select({ id: objectIdentityFacets.id })
        .from(objectIdentityFacets)
        .where(
          and(
            eq(objectIdentityFacets.teamId, teamId),
            sql`${objectIdentityFacets.metadata} ->> 'agent_suggestion_item_id' = ${item.id}`,
          ),
        )
        .limit(1);
      return rows[0]?.id ?? null;
    }
    if (item.targetKind === 'object_note') {
      const rows = await db
        .select({ id: sql<string | null>`${rawEvents.sourceMetadata} ->> 'note_id'` })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.teamId, teamId),
            eq(rawEvents.source, 'system'),
            sql`${rawEvents.sourceMetadata} ->> 'kind' in ('object_note_create', 'object_note_update')`,
            sql`${rawEvents.sourceMetadata} ->> 'agent_suggestion_item_id' = ${item.id}`,
          ),
        )
        .limit(1);
      return rows[0]?.id ?? null;
    }
    if (item.targetKind === 'object_relationship') {
      const rows = await db
        .select({ id: sql<string | null>`${rawEvents.sourceMetadata} ->> 'relationship_id'` })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.teamId, teamId),
            eq(rawEvents.source, 'system'),
            sql`${rawEvents.sourceMetadata} ->> 'kind' = 'relationship_create'`,
            sql`${rawEvents.sourceMetadata} ->> 'agent_suggestion_item_id' = ${item.id}`,
          ),
        )
        .limit(1);
      return rows[0]?.id ?? null;
    }
    const rows = await db
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.teamId, teamId),
          sql`${calendarEvents.metadata} ->> 'agent_suggestion_item_id' = ${item.id}`,
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async function hasDependentObjectNoteSibling(
    item: typeof agentSuggestionItems.$inferSelect,
    canonicalName: string,
    type: ObjectType,
  ): Promise<boolean> {
    if (item.targetKind !== 'object') return false;
    const rows = await db
      .select({ id: agentSuggestionItems.id })
      .from(agentSuggestionItems)
      .where(
        and(
          eq(agentSuggestionItems.teamId, teamId),
          eq(agentSuggestionItems.suggestionId, item.suggestionId),
          eq(agentSuggestionItems.operation, 'create'),
          eq(agentSuggestionItems.targetKind, 'object_note'),
          inArray(agentSuggestionItems.status, ACTIONABLE_ITEM_STATUSES),
          sql`lower(${agentSuggestionItems.proposedPayload} ->> 'entityName') = ${canonicalName.toLowerCase()}`,
          sql`coalesce(${agentSuggestionItems.proposedPayload} ->> 'entityType', ${type}) = ${type}`,
        ),
      )
      .limit(1);
    return Boolean(rows[0]);
  }

  async function objectTypeForTarget(targetId: string | null): Promise<ObjectType | null> {
    if (!targetId) return null;
    const [row] = await db
      .select({ type: entities.type })
      .from(entities)
      .where(and(eq(entities.teamId, teamId), eq(entities.id, targetId)))
      .limit(1);
    return row?.type ?? null;
  }

  async function resolveObjectNoteEntityId(
    payload: z.infer<typeof objectNotePayload>,
    item?: typeof agentSuggestionItems.$inferSelect,
  ): Promise<string> {
    if (payload.entityId) return payload.entityId;
    if (item?.targetId) return item.targetId;
    if (!payload.entityName) throw new Error('Object note target object is required');

    if (item) {
      const siblingId = await resolveObjectNoteSiblingCreate(payload, item);
      if (siblingId) return siblingId;
    }

    const conds = [
      eq(entities.teamId, teamId),
      isNull(entities.mergedIntoId),
      isNull(entities.archivedAt),
      sql`lower(${entities.canonicalName}) = lower(${payload.entityName})`,
    ];
    if (payload.entityType) conds.push(eq(entities.type, payload.entityType as ObjectType));

    const rows = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(...conds))
      .limit(2);
    const row = rows[0];
    if (rows.length === 1 && row) return row.id;
    if (rows.length !== 1) {
      throw new Error('Object note target object was not uniquely matched');
    }
    throw new Error('Object note target object was not uniquely matched');
  }

  async function resolveObjectNoteSiblingCreate(
    payload: z.infer<typeof objectNotePayload>,
    item: typeof agentSuggestionItems.$inferSelect,
  ): Promise<string | null> {
    if (!payload.entityName) return null;
    const rows = await db
      .select()
      .from(agentSuggestionItems)
      .where(
        and(
          eq(agentSuggestionItems.teamId, teamId),
          eq(agentSuggestionItems.suggestionId, item.suggestionId),
          eq(agentSuggestionItems.operation, 'create'),
          inArray(agentSuggestionItems.targetKind, ['object', 'task']),
        ),
      );
    const matches = rows.filter((candidate) => {
      const candidatePayload = objectCreatePayload.parse(normalizeLifecyclePayload(candidate));
      const canonicalName =
        candidatePayload.canonicalName !== undefined && candidatePayload.canonicalName.length > 0
          ? candidatePayload.canonicalName
          : candidate.title;
      if (canonicalName.toLowerCase() !== payload.entityName?.toLowerCase()) return false;
      const candidateType =
        candidate.targetKind === 'task' ? 'task' : (candidatePayload.type ?? 'other');
      return !payload.entityType || candidateType === payload.entityType;
    });
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new Error('Object note target sibling object was not uniquely matched');
    }

    const sibling = matches[0];
    if (!sibling) return null;
    const existing = sibling.resultId ?? (await existingResultForItem(sibling));
    if (existing) return existing;
    if (sibling.status === 'accepted') {
      throw new Error('Object note target sibling object has no accepted result');
    }
    if (sibling.status !== 'pending' && sibling.status !== 'failed') return null;

    const accepted = await acceptSuggestionItem(sibling.id);
    if (!accepted) throw new Error('Object note target sibling object could not be accepted');
    const [resolved] = await db
      .select({ resultId: agentSuggestionItems.resultId })
      .from(agentSuggestionItems)
      .where(and(eq(agentSuggestionItems.teamId, teamId), eq(agentSuggestionItems.id, sibling.id)))
      .limit(1);
    if (!resolved?.resultId) {
      throw new Error('Object note target sibling object has no accepted result');
    }
    return resolved.resultId;
  }

  async function applyObjectCreateItem(
    item: typeof agentSuggestionItems.$inferSelect,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const parsed = objectCreatePayload.parse(payload);
    const canonicalName =
      parsed.canonicalName !== undefined && parsed.canonicalName.length > 0
        ? parsed.canonicalName
        : item.title;
    const type =
      item.targetKind === 'task' ? 'task' : (objectTypeFromValue(parsed.type) ?? 'other');
    const input: CreateObjectInput = {
      type,
      canonicalName,
      actor: { kind: 'agent', userId: null },
    };
    if (parsed.aliases !== undefined) input.aliases = parsed.aliases;
    if (parsed.status !== undefined) input.status = parsed.status;
    if (parsed.stage !== undefined) input.stage = parsed.stage;
    if (parsed.priority !== undefined) input.priority = parsed.priority;
    if (parsed.ownerUserId !== undefined) input.ownerUserId = parsed.ownerUserId;
    if (parsed.assigneeUserId !== undefined) input.assigneeUserId = parsed.assigneeUserId;
    if (parsed.dueAt !== undefined) input.dueAt = parsed.dueAt ? new Date(parsed.dueAt) : null;
    if (parsed.parentObjectId !== undefined) input.parentObjectId = parsed.parentObjectId;
    if (parsed.sourceEventId !== undefined) {
      if (parsed.sourceEventId) await validateEvidenceVisible([parsed.sourceEventId]);
      input.sourceEventId = parsed.sourceEventId;
    }
    input.metadata = {
      ...(parsed.metadata ?? {}),
      agent_suggestion_item_id: item.id,
    };

    const existingIdentity = sql`${entities.metadata} ->> 'agent_suggestion_item_id' = ${item.id}`;
    const existingRows = await db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.teamId, teamId),
          eq(entities.type, type),
          isNull(entities.mergedIntoId),
          isNull(entities.archivedAt),
          existingIdentity,
        ),
      )
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      const created = await objects.createObject(input);
      return created.id;
    }

    const patch: ObjectPatch = {};
    if (parsed.canonicalName !== undefined && parsed.canonicalName !== existing.canonicalName) {
      patch.canonicalName = canonicalName;
    }
    if (parsed.status !== undefined) patch.status = parsed.status;
    if (parsed.stage !== undefined) patch.stage = parsed.stage;
    if (parsed.priority !== undefined) patch.priority = parsed.priority;
    if (parsed.ownerUserId !== undefined) patch.ownerUserId = parsed.ownerUserId;
    if (parsed.assigneeUserId !== undefined) patch.assigneeUserId = parsed.assigneeUserId;
    if (parsed.dueAt !== undefined) patch.dueAt = parsed.dueAt ? new Date(parsed.dueAt) : null;
    if (parsed.aliases !== undefined) {
      patch.aliases = mergeAliases(stringArrayFromUnknown(existing.aliases), parsed.aliases);
    }
    patch.metadata = {
      ...recordFromUnknown(existing.metadata),
      ...(parsed.metadata ?? {}),
      agent_suggestion_item_id: item.id,
    };
    await objects.updateObject(existing.id, patch, { kind: 'agent', userId: null });
    return existing.id;
  }

  function acceptancePriority(item: SuggestionItem): number {
    if (
      item.operation === 'create' &&
      (item.targetKind === 'object' || item.targetKind === 'task')
    ) {
      return 0;
    }
    if (item.operation === 'create' && item.targetKind === 'object_note') return 1;
    return 2;
  }

  function orderSuggestionItemsForAcceptance(items: SuggestionItem[]): SuggestionItem[] {
    return [...items].sort((left, right) => {
      const priority = acceptancePriority(left) - acceptancePriority(right);
      if (priority !== 0) return priority;
      return left.id.localeCompare(right.id);
    });
  }

  async function objectTypesForItems(
    items: readonly SuggestionItemInput[],
  ): Promise<Map<string, ObjectType>> {
    const ids = [
      ...new Set(
        items
          .filter((item) => item.targetKind === 'object' && item.operation !== 'create')
          .map((item) => item.targetId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({ id: entities.id, type: entities.type })
      .from(entities)
      .where(and(eq(entities.teamId, teamId), inArray(entities.id, ids)));
    return new Map(rows.map((row) => [row.id, row.type]));
  }

  async function resolveLocalRef(
    item: typeof agentSuggestionItems.$inferSelect,
    ref: string,
  ): Promise<string> {
    const normalizedRef = normalizedLocalRef(ref);
    if (!normalizedRef) throw new Error('Relationship endpoint ref was empty');
    const rows = await db
      .select({
        id: agentSuggestionItems.id,
        resultId: agentSuggestionItems.resultId,
        status: agentSuggestionItems.status,
      })
      .from(agentSuggestionItems)
      .where(
        and(
          eq(agentSuggestionItems.suggestionId, item.suggestionId),
          inArray(agentSuggestionItems.targetKind, ['object', 'task']),
          eq(agentSuggestionItems.operation, 'create'),
          sql`lower(${agentSuggestionItems.proposedPayload} ->> 'localRef') = ${normalizedRef}`,
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`Relationship endpoint ref "${ref}" was not found`);
    if (row.status !== 'accepted' || !row.resultId) {
      throw new Error(`Relationship endpoint ref "${ref}" has not been accepted yet`);
    }
    return row.resultId;
  }

  async function resolveRelationshipPayload(
    item: typeof agentSuggestionItems.$inferSelect,
    payload: Record<string, unknown>,
  ): Promise<{
    fromEntityId: string;
    toEntityId: string;
    kind: 'parent' | 'child' | 'related' | 'blocks' | 'blocked_by' | 'duplicate_of';
  }> {
    const parsed = objectRelationshipPayload.parse(payload);
    return {
      fromEntityId: parsed.fromEntityId ?? (await resolveLocalRef(item, parsed.fromRef ?? '')),
      toEntityId: parsed.toEntityId ?? (await resolveLocalRef(item, parsed.toRef ?? '')),
      kind: parsed.kind,
    };
  }

  async function supersedeRelationshipDependents(
    item: typeof agentSuggestionItems.$inferSelect,
  ): Promise<void> {
    const payload =
      item.proposedPayload &&
      typeof item.proposedPayload === 'object' &&
      !Array.isArray(item.proposedPayload)
        ? (item.proposedPayload as Record<string, unknown>)
        : {};
    const ref = typeof payload.localRef === 'string' ? payload.localRef : null;
    const normalizedRef = normalizedLocalRef(ref);
    if (!normalizedRef || (item.targetKind !== 'object' && item.targetKind !== 'task')) return;
    const dependents = await db
      .select({ id: agentSuggestionItems.id })
      .from(agentSuggestionItems)
      .where(
        and(
          eq(agentSuggestionItems.suggestionId, item.suggestionId),
          eq(agentSuggestionItems.targetKind, 'object_relationship'),
          inArray(agentSuggestionItems.status, ACTIONABLE_ITEM_STATUSES),
          or(
            sql`lower(${agentSuggestionItems.proposedPayload} ->> 'fromRef') = ${normalizedRef}`,
            sql`lower(${agentSuggestionItems.proposedPayload} ->> 'toRef') = ${normalizedRef}`,
          ),
        ),
      );
    for (const dependent of dependents) {
      await supersedeItem(
        dependent.id,
        null,
        `Relationship endpoint "${ref}" was rejected or superseded.`,
      );
    }
  }

  async function applyItem(item: typeof agentSuggestionItems.$inferSelect): Promise<string | null> {
    if (item.resultId) return item.resultId;
    if (item.status !== 'pending' && item.status !== 'failed') return item.resultId;
    if (item.targetKind === 'object_merge') {
      throw new Error('Merge suggestions must be reviewed from the merge preview');
    }
    if (
      item.operation === 'create' &&
      (item.targetKind === 'task' || item.targetKind === 'object')
    ) {
      return applyObjectCreateItem(item, normalizeLifecyclePayload(item));
    }
    const existingResultId = await existingResultForItem(item);
    if (existingResultId) return existingResultId;
    const targetId = item.targetId;
    const payload = normalizeLifecyclePayload({
      ...item,
      objectType:
        item.targetKind === 'object' && item.operation !== 'create'
          ? await objectTypeForTarget(targetId)
          : null,
    });

    if (item.targetKind === 'task' || item.targetKind === 'object') {
      if (!targetId) throw new Error('Target id is required');
      if (item.operation === 'update') {
        const parsed = objectUpdatePayload.parse(payload);
        const patch: ObjectPatch = {};
        if (parsed.canonicalName !== undefined) patch.canonicalName = parsed.canonicalName;
        if (parsed.status !== undefined) patch.status = parsed.status;
        if (parsed.stage !== undefined) patch.stage = parsed.stage;
        if (parsed.priority !== undefined) patch.priority = parsed.priority;
        if (parsed.ownerUserId !== undefined) patch.ownerUserId = parsed.ownerUserId;
        if (parsed.assigneeUserId !== undefined) patch.assigneeUserId = parsed.assigneeUserId;
        if (parsed.dueAt !== undefined) patch.dueAt = parsed.dueAt ? new Date(parsed.dueAt) : null;
        if (parsed.aliases !== undefined) patch.aliases = parsed.aliases;
        if (parsed.metadata !== undefined) patch.metadata = parsed.metadata;
        await objects.updateObject(targetId, patch, { kind: 'agent', userId: null });
        return targetId;
      }
      await objects.archiveObject(targetId, { kind: 'agent', userId: null });
      return targetId;
    }

    if (item.targetKind === 'identity_facet') {
      if (item.operation !== 'create') throw new Error('Identity facets only support create');
      const parsed = identityFacetPayload.parse(payload);
      const identityFacetInput: IdentityFacetInput = {
        entityId: parsed.entityId,
        kind: parsed.kind,
        value: parsed.value,
        provider: parsed.provider ?? null,
        externalId: parsed.externalId ?? null,
        linkedUserId: parsed.linkedUserId ?? null,
        source: 'agent_approved',
        metadata: {
          ...(parsed.metadata ?? {}),
          agent_suggestion_item_id: item.id,
        },
        actor: { kind: 'agent', userId: null },
      };
      const created = await objects.createIdentityFacet({
        ...identityFacetInput,
        ...(parsed.normalizedValue !== undefined
          ? { normalizedValue: parsed.normalizedValue }
          : {}),
      });
      return created.id;
    }

    if (item.targetKind === 'object_note') {
      const parsed = objectNotePayload.parse(payload);
      if (item.operation === 'create') {
        const entityId = await resolveObjectNoteEntityId(parsed, item);
        const created = await objects.createNote({
          entityId,
          body: parsed.body,
          authorUserId: null,
          metadata: {
            ...(parsed.metadata ?? {}),
            agent_suggestion_item_id: item.id,
            qna_note: parsed.body.startsWith('Q:'),
          },
          actor: { kind: 'agent', userId: null },
        });
        return created.id;
      }
      if (item.operation === 'update') {
        const noteId = targetId ?? parsed.noteId;
        if (!noteId) throw new Error('Object note update requires a note id');
        const updated = await objects.updateNote({
          noteId,
          body: parsed.body,
          actorUserId: null,
          actor: { kind: 'agent', userId: null },
          metadata: {
            ...(parsed.metadata ?? {}),
            agent_suggestion_item_id: item.id,
            qna_note: parsed.body.startsWith('Q:'),
          },
        });
        if (!updated) throw new Error('Object note update target not found');
        return noteId;
      }
      throw new Error('Object notes only support create/update');
    }

    if (item.targetKind === 'object_relationship') {
      if (item.operation !== 'create') throw new Error('Object relationships only support create');
      const parsed = await resolveRelationshipPayload(item, payload);
      const created = await objects.addRelationship({
        fromEntityId: parsed.fromEntityId,
        toEntityId: parsed.toEntityId,
        kind: parsed.kind,
        actorUserId: null,
        actor: { kind: 'agent', userId: null },
        metadata: { agent_suggestion_item_id: item.id },
      });
      return created?.id ?? null;
    }

    if (item.targetKind === 'board_membership') {
      if (item.operation !== 'create')
        throw new Error('Board membership suggestions only support create');
      const parsed = boardMembershipPayload.parse(payload);
      if (parsed.sourceEventId) await validateEvidenceVisible([parsed.sourceEventId]);
      const change = await boards.proposeBoardMembership({
        boardId: parsed.boardId,
        entityId: parsed.entityId,
        laneId: parsed.laneId ?? null,
        sourceEventId: parsed.sourceEventId ?? null,
        suggestionItemId: item.id,
        note: parsed.note ?? item.description,
      });
      const applied = await boards.acceptBoardItemChange(change.id, {
        kind: 'agent',
        userId: null,
      });
      return applied;
    }

    if (item.targetKind === 'board_item_update') {
      if (item.operation !== 'update')
        throw new Error('Board item suggestions only support update');
      const parsed = boardItemUpdatePayload.parse(payload);
      if (parsed.sourceEventId) await validateEvidenceVisible([parsed.sourceEventId]);
      const change = await boards.proposeBoardItemUpdate({
        boardItemId: parsed.boardItemId,
        field: parsed.field,
        newValue: parsed.newValue,
        sourceEventId: parsed.sourceEventId ?? null,
        suggestionItemId: item.id,
        note: parsed.note ?? item.description,
      });
      const applied = await boards.acceptBoardItemChange(change.id, {
        kind: 'agent',
        userId: null,
      });
      return applied;
    }

    if (item.operation === 'create') {
      const settings = await calendar.getCalendarSettings();
      const parsed = calendarCreatePayload.parse(
        normalizeCalendarPayload(item, {
          fallbackTitle: true,
          defaultTimezone: settings.defaultTimezone,
          inferAllDayFromDateOnly: true,
          materializeDefaultTimezone: true,
        }),
      );
      const normalizedRange = parsed.allDay
        ? normalizeAllDayRange({
            startAt: parsed.startAt,
            endAt: parsed.endAt,
            timezone: parsed.timezone,
            ...(parsed.startDate ? { startDate: parsed.startDate } : {}),
            ...(parsed.endDate ? { endDate: parsed.endDate } : {}),
          })
        : { startAt: new Date(parsed.startAt), endAt: new Date(parsed.endAt) };
      const input: CreateCalendarEventInput = {
        title: parsed.title,
        description: parsed.description ?? null,
        startAt: normalizedRange.startAt,
        endAt: normalizedRange.endAt,
        timezone: parsed.timezone,
        allDay: parsed.allDay,
        location: parsed.location ?? null,
        showAs: parsed.showAs ?? 'busy',
        rrule: parsed.rrule ?? null,
        visibility: parsed.visibility,
        visibilityUserIds: parsed.visibilityUserIds ?? null,
        reminderMinutes: parsed.reminderMinutes ?? null,
        agentSuggested: false,
        metadata: {
          ...(parsed.metadata ?? {}),
          ...(parsed.proposalGroupId ? { proposalGroupId: parsed.proposalGroupId } : {}),
          ...(parsed.proposalStatus ? { proposalStatus: parsed.proposalStatus } : {}),
          ...(parsed.proposalRole ? { proposalRole: parsed.proposalRole } : {}),
          agent_suggestion_item_id: item.id,
        },
      };
      if (parsed.linkedEntityIds !== undefined) input.linkedEntityIds = parsed.linkedEntityIds;
      const created = await calendar.createCalendarEvent(input);
      return created.id;
    }
    if (!targetId) throw new Error('Target id is required');
    if (item.operation === 'update') {
      const event = await calendar.getCalendarEvent(targetId);
      const defaultTimezone =
        event?.timezone ?? (await calendar.getCalendarSettings()).defaultTimezone;
      const parsed = calendarUpdatePayload.parse(
        normalizeCalendarPayload(item, {
          fallbackTitle: false,
          defaultTimezone,
          inferAllDayFromDateOnly: event?.allDay ?? false,
          materializeDefaultTimezone: false,
        }),
      );
      const patch: UpdateCalendarEventInput = {};
      if (parsed.title !== undefined) patch.title = parsed.title;
      if (parsed.description !== undefined) patch.description = parsed.description;
      const effectiveAllDay = parsed.allDay ?? event?.allDay ?? false;
      if (effectiveAllDay && parsed.startAt !== undefined && parsed.endAt !== undefined) {
        const normalizedRange = normalizeAllDayRange({
          startAt: parsed.startAt,
          endAt: parsed.endAt,
          timezone: parsed.timezone ?? event?.timezone ?? 'UTC',
          ...(parsed.startDate ? { startDate: parsed.startDate } : {}),
          ...(parsed.endDate ? { endDate: parsed.endDate } : {}),
        });
        patch.startAt = normalizedRange.startAt;
        patch.endAt = normalizedRange.endAt;
      } else {
        if (parsed.startAt !== undefined) patch.startAt = new Date(parsed.startAt);
        if (parsed.endAt !== undefined) patch.endAt = new Date(parsed.endAt);
      }
      if (parsed.timezone !== undefined) patch.timezone = parsed.timezone;
      if (parsed.allDay !== undefined) patch.allDay = parsed.allDay;
      if (parsed.location !== undefined) patch.location = parsed.location;
      if (parsed.showAs !== undefined) patch.showAs = parsed.showAs;
      if (parsed.rrule !== undefined) patch.rrule = parsed.rrule;
      if (parsed.recurrenceEditMode !== undefined)
        patch.recurrenceEditMode = parsed.recurrenceEditMode;
      if (parsed.visibility !== undefined) patch.visibility = parsed.visibility;
      if (parsed.visibilityUserIds !== undefined)
        patch.visibilityUserIds = parsed.visibilityUserIds;
      if (parsed.reminderMinutes !== undefined) patch.reminderMinutes = parsed.reminderMinutes;
      if (
        parsed.metadata !== undefined ||
        parsed.proposalGroupId !== undefined ||
        parsed.proposalStatus !== undefined ||
        parsed.proposalRole !== undefined
      ) {
        patch.metadata = {
          ...(parsed.metadata ?? {}),
          ...(parsed.proposalGroupId ? { proposalGroupId: parsed.proposalGroupId } : {}),
          ...(parsed.proposalStatus ? { proposalStatus: parsed.proposalStatus } : {}),
          ...(parsed.proposalRole ? { proposalRole: parsed.proposalRole } : {}),
        };
      }
      await calendar.updateCalendarEvent(targetId, patch);
      return targetId;
    }
    const parsed = calendarUpdatePayload.parse(
      normalizeCalendarPayload(item, { fallbackTitle: false }),
    );
    await calendar.deleteCalendarEvent(
      targetId,
      parsed.recurrenceEditMode ? { recurrenceEditMode: parsed.recurrenceEditMode } : {},
    );
    return targetId;
  }

  async function acceptSuggestionItem(itemId: string): Promise<boolean> {
    await ensureMember();
    const rows = await db
      .select({ item: agentSuggestionItems, suggestion: agentSuggestions })
      .from(agentSuggestionItems)
      .innerJoin(agentSuggestions, eq(agentSuggestions.id, agentSuggestionItems.suggestionId))
      .where(
        and(
          eq(agentSuggestionItems.id, itemId),
          suggestionVisibilityPredicate(teamId, userId),
          isNull(agentSuggestionItems.resolvedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return false;
    const staleReason = await staleActionableItemReason(row.item);
    if (staleReason) {
      const superseded = await supersedeItem(itemId, null, staleReason);
      if (superseded) {
        await reconcileStaleActionableItemsBestEffort({
          suggestionItemId: itemId,
          suggestionId: row.suggestion.id,
          op: 'accept_stale',
        });
      }
      return superseded;
    }
    const [claimed] = await db
      .update(agentSuggestionItems)
      .set({
        status: 'accepted',
        resolvedAt: new Date(),
        resolvedByUserId: userId,
        updatedAt: new Date(),
        failureReason: null,
      })
      .where(
        and(
          eq(agentSuggestionItems.id, itemId),
          isNull(agentSuggestionItems.resolvedAt),
          inArray(agentSuggestionItems.status, ['pending', 'failed']),
        ),
      )
      .returning({ id: agentSuggestionItems.id });
    if (!claimed) return false;
    let resultId: string | null;
    try {
      resultId = await applyItem(row.item);
    } catch (err) {
      const failureReason = err instanceof Error ? err.message : 'Failed to apply suggestion';
      await db
        .update(agentSuggestionItems)
        .set({
          status: 'failed',
          failureReason,
          resolvedAt: null,
          resolvedByUserId: null,
          updatedAt: new Date(),
        })
        .where(eq(agentSuggestionItems.id, itemId));
      await refreshBundleStatus(row.suggestion.id, userId);
      const staleReason = await staleActionableItemReason(row.item);
      if (staleReason && (await supersedeItem(itemId, null, staleReason))) {
        await reconcileStaleActionableItemsBestEffort({
          suggestionItemId: itemId,
          suggestionId: row.suggestion.id,
          op: 'accept_failure',
        });
        return true;
      }
      await reconcileStaleActionableItemsBestEffort({
        suggestionItemId: itemId,
        suggestionId: row.suggestion.id,
        op: 'accept_failure',
      });
      if (isExpectedApplyFailure(err)) {
        throw new ExpectedSuggestionApplyFailure(failureReason, { cause: err });
      }
      throw err;
    }
    await db
      .update(agentSuggestionItems)
      .set({
        resultId,
        updatedAt: new Date(),
        failureReason: null,
      })
      .where(eq(agentSuggestionItems.id, itemId));
    await refreshBundleStatus(row.suggestion.id, userId);
    await reconcileAcceptedItemBestEffort({ ...row.item, resultId });
    await reconcileStaleActionableItemsBestEffort({
      suggestionItemId: itemId,
      suggestionId: row.suggestion.id,
      op: 'accept',
    });
    return true;
  }

  async function acceptObjectMergeSuggestionItem(input: {
    itemId: string;
    survivorId: string;
    mergedIds: string[];
  }): Promise<{ survivorId: string } | null> {
    await ensureMember();
    const rows = await db
      .select({ item: agentSuggestionItems, suggestion: agentSuggestions })
      .from(agentSuggestionItems)
      .innerJoin(agentSuggestions, eq(agentSuggestions.id, agentSuggestionItems.suggestionId))
      .where(
        and(
          eq(agentSuggestionItems.id, input.itemId),
          suggestionVisibilityPredicate(teamId, userId),
          isNull(agentSuggestionItems.resolvedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.item.targetKind !== 'object_merge' || row.item.operation !== 'merge') {
      throw new Error('Suggestion item is not an object merge');
    }
    const payload = objectMergePayload.parse(row.item.proposedPayload);
    const expectedResolvedIds = await Promise.all(
      payload.objectIds.map((objectId) => resolveCurrentObjectId(objectId)),
    );
    if (expectedResolvedIds.some((objectId) => !objectId)) {
      throw new Error('One or more objects no longer exists');
    }
    const expectedObjectIds = [
      ...new Set(expectedResolvedIds.filter((objectId): objectId is string => Boolean(objectId))),
    ];
    if (expectedObjectIds.length < 2) {
      const superseded = await supersedeItem(
        row.item.id,
        null,
        'Objects in this merge suggestion were already merged.',
      );
      if (superseded) {
        await reconcileStaleActionableItemsBestEffort({
          suggestionItemId: input.itemId,
          suggestionId: row.suggestion.id,
          op: 'accept_object_merge_stale',
        });
      }
      return null;
    }
    for (const objectId of expectedObjectIds) {
      const staleReason = await staleObjectTargetReason(objectId);
      if (!staleReason) continue;
      const superseded = await supersedeItem(row.item.id, null, staleReason);
      if (superseded) {
        await reconcileStaleActionableItemsBestEffort({
          suggestionItemId: input.itemId,
          suggestionId: row.suggestion.id,
          op: 'accept_object_merge_stale',
        });
      }
      return null;
    }
    const inputSurvivorId = await resolveCurrentObjectId(input.survivorId);
    const inputMergedIds = await resolveCurrentObjectIds(input.mergedIds);
    if (!inputSurvivorId) throw new Error('Survivor object not found');
    const expectedIds = new Set(expectedObjectIds);
    const chosenIds = new Set([inputSurvivorId, ...inputMergedIds]);
    if (expectedIds.size !== chosenIds.size || [...expectedIds].some((id) => !chosenIds.has(id))) {
      throw new Error('Merge selection no longer matches this suggestion');
    }
    if (!expectedIds.has(inputSurvivorId)) {
      throw new Error('Survivor must be one of the suggested objects');
    }
    const mergedIds = expectedObjectIds.filter((id) => id !== inputSurvivorId);

    const [claimed] = await db
      .update(agentSuggestionItems)
      .set({
        status: 'accepted',
        resolvedAt: new Date(),
        resolvedByUserId: userId,
        updatedAt: new Date(),
        failureReason: null,
      })
      .where(
        and(
          eq(agentSuggestionItems.id, input.itemId),
          isNull(agentSuggestionItems.resolvedAt),
          inArray(agentSuggestionItems.status, ['pending', 'failed']),
        ),
      )
      .returning({ id: agentSuggestionItems.id });
    if (!claimed) return null;

    let survivorId: string;
    try {
      const result = await objects.mergeObjects({
        survivorId: inputSurvivorId,
        mergedIds,
        actor: { kind: 'user', userId },
      });
      survivorId = result.survivor.id;
    } catch (err) {
      await db
        .update(agentSuggestionItems)
        .set({
          status: 'failed',
          failureReason: err instanceof Error ? err.message : 'Failed to apply merge suggestion',
          resolvedAt: null,
          resolvedByUserId: null,
          updatedAt: new Date(),
        })
        .where(eq(agentSuggestionItems.id, input.itemId));
      await refreshBundleStatus(row.suggestion.id, userId);
      throw err;
    }
    await db
      .update(agentSuggestionItems)
      .set({
        resultId: survivorId,
        updatedAt: new Date(),
        failureReason: null,
      })
      .where(eq(agentSuggestionItems.id, input.itemId));
    await refreshBundleStatus(row.suggestion.id, userId);
    await reconcileObjectMerge({
      survivorId,
      mergedIds,
      reason: 'Objects were merged from another cleanup suggestion.',
    });
    await reconcileAcceptedItemBestEffort({ ...row.item, resultId: survivorId });
    await reconcileStaleActionableItemsBestEffort({
      suggestionItemId: input.itemId,
      suggestionId: row.suggestion.id,
      op: 'accept_object_merge',
    });
    return { survivorId };
  }

  async function listSuggestions(
    opts: { status?: SuggestionListStatus; limit?: number } = {},
  ): Promise<SuggestionBundle[]> {
    await ensureMember();
    const status = opts.status ?? 'pending';
    const conditions = [suggestionVisibilityPredicate(teamId, userId)];
    if (status === 'pending') {
      conditions.push(
        inArray(agentSuggestions.status, ['pending', 'partially_resolved']),
        actionableItemExistsPredicate(),
      );
    } else if (status === 'resolved') {
      conditions.push(
        or(
          inArray(agentSuggestions.status, ['accepted', 'rejected', 'superseded']),
          and(
            eq(agentSuggestions.status, 'partially_resolved'),
            isNotNull(agentSuggestions.resolvedAt),
          ),
        ),
      );
    } else if (status === 'failed') {
      conditions.push(
        sql`EXISTS (
	          SELECT 1 FROM ${agentSuggestionItems}
	          WHERE ${agentSuggestionItems.suggestionId} = ${agentSuggestions.id}
	            AND ${agentSuggestionItems.status} = 'failed'
	        )`,
      );
    }
    const rows = await db
      .select()
      .from(agentSuggestions)
      .where(and(...conditions))
      .orderBy(desc(agentSuggestions.createdAt))
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 200));
    return hydrateBundles(rows);
  }

  return {
    async createOrMergeSuggestionBundle(input: CreateSuggestionInput): Promise<SuggestionBundle> {
      await ensureMember();
      if (input.items.length === 0) throw new Error('Suggestion requires at least one item');
      const visibility = input.visibility ?? 'team';
      const visibilityOwnerUserId =
        input.visibilityOwnerUserId === undefined
          ? visibility === 'team'
            ? null
            : userId
          : input.visibilityOwnerUserId;
      if (visibilityOwnerUserId) await deps.requireTeamMember(visibilityOwnerUserId);
      for (const uid of input.visibilityUserIds ?? []) await deps.requireTeamMember(uid);
      const metadata = input.metadata ?? {};
      await validateEvidenceVisible((input.evidence ?? []).map((ev) => ev.rawEventId));
      const objectTypeByTargetId = await objectTypesForItems(input.items);
      const correctionDedupeKey = `${input.dedupeKey}:correction:${suggestionDedupeKey({
        title: input.title,
        summary: input.summary ?? null,
        items: input.items,
        evidence: input.evidence?.map((ev) => ev.rawEventId) ?? [],
      })}`;
      const existingRows = await db
        .select({ id: agentSuggestions.id, status: agentSuggestions.status })
        .from(agentSuggestions)
        .where(
          and(eq(agentSuggestions.teamId, teamId), eq(agentSuggestions.dedupeKey, input.dedupeKey)),
        )
        .limit(1);
      const existing = existingRows[0];
      if (existing?.status === 'superseded') {
        const existingItems = await db
          .select({ dedupeKey: agentSuggestionItems.dedupeKey })
          .from(agentSuggestionItems)
          .where(eq(agentSuggestionItems.suggestionId, existing.id));
        const existingItemDedupeKeys = new Set(existingItems.map((item) => item.dedupeKey));
        if (input.items.every((item) => existingItemDedupeKeys.has(item.dedupeKey))) {
          const loaded = await loadBundle(existing.id);
          if (!loaded) throw new Error('Suggestion was not visible after creation');
          return loaded;
        }
      }
      const dedupeKey =
        existing &&
        (existing.status === 'accepted' ||
          existing.status === 'rejected' ||
          existing.status === 'superseded')
          ? correctionDedupeKey
          : input.dedupeKey;

      const result = await db.transaction(async (tx) => {
        const suggestionValues = {
          teamId,
          source: input.source,
          title: input.title,
          summary: input.summary ?? null,
          reason: input.reason ?? null,
          confidence: input.confidence ?? 'medium',
          dedupeKey,
          visibility,
          visibilityOwnerUserId,
          visibilityUserIds: input.visibilityUserIds ?? null,
          metadata,
        };
        const insertSuggestion = async (candidateDedupeKey: string) => {
          const [row] = await tx
            .insert(agentSuggestions)
            .values({
              ...suggestionValues,
              dedupeKey: candidateDedupeKey,
            })
            .onConflictDoUpdate({
              target: [agentSuggestions.teamId, agentSuggestions.dedupeKey],
              set: {
                title: input.title,
                summary: input.summary ?? null,
                reason: input.reason ?? null,
                confidence: input.confidence ?? 'medium',
                metadata: sql`${agentSuggestions.metadata} || ${JSON.stringify(metadata)}::jsonb`,
                updatedAt: new Date(),
              },
              where: sql`${agentSuggestions.status} NOT IN ('accepted', 'rejected', 'superseded')`,
            })
            .returning();
          return row;
        };

        let inserted = await insertSuggestion(dedupeKey);
        if (!inserted && dedupeKey === input.dedupeKey) {
          inserted = await insertSuggestion(correctionDedupeKey);
        }
        if (!inserted) {
          const [resolvedDuplicate] = await tx
            .select()
            .from(agentSuggestions)
            .where(
              and(eq(agentSuggestions.teamId, teamId), eq(agentSuggestions.dedupeKey, dedupeKey)),
            )
            .limit(1);
          if (resolvedDuplicate?.status === 'accepted') {
            return { row: resolvedDuplicate, changed: false };
          }
          if (resolvedDuplicate?.status === 'superseded') {
            return { row: resolvedDuplicate, changed: false };
          }
          if (resolvedDuplicate?.status === 'rejected') {
            for (let attempt = 1; attempt <= 10; attempt += 1) {
              const reofferDedupeKey = `${dedupeKey}:reoffer:${attempt}`;
              inserted = await insertSuggestion(reofferDedupeKey);
              if (inserted) break;

              const [reofferDuplicate] = await tx
                .select()
                .from(agentSuggestions)
                .where(
                  and(
                    eq(agentSuggestions.teamId, teamId),
                    eq(agentSuggestions.dedupeKey, reofferDedupeKey),
                  ),
                )
                .limit(1);
              if (reofferDuplicate?.status === 'accepted') {
                return { row: reofferDuplicate, changed: false };
              }
              if (reofferDuplicate?.status !== 'rejected') break;
            }
          }
        }
        if (!inserted) {
          throw new Error('Failed to create suggestion');
        }

        if (input.evidence?.length) {
          await tx
            .insert(agentSuggestionEvidence)
            .values(
              input.evidence.map((ev) => ({
                suggestionId: inserted.id,
                teamId,
                rawEventId: ev.rawEventId,
                quote: ev.quote ?? null,
                metadata: ev.metadata ?? {},
              })),
            )
            .onConflictDoNothing();
        }

        await tx
          .insert(agentSuggestionItems)
          .values(
            input.items.map((item) => {
              const proposedPayload = normalizeLifecyclePayload({
                targetKind: item.targetKind,
                proposedPayload: item.proposedPayload,
                objectType:
                  item.targetKind === 'object' && item.operation !== 'create'
                    ? (objectTypeByTargetId.get(item.targetId ?? '') ?? null)
                    : null,
              });
              return {
                suggestionId: inserted.id,
                teamId,
                status: 'pending' as const,
                operation: item.operation,
                targetKind: item.targetKind,
                targetId: item.targetId ?? null,
                title: item.title,
                description: item.description ?? null,
                dedupeKey: item.dedupeKey,
                proposedPayload,
              };
            }),
          )
          .onConflictDoUpdate({
            target: [agentSuggestionItems.suggestionId, agentSuggestionItems.dedupeKey],
            set: {
              title: sql`CASE WHEN ${agentSuggestionItems.status} = 'pending' THEN excluded.title ELSE ${agentSuggestionItems.title} END`,
              description: sql`CASE WHEN ${agentSuggestionItems.status} = 'pending' THEN excluded.description ELSE ${agentSuggestionItems.description} END`,
              targetId: sql`CASE WHEN ${agentSuggestionItems.status} = 'pending' THEN excluded.target_id ELSE ${agentSuggestionItems.targetId} END`,
              proposedPayload: sql`CASE WHEN ${agentSuggestionItems.status} = 'pending' THEN excluded.proposed_payload ELSE ${agentSuggestionItems.proposedPayload} END`,
              updatedAt: new Date(),
            },
          });

        return { row: inserted, changed: true };
      });
      if (result.changed) {
        await reconcileNewSuggestionItems(result.row.id);
        await notifySuggestion(result.row);
      }
      const loaded = await loadBundle(result.row.id);
      if (!loaded) throw new Error('Suggestion was not visible after creation');
      return loaded;
    },

    listSuggestions,

    async listPendingSuggestions(): Promise<SuggestionBundle[]> {
      return listSuggestions({ status: 'pending' });
    },

    getSuggestion: loadBundle,

    async countPendingSuggestions(): Promise<number> {
      await ensureMember();
      const rows = await db
        .select({ total: count() })
        .from(agentSuggestions)
        .where(
          and(
            suggestionVisibilityPredicate(teamId, userId),
            inArray(agentSuggestions.status, ['pending', 'partially_resolved']),
            actionableItemExistsPredicate(),
          ),
        );
      return rows[0]?.total ?? 0;
    },

    acceptSuggestionItem,

    acceptObjectMergeSuggestionItem,

    reconcileCanonicalChange,
    reconcileObjectMerge,
    reconcileStaleSuggestionItem,

    reconcileDuplicatePendingApprovals,

    async rejectSuggestionItem(itemId: string): Promise<boolean> {
      await ensureMember();
      const rows = await db
        .select({ item: agentSuggestionItems, suggestion: agentSuggestions })
        .from(agentSuggestionItems)
        .innerJoin(agentSuggestions, eq(agentSuggestions.id, agentSuggestionItems.suggestionId))
        .where(
          and(
            eq(agentSuggestionItems.id, itemId),
            suggestionVisibilityPredicate(teamId, userId),
            isNull(agentSuggestionItems.resolvedAt),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return false;
      const [rejected] = await db
        .update(agentSuggestionItems)
        .set({
          status: 'rejected',
          resolvedAt: new Date(),
          resolvedByUserId: userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentSuggestionItems.id, itemId),
            isNull(agentSuggestionItems.resolvedAt),
            inArray(agentSuggestionItems.status, ['pending', 'failed']),
          ),
        )
        .returning({ id: agentSuggestionItems.id });
      if (!rejected) return false;
      await supersedeRelationshipDependents(row.item);
      await refreshBundleStatus(row.suggestion.id, userId);
      await reconcileStaleActionableItemsBestEffort({
        suggestionItemId: itemId,
        suggestionId: row.suggestion.id,
        op: 'reject',
      });
      return true;
    },

    async acceptAll(suggestionId: string): Promise<{ accepted: number; failed: number }> {
      const bundle = await loadBundle(suggestionId);
      if (!bundle) return { accepted: 0, failed: 0 };
      let accepted = 0;
      let failed = 0;
      for (const item of orderSuggestionItemsForAcceptance(
        bundle.items.filter(
          (i) =>
            (i.status === 'pending' || i.status === 'failed') && i.targetKind !== 'object_merge',
        ),
      )) {
        try {
          if (await acceptSuggestionItem(item.id)) accepted += 1;
        } catch {
          failed += 1;
        }
      }
      return { accepted, failed };
    },

    async acceptSelected(input: {
      suggestionId: string;
      itemIds: string[];
    }): Promise<{ accepted: number; failed: number }> {
      const itemIds = [...new Set(input.itemIds)];
      const bundle = await loadBundle(input.suggestionId);
      if (!bundle) return { accepted: 0, failed: itemIds.length };
      const selectedIds = new Set(itemIds);
      let accepted = 0;
      let failed = 0;
      for (const item of orderSuggestionItemsForAcceptance(
        bundle.items.filter(
          (i) =>
            selectedIds.has(i.id) &&
            (i.status === 'pending' || i.status === 'failed') &&
            i.targetKind !== 'object_merge',
        ),
      )) {
        try {
          if (await acceptSuggestionItem(item.id)) accepted += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      failed += itemIds.length - accepted - failed;
      return { accepted, failed };
    },
  };
}

export type SuggestionScope = ReturnType<typeof createSuggestionScope>;
