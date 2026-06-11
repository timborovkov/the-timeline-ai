import { createHash } from 'node:crypto';

import {
  agentSuggestionEvidence,
  agentSuggestionItems,
  agentSuggestions,
  calendarEvents,
  entities,
  objectIdentityFacets,
  notifications,
  rawEvents,
  teamMembers,
  type Db,
} from '@timeline/db';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

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
  | 'object_merge';

export interface SuggestionScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (role?: TeamRole) => Promise<TeamRole>;
  requireTeamMember: (otherUserId: string) => Promise<void>;
  objects: ObjectScope;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE);

const objectCreatePayload = z.object({
  type: z.string().optional(),
  canonicalName: z.string().trim().max(200).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  stage: z.string().trim().max(40).nullable().optional(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  ownerUserId: uuid.nullable().optional(),
  assigneeUserId: uuid.nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  parentObjectId: uuid.nullable().optional(),
  sourceEventId: uuid.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const objectUpdatePayload = z.object({
  canonicalName: z.string().trim().min(1).max(200).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  stage: z.string().trim().max(40).nullable().optional(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  ownerUserId: uuid.nullable().optional(),
  assigneeUserId: uuid.nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
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
  entityId: uuid,
  body: z.string().trim().min(1).max(5000),
});

const objectRelationshipPayload = z.object({
  fromEntityId: uuid,
  toEntityId: uuid,
  kind: z.enum(['parent', 'child', 'related', 'blocks', 'blocked_by', 'duplicate_of', 'linked']),
});

const objectMergePayload = z.object({
  objectIds: z.array(uuid).min(2).max(10),
  survivorId: uuid,
  reason: z.string().trim().max(1000).optional(),
});

const calendarCreatePayload = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  timezone: z.string().max(100).default('UTC'),
  allDay: z.boolean().default(false),
  location: z.string().trim().max(500).nullable().optional(),
  visibility: z.enum(['team', 'private', 'specific_users']).default('team'),
  visibilityUserIds: z.array(uuid).nullable().optional(),
  reminderMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  linkedEntityIds: z.array(uuid).max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const calendarUpdatePayload = calendarCreatePayload.partial();

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
  const payload = item.proposedPayload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return new Set();
  return new Set(Object.keys(payload));
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
  return new Set([item.targetId, item.resultId].filter((id): id is string => Boolean(id)));
}

function artifactExternalKey(item: typeof agentSuggestionItems.$inferSelect): string | null {
  const payload = item.proposedPayload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
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
    (olderItem.dedupeKey === newerItem.dedupeKey || olderItem.title === newerItem.title) &&
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
  const { db, teamId, userId, ensureMember, objects, calendar } = deps;

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
        .orderBy(asc(agentSuggestionItems.suggestionId), asc(agentSuggestionItems.createdAt)),
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
      .returning({
        suggestionId: agentSuggestionItems.suggestionId,
      });
    if (!row) return false;
    await refreshBundleStatus(row.suggestionId);
    return true;
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
        if (candidate.item.createdAt.getTime() >= newerItem.createdAt.getTime()) continue;
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
            sql`${rawEvents.sourceMetadata} ->> 'kind' = 'object_note_create'`,
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

  async function applyItem(item: typeof agentSuggestionItems.$inferSelect): Promise<string | null> {
    if (item.resultId) return item.resultId;
    if (item.status !== 'pending' && item.status !== 'failed') return item.resultId;
    if (item.targetKind === 'object_merge') {
      throw new Error('Merge suggestions must be reviewed from the merge preview');
    }
    const existingResultId = await existingResultForItem(item);
    if (existingResultId) return existingResultId;
    const targetId = item.targetId;
    const payload = item.proposedPayload as Record<string, unknown>;

    if (item.targetKind === 'task' || item.targetKind === 'object') {
      if (item.operation === 'create') {
        const parsed = objectCreatePayload.parse(payload);
        const canonicalName =
          parsed.canonicalName !== undefined && parsed.canonicalName.length > 0
            ? parsed.canonicalName
            : item.title;
        const input: CreateObjectInput = {
          type: (item.targetKind === 'task' ? 'task' : (parsed.type ?? 'other')) as ObjectType,
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
        const created = await objects.createObject(input);
        return created.id;
      }
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
      if (item.operation !== 'create') throw new Error('Object notes only support create');
      const parsed = objectNotePayload.parse(payload);
      const created = await objects.createNote({
        entityId: parsed.entityId,
        body: parsed.body,
        authorUserId: null,
        metadata: { agent_suggestion_item_id: item.id },
        actor: { kind: 'agent', userId: null },
      });
      return created.id;
    }

    if (item.targetKind === 'object_relationship') {
      if (item.operation !== 'create') throw new Error('Object relationships only support create');
      const parsed = objectRelationshipPayload.parse(payload);
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

    if (item.operation === 'create') {
      const parsed = calendarCreatePayload.parse(payload);
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
        visibility: parsed.visibility,
        visibilityUserIds: parsed.visibilityUserIds ?? null,
        reminderMinutes: parsed.reminderMinutes ?? null,
        agentSuggested: false,
        metadata: {
          ...(parsed.metadata ?? {}),
          agent_suggestion_item_id: item.id,
        },
      };
      if (parsed.linkedEntityIds !== undefined) input.linkedEntityIds = parsed.linkedEntityIds;
      const created = await calendar.createCalendarEvent(input);
      return created.id;
    }
    if (!targetId) throw new Error('Target id is required');
    if (item.operation === 'update') {
      const parsed = calendarUpdatePayload.parse(payload);
      const patch: UpdateCalendarEventInput = {};
      if (parsed.title !== undefined) patch.title = parsed.title;
      if (parsed.description !== undefined) patch.description = parsed.description;
      const event =
        parsed.startAt !== undefined || parsed.endAt !== undefined
          ? await calendar.getCalendarEvent(targetId)
          : null;
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
      if (parsed.visibility !== undefined) patch.visibility = parsed.visibility;
      if (parsed.visibilityUserIds !== undefined)
        patch.visibilityUserIds = parsed.visibilityUserIds;
      if (parsed.reminderMinutes !== undefined) patch.reminderMinutes = parsed.reminderMinutes;
      await calendar.updateCalendarEvent(targetId, patch);
      return targetId;
    }
    await calendar.deleteCalendarEvent(targetId);
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
      await db
        .update(agentSuggestionItems)
        .set({
          status: 'failed',
          failureReason: err instanceof Error ? err.message : 'Failed to apply suggestion',
          resolvedAt: null,
          resolvedByUserId: null,
          updatedAt: new Date(),
        })
        .where(eq(agentSuggestionItems.id, itemId));
      await refreshBundleStatus(row.suggestion.id, userId);
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
    const expectedIds = new Set(payload.objectIds);
    const chosenIds = new Set([input.survivorId, ...input.mergedIds]);
    if (expectedIds.size !== chosenIds.size || [...expectedIds].some((id) => !chosenIds.has(id))) {
      throw new Error('Merge selection no longer matches this suggestion');
    }
    if (!expectedIds.has(input.survivorId)) {
      throw new Error('Survivor must be one of the suggested objects');
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
        survivorId: input.survivorId,
        mergedIds: input.mergedIds,
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
    await reconcileAcceptedItemBestEffort({ ...row.item, resultId: survivorId });
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
            input.items.map((item) => ({
              suggestionId: inserted.id,
              teamId,
              status: 'pending' as const,
              operation: item.operation,
              targetKind: item.targetKind,
              targetId: item.targetId ?? null,
              title: item.title,
              description: item.description ?? null,
              dedupeKey: item.dedupeKey,
              proposedPayload: item.proposedPayload,
            })),
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
      await refreshBundleStatus(row.suggestion.id, userId);
      return true;
    },

    async acceptAll(suggestionId: string): Promise<{ accepted: number; failed: number }> {
      const bundle = await loadBundle(suggestionId);
      if (!bundle) return { accepted: 0, failed: 0 };
      let accepted = 0;
      let failed = 0;
      for (const item of bundle.items.filter(
        (i) => (i.status === 'pending' || i.status === 'failed') && i.targetKind !== 'object_merge',
      )) {
        try {
          if (await acceptSuggestionItem(item.id)) accepted += 1;
        } catch {
          failed += 1;
        }
      }
      return { accepted, failed };
    },
  };
}

export type SuggestionScope = ReturnType<typeof createSuggestionScope>;
