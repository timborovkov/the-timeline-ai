import {
  type Db,
  boards,
  calendarEvents,
  documents,
  entities,
  meetings,
  savedMeetings,
  teamMembers,
  userPins,
} from '@timeline/db';
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { CalendarScope } from '#src/calendar/scope.js';
import type { TeamScopeCore } from '#src/team-scope.js';
import type { TimelineMomentEvent } from '#src/timeline-moments/index.js';

import { childLogger } from '#src/logger.js';
import {
  buildTimelineMoments,
  timelineMomentAnchorId,
  timelineMomentLookupPlan,
} from '#src/timeline-moments/index.js';

export const PIN_TARGET_KINDS = [
  'object',
  'board',
  'document',
  'meeting',
  'saved_meeting',
  'calendar_event',
  'timeline_moment',
] as const;

export const pinTargetKindSchema = z.enum(PIN_TARGET_KINDS);
export type PinTargetKind = (typeof PIN_TARGET_KINDS)[number];

export interface PinTargetRef {
  kind: PinTargetKind;
  key: string;
}

export interface PinnedItem {
  pinId: string;
  target: PinTargetRef;
  title: string;
  subtitle?: string;
  href: string;
  iconKind: string;
  timestamp?: string;
  status?: string;
  sortKey: string;
  pinnedAt: string;
}

export interface PinPage {
  items: PinnedItem[];
  nextCursor: string | null;
}

interface PinScopeDeps {
  db: Db;
  scope: TeamScopeCore;
  calendar: CalendarScope;
  listEventsForMomentLookups: (
    plans: NonNullable<ReturnType<typeof timelineMomentLookupPlan>>[],
  ) => Promise<TimelineMomentEvent[]>;
  listTeamEventsForMomentLookup: (
    plan: NonNullable<ReturnType<typeof timelineMomentLookupPlan>>,
  ) => Promise<TimelineMomentEvent[]>;
  getTimezone: () => Promise<string>;
}

interface PinCursor {
  sortKey: bigint;
  id: string;
}

type PinRow = typeof userPins.$inferSelect;
type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SORT_GAP = 1024n;
const SORT_SAFETY_MIN = -9_000_000_000_000_000_000n;
const PIN_LIST_BATCH = 100;
const log = childLogger('pins');

function encodePinCursor(cursor: PinCursor): string {
  return Buffer.from(
    JSON.stringify({ sortKey: cursor.sortKey.toString(), id: cursor.id }),
    'utf8',
  ).toString('base64url');
}

