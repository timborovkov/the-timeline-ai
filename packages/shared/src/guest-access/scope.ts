import { createHash, randomBytes } from 'node:crypto';

import {
  type Db,
  entities,
  guestInvitations,
  guestRecordShares,
  guestSourceGrants,
  rawEvents,
  reconciliationOutputs,
  teamMembers,
  users,
} from '@timeline/db';
import {
  and,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  notExists,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { askSharedWork, type GuestEvidenceRef } from '#src/guest-access/ask.js';
import { assertActivePrincipal, operatorContext } from '#src/platform-admin/runtime.js';
import { rawEventIsActive } from '#src/visibility.js';

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function shareableNote() {
  return and(
    eq(rawEvents.visibility, 'team'),
    eq(rawEvents.source, 'web'),
    sql`${rawEvents.sourceMetadata} ->> 'source_snapshot_kind' = 'web_text_capture'`,
    sql`${rawEvents.sourceMetadata} -> 'source_snapshot' ->> 'content_text' = ${rawEvents.contentText}`,
    sql`NOT (${rawEvents.sourceMetadata} ?| ARRAY['websiteId', 'websiteScanId', 'pageUrl'])`,
    isNotNull(rawEvents.authorUserId),
    isNotNull(rawEvents.contentText),
    isNull(rawEvents.contentAudioUrl),
    rawEventIsActive(),
  );
}

function shareableRecord() {
  return and(
    inArray(entities.type, ['project', 'task']),
    isNull(entities.archivedAt),
    isNull(entities.mergedIntoId),
  );
}

// A grant opens the record, not its source graph. Exact current values need
// matching, still team-visible provenance from a direct edit or accepted proposal.
function humanRecordField(field: string, createKey: string, value: SQL) {
  const metadata = rawEvents.sourceMetadata;
  const snapshot = sql`${metadata} -> 'source_snapshot'`;
  return sql`EXISTS (
    SELECT 1 FROM ${rawEvents}
    WHERE ${rawEvents.teamId} = ${entities.teamId}
      AND ${metadata} ->> 'entity_id' = ${entities.id}::text
      AND ${metadata} ->> 'source_snapshot_kind' = 'system_direct_write_event'
      AND ${rawEvents.source} = 'system'
      AND ${rawEvents.visibility} = 'team'
      AND ${rawEventIsActive()}
      AND ${snapshot} ->> 'entity_id' = ${entities.id}::text
      AND ${snapshot} ->> 'raw_event_id' = ${rawEvents.id}::text
      AND ${snapshot} ->> 'actor_kind' = 'user'
      AND ${snapshot} ->> 'actor_user_id' = ${rawEvents.authorUserId}::text
      AND (
        (${snapshot} ->> 'event_kind' = 'object_create' AND ${snapshot} -> ${createKey} = to_jsonb(${value}))
        OR (${snapshot} ->> 'event_kind' = 'object_update'
          AND ${snapshot} -> 'changes' @> jsonb_build_array(jsonb_build_object('field', ${field}::text, 'newValue', to_jsonb(${value}))))
      )
  )`;
}

function appliedRecordField(field: string, value: SQL) {
  const output = reconciliationOutputs;
  const refs = sql`CASE WHEN jsonb_typeof(${output.sourceRefs}) = 'array' THEN ${output.sourceRefs} ELSE '[]'::jsonb END`;
  const proposed = sql`${output.payload} -> 'proposed_payload' -> ${field}`;
  const dateOnly =
    field === 'dueAt'
      ? sql`OR (right(${value}, 14) = 'T00:00:00.000Z' AND ${proposed} = to_jsonb(left(${value}, 10)))`
      : sql.empty();
  return sql`EXISTS (
    SELECT 1 FROM ${output}
    WHERE ${output.teamId} = ${entities.teamId}
      AND COALESCE(${output.payload} ->> 'projection_result_id', ${output.targetId}::text) = ${entities.id}::text
      AND ${output.outputKind} = 'approval_bundle'
      AND ${output.operation} IN ('create', 'update')
      AND ${output.targetKind} IN ('task', 'object')
      AND ${output.status} = 'applied'
      AND ${output.visibility} = 'team'
      AND ${output.visibilityFloor} = 'team'
      AND (${proposed} = to_jsonb(${value}) ${dateOnly})
      AND jsonb_array_length(${refs}) > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(${refs}) AS source_ref
        WHERE NOT EXISTS (
          SELECT 1 FROM ${rawEvents}
          WHERE ${rawEvents.teamId} = ${output.teamId}
            AND ${rawEvents.id} = CASE
              WHEN (source_ref ->> 'rawEventId') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
              THEN (source_ref ->> 'rawEventId')::uuid END
            AND ${rawEvents.visibility} = 'team'
            AND ${rawEventIsActive()}
        )
      )
  )`;
}

function visibleRecordField(field: string, createKey: string, value: SQL) {
  return sql`CASE WHEN (${humanRecordField(field, createKey, value)}
    OR ${appliedRecordField(field, value)}) THEN ${value} END`;
}

const EVIDENCE_LIMIT = 12;

export function createGuestAccessScope(
  db: Db,
  teamId: string,
  userId: string,
  requireAdmin: () => Promise<unknown>,
) {
  function fullMembership() {
    return db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, userId),
          isNull(teamMembers.removedAt),
        ),
      );
  }

  async function requireRealPrincipal() {
    if (await operatorContext()) throw new Error('Guest access requires the real account');
    await assertActivePrincipal(db, teamId, userId);
  }

  async function requireManager() {
    await requireRealPrincipal();
    await requireAdmin();
  }

  async function readSources(ids?: string[], query?: string, limit = 100) {
    if (ids?.length === 0) return [];
    return db
      .select({
        id: rawEvents.id,
        contentText: rawEvents.contentText,
        occurredAt: rawEvents.occurredAt,
        revision: guestSourceGrants.revision,
      })
      .from(rawEvents)
      .innerJoin(
        guestSourceGrants,
        and(
          eq(rawEvents.teamId, guestSourceGrants.teamId),
          eq(rawEvents.id, guestSourceGrants.rawEventId),
        ),
      )
      .innerJoin(
        guestInvitations,
        and(
          eq(guestInvitations.teamId, guestSourceGrants.teamId),
          eq(guestInvitations.id, guestSourceGrants.invitationId),
        ),
      )
      .where(
        and(
          eq(rawEvents.teamId, teamId),
          eq(guestInvitations.acceptedByUserId, userId),
          isNull(guestInvitations.revokedAt),
          notExists(fullMembership()),
          shareableNote(),
          ids ? inArray(rawEvents.id, ids) : undefined,
          query ? sql`strpos(lower(${rawEvents.contentText}), lower(${query})) > 0` : undefined,
        ),
      )
      .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
      .limit(limit);
  }

  async function readRecords(ids?: string[], query?: string, limit = 100) {
    if (ids?.length === 0) return [];
    const liveTitle = visibleRecordField(
      'canonicalName',
      'canonical_name',
      sql`${entities.canonicalName}`,
    );
    const title = sql<string>`CASE WHEN ${guestRecordShares.live}
      THEN COALESCE(${liveTitle}, CASE WHEN ${entities.type} = 'task' THEN 'Shared task' ELSE 'Shared project' END)
      ELSE ${guestRecordShares.title} END`;
    const body = sql<
      string | null
    >`CASE WHEN NOT ${guestRecordShares.live} THEN ${guestRecordShares.body} END`;
    const status = visibleRecordField('status', 'status', sql`${entities.status}`);
    const dueDate = visibleRecordField(
      'dueAt',
      'due_at',
      sql`to_char(${entities.dueAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    );
    return db
      .select({
        id: guestRecordShares.recordId,
        live: guestRecordShares.live,
        type: entities.type,
        title,
        body,
        status: sql<string | null>`CASE WHEN ${guestRecordShares.live} THEN ${status} END`,
        dueDate: sql<string | null>`CASE WHEN ${guestRecordShares.live} THEN ${dueDate} END`,
        revision: guestRecordShares.revision,
        publishedAt: guestRecordShares.publishedAt,
      })
      .from(guestRecordShares)
      .innerJoin(
        guestInvitations,
        and(
          eq(guestInvitations.teamId, guestRecordShares.teamId),
          eq(guestInvitations.id, guestRecordShares.invitationId),
        ),
      )
      .innerJoin(
        entities,
        and(
          eq(entities.teamId, guestRecordShares.teamId),
          eq(entities.id, guestRecordShares.recordId),
        ),
      )
      .where(
        and(
          eq(guestRecordShares.teamId, teamId),
          eq(guestInvitations.acceptedByUserId, userId),
          isNull(guestInvitations.revokedAt),
          notExists(fullMembership()),
          shareableRecord(),
          ids ? inArray(guestRecordShares.recordId, ids) : undefined,
          query
            ? sql`strpos(lower(concat_ws(' ', ${title}, ${body})), lower(${query})) > 0`
            : undefined,
        ),
      )
      .orderBy(desc(guestRecordShares.publishedAt), desc(guestRecordShares.recordId))
      .limit(limit);
  }

  async function lockShareableInvite(tx: Pick<Db, 'select'>, invitationId: string) {
    const [invite] = await tx
      .select({ id: guestInvitations.id })
      .from(guestInvitations)
      .where(
        and(
          eq(guestInvitations.teamId, teamId),
          eq(guestInvitations.id, invitationId),
          isNull(guestInvitations.revokedAt),
          or(
            isNotNull(guestInvitations.acceptedByUserId),
            gt(guestInvitations.expiresAt, new Date()),
          ),
        ),
      )
      .for('update');
    return invite;
  }

  async function saveRecordShare(
    invitationId: string,
    recordId: string,
    content: { live: boolean; title: string | null; body: string | null },
  ) {
    return db.transaction(async (tx) => {
      if (!(await lockShareableInvite(tx, invitationId))) return false;
      const [record] = await tx
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.teamId, teamId), eq(entities.id, recordId), shareableRecord()))
        .for('share');
      if (!record) return false;
      const share = { ...content, publishedByUserId: userId };
      await tx
        .insert(guestRecordShares)
        .values({ teamId, invitationId, recordId, ...share })
        .onConflictDoUpdate({
          target: [
            guestRecordShares.teamId,
            guestRecordShares.invitationId,
            guestRecordShares.recordId,
          ],
          set: { ...share, revision: sql`gen_random_uuid()`, publishedAt: new Date() },
        });
      return true;
    });
  }

  return {
    async settings(workQuery?: string) {
      await requireManager();
      const query = workQuery?.trim().slice(0, 200);
      const [invites, notes, grants, records, recordShares] = await Promise.all([
        db
          .select({
            id: guestInvitations.id,
            email: guestInvitations.email,
            expired: sql<boolean>`${guestInvitations.expiresAt} <= now()`,
            acceptedByUserId: guestInvitations.acceptedByUserId,
          })
          .from(guestInvitations)
          .where(and(eq(guestInvitations.teamId, teamId), isNull(guestInvitations.revokedAt)))
          .orderBy(desc(guestInvitations.createdAt)),
        db
          .select({
            id: rawEvents.id,
            preview: sql<string>`left(${rawEvents.contentText}, 110)`,
          })
          .from(rawEvents)
          .where(
            and(
              eq(rawEvents.teamId, teamId),
              shareableNote(),
              query ? sql`strpos(lower(${rawEvents.contentText}), lower(${query})) > 0` : undefined,
            ),
          )
          .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
          .limit(100),
        db
          .select({
            invitationId: guestSourceGrants.invitationId,
            sourceId: guestSourceGrants.rawEventId,
            preview: sql<string>`left(${rawEvents.contentText}, 110)`,
          })
          .from(guestSourceGrants)
          .innerJoin(
            rawEvents,
            and(
              eq(rawEvents.teamId, guestSourceGrants.teamId),
              eq(rawEvents.id, guestSourceGrants.rawEventId),
            ),
          )
          .where(and(eq(guestSourceGrants.teamId, teamId), shareableNote())),
        db
          .select({ id: entities.id, name: entities.canonicalName, type: entities.type })
          .from(entities)
          .where(
            and(
              eq(entities.teamId, teamId),
              shareableRecord(),
              query
                ? sql`strpos(lower(${entities.canonicalName}), lower(${query})) > 0`
                : undefined,
            ),
          )
          .orderBy(desc(entities.updatedAt), desc(entities.id))
          .limit(100),
        db
          .select({
            invitationId: guestRecordShares.invitationId,
            recordId: guestRecordShares.recordId,
            live: guestRecordShares.live,
            title: sql<string>`COALESCE(${guestRecordShares.title}, ${entities.canonicalName})`,
          })
          .from(guestRecordShares)
          .innerJoin(
            entities,
            and(
              eq(entities.teamId, guestRecordShares.teamId),
              eq(entities.id, guestRecordShares.recordId),
            ),
          )
          .where(eq(guestRecordShares.teamId, teamId)),
      ]);
      return { invites, notes, grants, records, recordShares };
    },

    async ask(question: string, selected?: GuestEvidenceRef) {
      const normalized = question.trim();
      if (!normalized || normalized.length > 2000) return null;
      return askSharedWork(db, teamId, userId, normalized, async (refs) => {
        await requireRealPrincipal();
        const selection = refs ?? (selected ? [selected] : undefined);
        const [notes, records] = await Promise.all([
          readSources(
            selection?.filter((ref) => ref.kind === 'note').map((ref) => ref.id),
            undefined,
            EVIDENCE_LIMIT,
          ),
          readRecords(
            selection?.filter((ref) => ref.kind === 'record').map((ref) => ref.id),
            undefined,
            EVIDENCE_LIMIT,
          ),
        ]);
        return [
          ...notes.flatMap((note) =>
            note.contentText
              ? [
                  {
                    kind: 'note' as const,
                    id: note.id,
                    content: note.contentText,
                    revision: note.revision,
                    time: note.occurredAt,
                  },
                ]
              : [],
          ),
          ...records.map((record) => ({
            kind: 'record' as const,
            id: record.id,
            content: record.live
              ? JSON.stringify({
                  view: 'live record',
                  type: record.type,
                  title: record.title,
                  status: record.status,
                  dueDate: record.dueDate,
                })
              : `Published snapshot\n${record.title}\n${record.body}`,
            revision: record.revision,
            time: record.publishedAt,
          })),
        ].sort((a, b) => b.time.getTime() - a.time.getTime());
      });
    },

    async publishRecord(invitationId: string, recordId: string, title: string, body: string) {
      await requireManager();
      const cleanTitle = title.trim();
      const cleanBody = body.trim();
      if (!cleanTitle || cleanTitle.length > 200 || !cleanBody || cleanBody.length > 8000)
        return false;
      return saveRecordShare(invitationId, recordId, {
        live: false,
        title: cleanTitle,
        body: cleanBody,
      });
    },

    async shareRecord(invitationId: string, recordId: string) {
      await requireManager();
      return saveRecordShare(invitationId, recordId, { live: true, title: null, body: null });
    },

    async unshareRecord(invitationId: string, recordId: string) {
      await requireManager();
      await db
        .delete(guestRecordShares)
        .where(
          and(
            eq(guestRecordShares.teamId, teamId),
            eq(guestRecordShares.invitationId, invitationId),
            eq(guestRecordShares.recordId, recordId),
          ),
        );
    },

    async invite(email: string) {
      await requireManager();
      const normalized = email.trim().toLowerCase();
      const token = randomBytes(32).toString('base64url');
      const now = new Date();
      const values = {
        email: normalized,
        invitedByUserId: userId,
        tokenHash: digest(token),
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        createdAt: now,
      };
      const [invite] = await db
        .insert(guestInvitations)
        .values({ ...values, teamId })
        .onConflictDoUpdate({
          target: [guestInvitations.teamId, guestInvitations.email],
          set: { ...values, revokedAt: null, acceptedByUserId: null },
          setWhere: sql`(${guestInvitations.revokedAt} IS NOT NULL OR ${guestInvitations.acceptedByUserId} IS NULL)`,
        })
        .returning({ id: guestInvitations.id });
      if (!invite) return null;
      return { id: invite.id, token };
    },

    async accept(token: string) {
      await requireRealPrincipal();
      const [row] = await db
        .update(guestInvitations)
        .set({ acceptedByUserId: userId })
        .where(
          and(
            eq(guestInvitations.teamId, teamId),
            eq(guestInvitations.tokenHash, digest(token)),
            isNull(guestInvitations.revokedAt),
            notExists(fullMembership()),
            or(
              eq(guestInvitations.acceptedByUserId, userId),
              and(
                isNull(guestInvitations.acceptedByUserId),
                gt(guestInvitations.expiresAt, new Date()),
                exists(
                  db
                    .select({ userId: teamMembers.userId })
                    .from(teamMembers)
                    .where(
                      and(
                        eq(teamMembers.teamId, teamId),
                        eq(teamMembers.userId, guestInvitations.invitedByUserId),
                        or(eq(teamMembers.role, 'owner'), eq(teamMembers.role, 'admin')),
                        isNull(teamMembers.removedAt),
                      ),
                    ),
                ),
                exists(
                  db
                    .select({ id: users.id })
                    .from(users)
                    .where(
                      and(
                        eq(users.id, userId),
                        isNotNull(users.emailVerified),
                        sql`lower(${users.email}) = ${guestInvitations.email}`,
                      ),
                    ),
                ),
              ),
            ),
          ),
        )
        .returning({ id: guestInvitations.id });
      return Boolean(row);
    },

    async revoke(invitationId: string) {
      await requireManager();
      await db.transaction(async (tx) => {
        await tx
          .update(guestInvitations)
          .set({ revokedAt: new Date() })
          .where(and(eq(guestInvitations.teamId, teamId), eq(guestInvitations.id, invitationId)));
        await tx
          .delete(guestSourceGrants)
          .where(
            and(
              eq(guestSourceGrants.teamId, teamId),
              eq(guestSourceGrants.invitationId, invitationId),
            ),
          );
      });
    },

    async shareSource(invitationId: string, sourceId: string) {
      await requireManager();
      return db.transaction(async (tx) => {
        if (!(await lockShareableInvite(tx, invitationId))) return false;
        const [source] = await tx
          .select({ id: rawEvents.id })
          .from(rawEvents)
          .where(and(eq(rawEvents.teamId, teamId), eq(rawEvents.id, sourceId), shareableNote()))
          .for('share');
        if (!source) return false;
        await tx
          .insert(guestSourceGrants)
          .values({
            teamId,
            invitationId,
            rawEventId: source.id,
            grantedByUserId: userId,
          })
          .onConflictDoNothing();
        return true;
      });
    },

    async unshareSource(invitationId: string, sourceId: string) {
      await requireManager();
      await db
        .delete(guestSourceGrants)
        .where(
          and(
            eq(guestSourceGrants.teamId, teamId),
            eq(guestSourceGrants.invitationId, invitationId),
            eq(guestSourceGrants.rawEventId, sourceId),
          ),
        );
    },

    async hasAccess() {
      await requireRealPrincipal();
      const [active] = await db
        .select({ id: guestInvitations.id })
        .from(guestInvitations)
        .where(
          and(
            eq(guestInvitations.teamId, teamId),
            eq(guestInvitations.acceptedByUserId, userId),
            isNull(guestInvitations.revokedAt),
            notExists(fullMembership()),
          ),
        )
        .limit(1);
      return Boolean(active);
    },

    async listSources(sourceId?: string, query?: string) {
      await requireRealPrincipal();
      return readSources(sourceId ? [sourceId] : undefined, query);
    },

    async listRecords(recordId?: string, query?: string) {
      await requireRealPrincipal();
      return readRecords(recordId ? [recordId] : undefined, query);
    },
  };
}
