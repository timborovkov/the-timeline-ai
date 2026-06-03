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
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
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

import { localDateFromInstant, localDateSpanToUtcRange } from '#src/time/index.js';

type Visibility = 'private' | 'team' | 'specific_users';
type SuggestionStatus = 'pending' | 'partially_resolved' | 'accepted' | 'rejected';
type ItemStatus = 'pending' | 'accepted' | 'rejected' | 'failed';
type Operation = 'create' | 'update' | 'archive_or_cancel';
type TargetKind =
  | 'object'
  | 'task'
  | 'calendar_event'
  | 'identity_facet'
  | 'object_note'
  | 'object_relationship';

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
  canonicalName: z.string().trim().min(1).max(200),
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
    const pending = items.filter((i) => i.status === 'pending' || i.status === 'failed').length;
    const accepted = items.filter((i) => i.status === 'accepted').length;
    const rejected = items.filter((i) => i.status === 'rejected').length;
    const status: SuggestionStatus =
      pending > 0
        ? accepted > 0 || rejected > 0
          ? 'partially_resolved'
          : 'pending'
        : accepted > 0 && rejected === 0
          ? 'accepted'
          : rejected > 0 && accepted === 0
            ? 'rejected'
            : 'partially_resolved';
    await db
      .update(agentSuggestions)
      .set({
        status,
        updatedAt: new Date(),
        ...(pending === 0
          ? { resolvedAt: new Date(), resolvedByUserId: resolvedByUserId ?? null }
          : {}),
      })
      .where(eq(agentSuggestions.id, suggestionId));
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
    const existingResultId = await existingResultForItem(item);
    if (existingResultId) return existingResultId;
    const targetId = item.targetId;
    const payload = item.proposedPayload as Record<string, unknown>;

    if (item.targetKind === 'task' || item.targetKind === 'object') {
      if (item.operation === 'create') {
        const parsed = objectCreatePayload.parse(payload);
        const input: CreateObjectInput = {
          type: (item.targetKind === 'task' ? 'task' : (parsed.type ?? 'other')) as ObjectType,
          canonicalName: parsed.canonicalName,
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
    try {
      const resultId = await applyItem(row.item);
      await db
        .update(agentSuggestionItems)
        .set({
          resultId,
          updatedAt: new Date(),
          failureReason: null,
        })
        .where(eq(agentSuggestionItems.id, itemId));
      await refreshBundleStatus(row.suggestion.id, userId);
      return true;
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
  }

  async function listSuggestions(
    opts: { status?: SuggestionListStatus; limit?: number } = {},
  ): Promise<SuggestionBundle[]> {
    await ensureMember();
    const status = opts.status ?? 'pending';
    const conditions = [suggestionVisibilityPredicate(teamId, userId)];
    if (status === 'pending') {
      conditions.push(inArray(agentSuggestions.status, ['pending', 'partially_resolved']));
    } else if (status === 'resolved') {
      conditions.push(inArray(agentSuggestions.status, ['accepted', 'rejected']));
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
      const dedupeKey =
        existing && (existing.status === 'accepted' || existing.status === 'rejected')
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
              where: sql`${agentSuggestions.status} NOT IN ('accepted', 'rejected')`,
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
      if (result.changed) await notifySuggestion(result.row);
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
          ),
        );
      return rows[0]?.total ?? 0;
    },

    acceptSuggestionItem,

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
        (i) => i.status === 'pending' || i.status === 'failed',
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
