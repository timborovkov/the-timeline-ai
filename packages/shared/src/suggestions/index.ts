import { createHash } from 'node:crypto';

import {
  agentSuggestionEvidence,
  agentSuggestionItems,
  agentSuggestions,
  notifications,
  rawEvents,
  teamMembers,
  type Db,
} from '@timeline/db';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type {
  CalendarScope,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
} from '../calendar/index.js';
import type { CreateObjectInput, ObjectPatch, ObjectScope, ObjectType } from '../objects/index.js';
import type { TeamRole } from '../team-scope.js';

type Visibility = 'private' | 'team' | 'specific_users';
type SuggestionStatus = 'pending' | 'partially_resolved' | 'accepted' | 'rejected';
type ItemStatus = 'pending' | 'accepted' | 'rejected' | 'failed';
type Operation = 'create' | 'update' | 'archive_or_cancel';
type TargetKind = 'object' | 'task' | 'calendar_event';

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
  status: z.string().trim().min(1).max(40).optional(),
  stage: z.string().trim().max(40).nullable().optional(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  ownerUserId: uuid.nullable().optional(),
  assigneeUserId: uuid.nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  parentObjectId: uuid.nullable().optional(),
  sourceEventId: uuid.nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const objectUpdatePayload = z.object({
  canonicalName: z.string().trim().min(1).max(200).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  stage: z.string().trim().max(40).nullable().optional(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  ownerUserId: uuid.nullable().optional(),
  assigneeUserId: uuid.nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
});

const calendarCreatePayload = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  timezone: z.string().max(100).default('UTC'),
  allDay: z.boolean().default(false),
  location: z.string().trim().max(500).nullable().optional(),
  visibility: z.enum(['team', 'private', 'specific_users']).default('team'),
  visibilityUserIds: z.array(uuid).nullable().optional(),
  reminderMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  linkedEntityIds: z.array(uuid).max(20).optional(),
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
    const [items, evidence] = await Promise.all([
      db
        .select()
        .from(agentSuggestionItems)
        .where(eq(agentSuggestionItems.suggestionId, row.id))
        .orderBy(asc(agentSuggestionItems.createdAt)),
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
        .where(eq(agentSuggestionEvidence.suggestionId, row.id))
        .orderBy(asc(agentSuggestionEvidence.createdAt)),
    ]);
    return toBundle(row, items, evidence);
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

  async function applyItem(item: typeof agentSuggestionItems.$inferSelect): Promise<string | null> {
    if (item.status !== 'pending' && item.status !== 'failed') return item.resultId;
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
        if (parsed.status !== undefined) input.status = parsed.status;
        if (parsed.stage !== undefined) input.stage = parsed.stage;
        if (parsed.priority !== undefined) input.priority = parsed.priority;
        if (parsed.ownerUserId !== undefined) input.ownerUserId = parsed.ownerUserId;
        if (parsed.assigneeUserId !== undefined) input.assigneeUserId = parsed.assigneeUserId;
        if (parsed.dueAt !== undefined) input.dueAt = parsed.dueAt ? new Date(parsed.dueAt) : null;
        if (parsed.parentObjectId !== undefined) input.parentObjectId = parsed.parentObjectId;
        if (parsed.sourceEventId !== undefined) input.sourceEventId = parsed.sourceEventId;
        if (parsed.metadata !== undefined) input.metadata = parsed.metadata;
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

    if (item.operation === 'create') {
      const parsed = calendarCreatePayload.parse(payload);
      const input: CreateCalendarEventInput = {
        title: parsed.title,
        description: parsed.description ?? null,
        startAt: new Date(parsed.startAt),
        endAt: new Date(parsed.endAt),
        timezone: parsed.timezone,
        allDay: parsed.allDay,
        location: parsed.location ?? null,
        visibility: parsed.visibility,
        visibilityUserIds: parsed.visibilityUserIds ?? null,
        reminderMinutes: parsed.reminderMinutes ?? null,
        agentSuggested: false,
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
      if (parsed.startAt !== undefined) patch.startAt = new Date(parsed.startAt);
      if (parsed.endAt !== undefined) patch.endAt = new Date(parsed.endAt);
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
    const bundles = await Promise.all(rows.map((bundleRow) => loadBundle(bundleRow.id)));
    return bundles.filter((b): b is SuggestionBundle => b !== null);
  }

  return {
    async createOrMergeSuggestionBundle(input: CreateSuggestionInput): Promise<SuggestionBundle> {
      await ensureMember();
      if (input.items.length === 0) throw new Error('Suggestion requires at least one item');
      const visibility = input.visibility ?? 'team';
      const visibilityOwnerUserId =
        input.visibilityOwnerUserId ?? (visibility === 'team' ? null : userId);
      if (visibilityOwnerUserId) await deps.requireTeamMember(visibilityOwnerUserId);
      for (const uid of input.visibilityUserIds ?? []) await deps.requireTeamMember(uid);
      const metadata = input.metadata ?? {};

      const row = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(agentSuggestions)
          .values({
            teamId,
            source: input.source,
            title: input.title,
            summary: input.summary ?? null,
            reason: input.reason ?? null,
            confidence: input.confidence ?? 'medium',
            dedupeKey: input.dedupeKey,
            visibility,
            visibilityOwnerUserId,
            visibilityUserIds: input.visibilityUserIds ?? null,
            metadata,
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
          })
          .returning();
        if (!inserted) throw new Error('Failed to create suggestion');

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
          .onConflictDoNothing();

        return inserted;
      });
      await notifySuggestion(row);
      const loaded = await loadBundle(row.id);
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
        .select({ id: agentSuggestions.id })
        .from(agentSuggestions)
        .where(
          and(
            suggestionVisibilityPredicate(teamId, userId),
            inArray(agentSuggestions.status, ['pending', 'partially_resolved']),
          ),
        );
      return rows.length;
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