function decodePinCursor(value: string | null | undefined): PinCursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!decoded || typeof decoded !== 'object') return null;
    const sortKey = (decoded as { sortKey?: unknown }).sortKey;
    const id = (decoded as { id?: unknown }).id;
    if (typeof sortKey !== 'string' || typeof id !== 'string' || !UUID_RE.test(id)) return null;
    return { sortKey: BigInt(sortKey), id };
  } catch {
    return null;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function assertRef(ref: PinTargetRef): void {
  if (!PIN_TARGET_KINDS.includes(ref.kind)) throw new Error('Pinned item not available');
  if (!ref.key || ref.key.length > 500) throw new Error('Pinned item not available');
  if (ref.kind !== 'timeline_moment' && !UUID_RE.test(ref.key)) {
    throw new Error('Pinned item not available');
  }
  if (ref.kind === 'timeline_moment' && !timelineMomentLookupPlan(ref.key)) {
    throw new Error('Pinned item not available');
  }
}

function normalizeRef(ref: PinTargetRef): PinTargetRef {
  return ref.kind === 'timeline_moment' ? ref : { kind: ref.kind, key: ref.key.toLowerCase() };
}

function itemFromRow(
  pin: PinRow,
  presentation: Omit<PinnedItem, 'pinId' | 'target' | 'sortKey' | 'pinnedAt'>,
): PinnedItem {
  return {
    pinId: pin.id,
    target: { kind: pin.targetKind, key: pin.targetKey },
    sortKey: pin.sortKey.toString(),
    pinnedAt: pin.createdAt.toISOString(),
    ...presentation,
  };
}

function objectSubtitle(row: typeof entities.$inferSelect): string {
  const type = row.type.replaceAll('_', ' ');
  return `${type.slice(0, 1).toUpperCase()}${type.slice(1)} · ${row.status}`;
}

async function lockUserPins(tx: DbTx, scope: TeamScopeCore): Promise<void> {
  await tx.execute(sql`
    SELECT 1
    FROM ${teamMembers}
    WHERE ${teamMembers.teamId} = ${scope.teamId}
      AND ${teamMembers.userId} = ${scope.userId}
      AND ${teamMembers.removedAt} IS NULL
    FOR UPDATE
  `);
}

async function rebalancePins(tx: DbTx, scope: TeamScopeCore): Promise<void> {
  const rows = await tx
    .select({ id: userPins.id })
    .from(userPins)
    .where(and(eq(userPins.teamId, scope.teamId), eq(userPins.userId, scope.userId)))
    .orderBy(asc(userPins.sortKey), asc(userPins.id));
  for (const [index, row] of rows.entries()) {
    await tx
      .update(userPins)
      .set({ sortKey: BigInt(index) * SORT_GAP, updatedAt: new Date() })
      .where(
        and(
          eq(userPins.teamId, scope.teamId),
          eq(userPins.userId, scope.userId),
          eq(userPins.id, row.id),
        ),
      );
  }
  log.info(
    { teamId: scope.teamId, userId: scope.userId, count: rows.length },
    'pin ranks rebalanced',
  );
}

export function createPinScope(deps: PinScopeDeps) {
  const {
    db,
    scope,
    calendar,
    listEventsForMomentLookups,
    listTeamEventsForMomentLookup,
    getTimezone,
  } = deps;

  const documentVisibility = or(
    eq(documents.visibility, 'team'),
    and(eq(documents.visibility, 'private'), eq(documents.ownerUserId, scope.userId)),
    and(
      eq(documents.visibility, 'specific_users'),
      sql`COALESCE(${scope.userId}::uuid = ANY(${documents.visibilityUserIds}), false)`,
    ),
  );
  const meetingVisibility = sql`(
    ${meetings.defaultVisibility} = 'team'
    OR (${meetings.defaultVisibility} = 'private' AND ${meetings.createdByUserId} = ${scope.userId}::uuid)
    OR (${meetings.defaultVisibility} = 'specific_users' AND COALESCE(${scope.userId}::uuid = ANY(${meetings.visibilityUserIds}), false))
  )`;
  const savedMeetingVisibility = sql`(
    ${savedMeetings.defaultVisibility} = 'team'
    OR (${savedMeetings.defaultVisibility} = 'private' AND ${savedMeetings.createdByUserId} = ${scope.userId}::uuid)
    OR (${savedMeetings.defaultVisibility} = 'specific_users' AND COALESCE(${scope.userId}::uuid = ANY(${savedMeetings.visibilityUserIds}), false))
  )`;
  const calendarFullVisibility = sql`(
    ${calendarEvents.visibility} = 'team'
    OR ${calendarEvents.createdByUserId} = ${scope.userId}::uuid
    OR (${calendarEvents.visibility} = 'specific_users' AND COALESCE(${scope.userId}::uuid = ANY(${calendarEvents.visibilityUserIds}), false))
  )`;

  async function canonicalize(ref: PinTargetRef): Promise<PinTargetRef> {
    assertRef(ref);
    const normalized = normalizeRef(ref);
    if (normalized.kind !== 'calendar_event') return normalized;
    const event = await calendar.getCalendarEvent(normalized.key);
    if (!event || event.redacted) throw new Error('Pinned item not available');
    if (!event.recurringParentId) return normalized;
    const parent = await calendar.getCalendarEvent(event.recurringParentId);
    if (!parent || parent.redacted) throw new Error('Pinned item not available');
    return { kind: 'calendar_event', key: parent.id };
  }

  async function canonicalizeMany(refs: PinTargetRef[]): Promise<(PinTargetRef | null)[]> {
    const calendarKeys: string[] = [];
    for (const ref of refs) {
      try {
        assertRef(ref);
        if (ref.kind === 'calendar_event') calendarKeys.push(ref.key);
      } catch {
        // Invalid references are represented as unavailable without leaking
        // whether a similarly-shaped target exists.
      }
    }
    if (calendarKeys.length === 0) {
      return refs.map((ref) => {
        try {
          assertRef(ref);
          return normalizeRef(ref);
        } catch {
          return null;
        }
      });
    }
    const eventRows = await db
      .select({ id: calendarEvents.id, recurringParentId: calendarEvents.recurringParentId })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.teamId, scope.teamId),
          inArray(calendarEvents.id, unique(calendarKeys)),
          isNull(calendarEvents.deletedAt),
          calendarFullVisibility,
        ),
      );
    const parentIds = unique(
      eventRows.flatMap((row) => (row.recurringParentId ? [row.recurringParentId] : [])),
    );
    const visibleParentIds =
      parentIds.length === 0
        ? new Set<string>()
        : new Set(
            (
              await db
                .select({ id: calendarEvents.id })
                .from(calendarEvents)
                .where(
                  and(
                    eq(calendarEvents.teamId, scope.teamId),
                    inArray(calendarEvents.id, parentIds),
                    isNull(calendarEvents.deletedAt),
                    calendarFullVisibility,
                  ),
                )
            ).map((row) => row.id),
          );
    const byId = new Map(eventRows.map((row) => [row.id, row]));
    return refs.map((ref) => {
      try {
        assertRef(ref);
      } catch {
        return null;
      }
      const normalized = normalizeRef(ref);
      if (normalized.kind !== 'calendar_event') return normalized;
      const row = byId.get(normalized.key);
      if (!row) return null;
      if (!row.recurringParentId) return normalized;
      return visibleParentIds.has(row.recurringParentId)
        ? { kind: 'calendar_event', key: row.recurringParentId }
        : null;
    });
  }

  async function resolveRows(rows: PinRow[]): Promise<Map<string, PinnedItem>> {
    const startedAt = Date.now();
    const resolved = new Map<string, PinnedItem>();
    if (rows.length === 0) return resolved;
    const byKind = new Map<PinTargetKind, PinRow[]>();
    for (const row of rows) {
      const current = byKind.get(row.targetKind) ?? [];
      current.push(row);
      byKind.set(row.targetKind, current);
    }

    const objectPins = byKind.get('object') ?? [];
    if (objectPins.length > 0) {
      const objectRows = await db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.teamId, scope.teamId),
            inArray(entities.id, unique(objectPins.map((pin) => pin.targetKey))),
            isNull(entities.archivedAt),
            isNull(entities.mergedIntoId),
          ),
        );
      const byId = new Map(objectRows.map((row) => [row.id, row]));
      for (const pin of objectPins) {
        const row = byId.get(pin.targetKey);
        if (!row) continue;
        resolved.set(
          pin.id,
          itemFromRow(pin, {
            title: row.canonicalName,
            subtitle: objectSubtitle(row),
            href: `/app/objects/${row.id}`,
            iconKind: row.type,
            status: row.status,
            timestamp: row.updatedAt.toISOString(),
          }),
        );
      }
    }

    const boardPinRows = byKind.get('board') ?? [];
    if (boardPinRows.length > 0) {
      const rowsById = await db
        .select()
        .from(boards)
        .where(
          and(
            eq(boards.teamId, scope.teamId),
            inArray(boards.id, unique(boardPinRows.map((pin) => pin.targetKey))),
            isNull(boards.archivedAt),
          ),
        );
      const byId = new Map(rowsById.map((row) => [row.id, row]));
      for (const pin of boardPinRows) {
        const row = byId.get(pin.targetKey);
        if (!row) continue;
        resolved.set(
          pin.id,
          itemFromRow(pin, {
            title: row.name,
            subtitle: row.purpose || 'Board',
            href: `/app/boards/${row.id}`,
            iconKind: 'board',
            timestamp: row.updatedAt.toISOString(),
          }),
        );
      }
    }

    const documentPinRows = byKind.get('document') ?? [];
    if (documentPinRows.length > 0) {
      const rowsById = await db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.teamId, scope.teamId),
            inArray(documents.id, unique(documentPinRows.map((pin) => pin.targetKey))),
            isNull(documents.deletedAt),
            documentVisibility,
          ),
        );
      const byId = new Map(rowsById.map((row) => [row.id, row]));
      for (const pin of documentPinRows) {
        const row = byId.get(pin.targetKey);
        if (!row) continue;
        resolved.set(
          pin.id,
          itemFromRow(pin, {
            title: row.name,
            subtitle: row.fileKind === 'captured' ? 'Captured file' : 'Document',
            href: `/app/documents/${row.id}`,
            iconKind: 'document',
            timestamp: row.updatedAt.toISOString(),
          }),
        );
      }
    }

    const meetingPinRows = byKind.get('meeting') ?? [];
    if (meetingPinRows.length > 0) {
      const rowsById = await db
        .select()
        .from(meetings)
        .where(
          and(
            eq(meetings.teamId, scope.teamId),
            inArray(meetings.id, unique(meetingPinRows.map((pin) => pin.targetKey))),
            meetingVisibility,
          ),
        );
      const byId = new Map(rowsById.map((row) => [row.id, row]));
      for (const pin of meetingPinRows) {
        const row = byId.get(pin.targetKey);
        if (!row) continue;
        resolved.set(
          pin.id,
          itemFromRow(pin, {
            title: row.title ?? 'Untitled meeting',
            subtitle: `${row.platform} · ${row.status}`,
            href: `/app/meetings/${row.id}`,
            iconKind: 'meeting',
            status: row.status,
            timestamp: (row.startedAt ?? row.scheduledStartAt ?? row.createdAt).toISOString(),
          }),
        );
      }
    }

    const savedPinRows = byKind.get('saved_meeting') ?? [];
    if (savedPinRows.length > 0) {
      const rowsById = await db
        .select()
        .from(savedMeetings)
        .where(
          and(
            eq(savedMeetings.teamId, scope.teamId),
            inArray(savedMeetings.id, unique(savedPinRows.map((pin) => pin.targetKey))),
            isNull(savedMeetings.archivedAt),
            savedMeetingVisibility,
          ),
        );
      const byId = new Map(rowsById.map((row) => [row.id, row]));
      for (const pin of savedPinRows) {
        const row = byId.get(pin.targetKey);
        if (!row) continue;
        resolved.set(
          pin.id,
          itemFromRow(pin, {
            title: row.title,
            subtitle: `${row.platform} · Saved meeting`,
            href: `/app/meetings?tab=saved#saved-meeting-${row.id}`,
            iconKind: 'saved_meeting',
            timestamp: row.updatedAt.toISOString(),
          }),
        );
      }
    }

    const calendarPinRows = byKind.get('calendar_event') ?? [];
    if (calendarPinRows.length > 0) {
      const keys = unique(calendarPinRows.map((pin) => pin.targetKey));
      const eventRows = await db
        .select()
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.teamId, scope.teamId),
            or(inArray(calendarEvents.id, keys), inArray(calendarEvents.recurringParentId, keys)),
            isNull(calendarEvents.deletedAt),
            calendarFullVisibility,
          ),
        )
        .orderBy(asc(calendarEvents.startAt));
      const now = new Date();
      for (const pin of calendarPinRows) {
        const candidates = eventRows.filter(
          (row) => row.id === pin.targetKey || row.recurringParentId === pin.targetKey,
        );
        const parent = candidates.find((row) => row.id === pin.targetKey);
        const next = candidates.find(
          (row) => row.recurringParentId === pin.targetKey && row.endAt >= now,
        );
        const row = next ?? parent ?? candidates.at(-1);
        if (!row) continue;
        const date = row.startAt.toISOString().slice(0, 10);
        resolved.set(
          pin.id,
          itemFromRow(pin, {
            title: parent?.title ?? row.title,
            subtitle: parent?.rrule ? 'Recurring calendar series' : 'Calendar event',
            href: `/app/calendar?date=${date}&view=day&event=${row.id}`,
            iconKind: 'calendar_event',
            timestamp: row.startAt.toISOString(),
          }),
        );
      }
    }

    const momentPinRows = byKind.get('timeline_moment') ?? [];
    if (momentPinRows.length > 0) {
      const timezone = await getTimezone();
      const plans = momentPinRows.flatMap((pin) => {
        const plan = timelineMomentLookupPlan(pin.targetKey);
        return plan ? [plan] : [];
      });
      const events = await listEventsForMomentLookups(plans);
      const momentsById = new Map(
        buildTimelineMoments(events, new Map(), { timezone }).map((moment) => [moment.id, moment]),
      );
      for (const pin of momentPinRows) {
        const moment = momentsById.get(pin.targetKey);
        if (!moment) continue;
        resolved.set(
          pin.id,
          itemFromRow(pin, {
            title: moment.title,
            subtitle: `${moment.sourceLabel} · ${moment.evidenceSummary.rawEventCount} signal${moment.evidenceSummary.rawEventCount === 1 ? '' : 's'}`,
            href: `/app/timeline?moment=${encodeURIComponent(moment.id)}#${timelineMomentAnchorId(moment.id)}`,
            iconKind: `timeline_${moment.kind}`,
            timestamp: new Date(moment.rawEvents[0]?.occurredAt ?? 0).toISOString(),
          }),
        );
      }
    }

    const hiddenByKind: Partial<Record<PinTargetKind, number>> = {};
    for (const [kind, pinRows] of byKind) {
      const hidden = pinRows.filter((pin) => !resolved.has(pin.id)).length;
      if (hidden > 0) hiddenByKind[kind] = hidden;
    }
    const context = {
      teamId: scope.teamId,
      userId: scope.userId,
      requested: rows.length,
      resolved: resolved.size,
      hiddenByKind,
      durationMs: Date.now() - startedAt,
    };
    if (resolved.size < rows.length) log.info(context, 'some personal pins are currently hidden');
    else log.debug(context, 'personal pins resolved');
    return resolved;
  }

  async function resolveTarget(ref: PinTargetRef): Promise<PinnedItem | null> {
    const canonical = await canonicalize(ref);
    const synthetic: PinRow = {
      id: '00000000-0000-0000-0000-000000000000',
      teamId: scope.teamId,
      userId: scope.userId,
      targetKind: canonical.kind,
      targetKey: canonical.key,
      sortKey: 0n,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    return (await resolveRows([synthetic])).get(synthetic.id) ?? null;
  }

  async function resolvePin(pinId: string): Promise<PinnedItem | null> {
    await scope.requireMembership();
    if (!UUID_RE.test(pinId)) return null;
    const [row] = await db
      .select()
      .from(userPins)
      .where(
        and(
          eq(userPins.teamId, scope.teamId),
          eq(userPins.userId, scope.userId),
          eq(userPins.id, pinId),
        ),
      )
      .limit(1);
    if (!row) return null;
    return (await resolveRows([row])).get(row.id) ?? null;
  }

  async function pin(ref: PinTargetRef): Promise<PinnedItem> {
    await scope.requireMembership();
    const canonical = await canonicalize(ref);
    const target = await resolveTarget(canonical);
    if (!target) throw new Error('Pinned item not available');
    const row = await db.transaction(async (tx) => {
      await lockUserPins(tx, scope);
      const [existing] = await tx
        .select()
        .from(userPins)
        .where(
          and(
            eq(userPins.teamId, scope.teamId),
            eq(userPins.userId, scope.userId),
            eq(userPins.targetKind, canonical.kind),
            eq(userPins.targetKey, canonical.key),
          ),
        )
        .limit(1);
      if (existing) return existing;
      let [first] = await tx
        .select({ sortKey: userPins.sortKey })
        .from(userPins)
        .where(and(eq(userPins.teamId, scope.teamId), eq(userPins.userId, scope.userId)))
        .orderBy(asc(userPins.sortKey), asc(userPins.id))
        .limit(1);
      if (first && first.sortKey <= SORT_SAFETY_MIN) {
        await rebalancePins(tx, scope);
        [first] = await tx
          .select({ sortKey: userPins.sortKey })
          .from(userPins)
          .where(and(eq(userPins.teamId, scope.teamId), eq(userPins.userId, scope.userId)))
          .orderBy(asc(userPins.sortKey), asc(userPins.id))
          .limit(1);
      }
      const [inserted] = await tx
        .insert(userPins)
        .values({
          teamId: scope.teamId,
          userId: scope.userId,
          targetKind: canonical.kind,
          targetKey: canonical.key,
          sortKey: (first?.sortKey ?? SORT_GAP) - SORT_GAP,
        })
        .returning();
      if (!inserted) throw new Error('Could not pin item');
      return inserted;
    });
    return {
      ...target,
      pinId: row.id,
      sortKey: row.sortKey.toString(),
      pinnedAt: row.createdAt.toISOString(),
    };
  }

  async function unpin(ref: PinTargetRef): Promise<boolean> {
    await scope.requireMembership();
    let canonical = ref;
    try {
      canonical = await canonicalize(ref);
    } catch {
      assertRef(ref);
      canonical = normalizeRef(ref);
    }
    const rows = await db
      .delete(userPins)
      .where(
        and(
          eq(userPins.teamId, scope.teamId),
          eq(userPins.userId, scope.userId),
          eq(userPins.targetKind, canonical.kind),
          eq(userPins.targetKey, canonical.key),
        ),
      )
      .returning({ id: userPins.id });
    return rows.length > 0;
  }

  async function isPinned(ref: PinTargetRef): Promise<boolean> {
    await scope.requireMembership();
    let canonical: PinTargetRef;
    try {
      canonical = await canonicalize(ref);
    } catch {
      return false;
    }
    const [row] = await db
      .select({ id: userPins.id })
      .from(userPins)
      .where(
        and(
          eq(userPins.teamId, scope.teamId),
          eq(userPins.userId, scope.userId),
          eq(userPins.targetKind, canonical.kind),
          eq(userPins.targetKey, canonical.key),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async function isPinnedMany(refs: PinTargetRef[]): Promise<Record<string, boolean>> {
    await scope.requireMembership();
    const canonical = await canonicalizeMany(refs);
    const valid = canonical.filter((ref): ref is PinTargetRef => ref !== null);
    if (valid.length === 0) return {};
    const conditions = valid.map((ref) =>
      and(eq(userPins.targetKind, ref.kind), eq(userPins.targetKey, ref.key)),
    );
    const rows = await db
      .select({ kind: userPins.targetKind, key: userPins.targetKey })
      .from(userPins)
      .where(
        and(
          eq(userPins.teamId, scope.teamId),
          eq(userPins.userId, scope.userId),
          or(...conditions),
        ),
      );
    const pinned = new Set(rows.map((row) => `${row.kind}:${row.key}`));
    return Object.fromEntries(
      refs.map((ref, index) => {
        const normalized = canonical[index];
        return [
          `${ref.kind}:${ref.key}`,
          normalized ? pinned.has(`${normalized.kind}:${normalized.key}`) : false,
        ];
      }),
    );
  }

  async function list(
    input: {
      limit?: number;
      cursor?: string | null;
      kinds?: PinTargetKind[];
    } = {},
  ): Promise<PinPage> {
    await scope.requireMembership();
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 50);
    const kinds = input.kinds?.length ? [...new Set(input.kinds)] : undefined;
    let cursor = decodePinCursor(input.cursor);
    const items: PinnedItem[] = [];
    let exhausted = false;
    let hasUnscannedRows = false;
    while (items.length < limit && !exhausted) {
      const conditions = [eq(userPins.teamId, scope.teamId), eq(userPins.userId, scope.userId)];
      if (kinds) conditions.push(inArray(userPins.targetKind, kinds));
      if (cursor) {
        const cursorCondition = or(
          gt(userPins.sortKey, cursor.sortKey),
          and(eq(userPins.sortKey, cursor.sortKey), gt(userPins.id, cursor.id)),
        );
        if (cursorCondition) conditions.push(cursorCondition);
      }
      const rows = await db
        .select()
        .from(userPins)
        .where(and(...conditions))
        .orderBy(asc(userPins.sortKey), asc(userPins.id))
        .limit(PIN_LIST_BATCH);
      if (rows.length === 0) {
        exhausted = true;
        break;
      }
      const presentations = await resolveRows(rows);
      for (const [index, row] of rows.entries()) {
        const item = presentations.get(row.id);
        if (item) items.push(item);
        cursor = { sortKey: row.sortKey, id: row.id };
        if (items.length >= limit) {
          hasUnscannedRows = index < rows.length - 1 || rows.length === PIN_LIST_BATCH;
          break;
        }
      }
      exhausted = !hasUnscannedRows && rows.length < PIN_LIST_BATCH;
    }
    return {
      items: items.slice(0, limit),
      nextCursor: (hasUnscannedRows || !exhausted) && cursor ? encodePinCursor(cursor) : null,
    };
  }

  async function move(input: {
    pinId: string;
    beforePinId?: string;
    afterPinId?: string;
    edge?: 'top' | 'bottom';
  }): Promise<boolean> {
    await scope.requireMembership();
    if (!UUID_RE.test(input.pinId)) return false;
    return db.transaction(async (tx) => {
      await lockUserPins(tx, scope);
      const base = and(eq(userPins.teamId, scope.teamId), eq(userPins.userId, scope.userId));
      const [moving] = await tx
        .select()
        .from(userPins)
        .where(and(base, eq(userPins.id, input.pinId)))
        .limit(1);
      if (!moving) return false;

      async function rowFor(id: string | undefined): Promise<PinRow | null> {
        if (!id || !UUID_RE.test(id)) return null;
        const [row] = await tx
          .select()
          .from(userPins)
          .where(and(base, eq(userPins.id, id)))
          .limit(1);
        return row ?? null;
      }

      async function calculateSortKey(): Promise<bigint | null | false> {
        if (input.edge === 'top' || input.edge === 'bottom') {
          const [edge] = await tx
            .select({ sortKey: userPins.sortKey })
            .from(userPins)
            .where(and(base, sql`${userPins.id} <> ${input.pinId}`))
            .orderBy(
              input.edge === 'top' ? asc(userPins.sortKey) : desc(userPins.sortKey),
              input.edge === 'top' ? asc(userPins.id) : desc(userPins.id),
            )
            .limit(1);
          return edge ? edge.sortKey + (input.edge === 'top' ? -SORT_GAP : SORT_GAP) : 0n;
        }

        const before = await rowFor(input.beforePinId);
        const after = await rowFor(input.afterPinId);
        if (before && after) {
          if (after.sortKey >= before.sortKey) return false;
          const midpoint = (after.sortKey + before.sortKey) / 2n;
          return midpoint === before.sortKey || midpoint === after.sortKey ? null : midpoint;
        }
        if (before) {
          const [previous] = await tx
            .select({ sortKey: userPins.sortKey })
            .from(userPins)
            .where(
              and(
                base,
                sql`${userPins.id} <> ${input.pinId}`,
                lt(userPins.sortKey, before.sortKey),
              ),
            )
            .orderBy(desc(userPins.sortKey), desc(userPins.id))
            .limit(1);
          const midpoint = previous
            ? (previous.sortKey + before.sortKey) / 2n
            : before.sortKey - SORT_GAP;
          return previous?.sortKey === midpoint ? null : midpoint;
        }
        if (after) {
          const [following] = await tx
            .select({ sortKey: userPins.sortKey })
            .from(userPins)
            .where(
              and(base, sql`${userPins.id} <> ${input.pinId}`, gt(userPins.sortKey, after.sortKey)),
            )
            .orderBy(asc(userPins.sortKey), asc(userPins.id))
            .limit(1);
          const midpoint = following
            ? (after.sortKey + following.sortKey) / 2n
            : after.sortKey + SORT_GAP;
          return following && midpoint === after.sortKey ? null : midpoint;
        }
        return false;
      }

      let nextSort = await calculateSortKey();
      if (nextSort === false) return false;

      if (nextSort === null) {
        await rebalancePins(tx, scope);
        nextSort = await calculateSortKey();
        if (nextSort === null || nextSort === false) return false;
      }
      await tx
        .update(userPins)
        .set({ sortKey: nextSort, updatedAt: new Date() })
        .where(and(base, eq(userPins.id, input.pinId)));
      return true;
    });
  }

  async function deleteForTarget(ref: PinTargetRef): Promise<number> {
    assertRef(ref);
    const normalized = normalizeRef(ref);
    const deleted = await db
      .delete(userPins)
      .where(
        and(
          eq(userPins.teamId, scope.teamId),
          eq(userPins.targetKind, normalized.kind),
          eq(userPins.targetKey, normalized.key),
        ),
      )
      .returning({ id: userPins.id });
    return deleted.length;
  }

  async function pruneDeletedTimelineMomentPins(limit = 100): Promise<number> {
    const pageSize = Math.min(Math.max(limit, 1), 500);
    const timezone = await getTimezone();
    let deleted = 0;
    let afterKey: string | null = null;
    for (;;) {
      const rows = await db
        .select({ key: userPins.targetKey })
        .from(userPins)
        .where(
          and(
            eq(userPins.teamId, scope.teamId),
            eq(userPins.targetKind, 'timeline_moment'),
            afterKey ? gt(userPins.targetKey, afterKey) : undefined,
          ),
        )
        .groupBy(userPins.targetKey)
        .orderBy(asc(userPins.targetKey))
        .limit(pageSize);
      for (const row of rows) {
        const plan = timelineMomentLookupPlan(row.key);
        if (!plan) continue;
        const events = await listTeamEventsForMomentLookup(plan);
        const stillExists = buildTimelineMoments(events, new Map(), { timezone }).some(
          (moment) => moment.id === row.key,
        );
        if (!stillExists) {
          deleted += await deleteForTarget({ kind: 'timeline_moment', key: row.key });
        }
      }
      if (rows.length < pageSize) return deleted;
      afterKey = rows.at(-1)?.key ?? null;
      if (!afterKey) return deleted;
    }
  }

  return {
    pin,
    unpin,
    isPinned,
    isPinnedMany,
    list,
    move,
    resolveTarget,
    resolvePin,
    deleteForTarget,
    pruneDeletedTimelineMomentPins,
  };
}

export type PinScope = ReturnType<typeof createPinScope>;
