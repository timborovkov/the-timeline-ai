'use server';

import { entities, factEntities, facts as factsTable, rawEvents, teamMembers } from '@timeline/db';
import { withTeam } from '@timeline/shared';
import { and, asc, eq, exists, isNull, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidSchema = z.string().regex(UUID_RE, 'Invalid id');

interface MergeEntityState {
  error?: string;
  ok?: boolean;
}

/**
 * Merge two entities for the active team. `loserId` is folded into `winnerId`:
 *   - all fact_entities rows referencing the loser are rewritten to the winner
 *     (on-conflict-do-nothing handles role collisions);
 *   - the loser's canonical name and aliases become aliases on the winner;
 *   - the loser row is soft-deleted by setting `merged_into_id = winnerId`.
 *
 * Admin-only. Mirrors the transaction-with-admin-check pattern from
 * removeMemberAction.
 */
export async function mergeEntityAction(
  _prev: MergeEntityState,
  formData: FormData,
): Promise<MergeEntityState> {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' };

  const loserParse = uuidSchema.safeParse(formData.get('loserId'));
  const winnerParse = uuidSchema.safeParse(formData.get('winnerId'));
  if (!loserParse.success || !winnerParse.success) {
    return { error: 'Invalid entity ids' };
  }
  if (loserParse.data === winnerParse.data) {
    return { error: 'Cannot merge an entity into itself' };
  }

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership('admin');

  try {
    await db.transaction(async (tx) => {
      // Re-check admin role inside the tx so a role revocation between the
      // outer check and the destructive write closes the TOCTOU window.
      const memberRows = await tx
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.userId, session.user.id)))
        .limit(1);
      const role = memberRows[0]?.role;
      if (role !== 'admin' && role !== 'owner') throw new Error('not_admin');

      // SELECT ... FOR UPDATE ordered by id. Concurrent A→B and B→A merges
      // would otherwise both pass the `mergedIntoId IS NULL` check and write
      // a cycle. Ordering the lock acquisition by id forces deterministic
      // serialisation; the second tx blocks and observes the first commit.
      const rows = await tx
        .select({
          id: entities.id,
          teamId: entities.teamId,
          canonicalName: entities.canonicalName,
          aliases: entities.aliases,
          mergedIntoId: entities.mergedIntoId,
        })
        .from(entities)
        .where(
          and(
            eq(entities.teamId, active.teamId),
            sql`${entities.id} IN (${loserParse.data}::uuid, ${winnerParse.data}::uuid)`,
          ),
        )
        .orderBy(asc(entities.id))
        .for('update');
      const winner = rows.find((r) => r.id === winnerParse.data);
      const loser = rows.find((r) => r.id === loserParse.data);
      if (!winner || !loser) throw new Error('not_found');
      if (winner.mergedIntoId || loser.mergedIntoId) throw new Error('already_merged');

      // Move fact_entities to the winner. The (fact_id, entity_id, role)
      // composite PK can collide when the winner is already referenced from
      // the same fact in the same role — skip those (UPDATE NOT EXISTS) and
      // drop the remaining loser rows.
      await tx.execute(sql`
        UPDATE ${factEntities} AS fe
        SET entity_id = ${winnerParse.data}::uuid
        WHERE fe.entity_id = ${loserParse.data}::uuid
          AND NOT EXISTS (
            SELECT 1 FROM ${factEntities} fe2
            WHERE fe2.fact_id = fe.fact_id
              AND fe2.entity_id = ${winnerParse.data}::uuid
              AND fe2.role = fe.role
          )
      `);
      await tx.delete(factEntities).where(eq(factEntities.entityId, loserParse.data));

      const existingAliases = Array.isArray(winner.aliases)
        ? (winner.aliases as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      const incomingAliases = Array.isArray(loser.aliases)
        ? (loser.aliases as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      const candidate = [loser.canonicalName, ...incomingAliases];
      const merged = [...existingAliases];
      for (const a of candidate) {
        if (!merged.some((e) => e.toLowerCase() === a.toLowerCase())) merged.push(a);
      }

      await tx
        .update(entities)
        .set({ aliases: merged, updatedAt: new Date() })
        .where(eq(entities.id, winnerParse.data));

      await tx
        .update(entities)
        .set({ mergedIntoId: winnerParse.data, updatedAt: new Date() })
        .where(eq(entities.id, loserParse.data));
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'not_found') {
      return { error: 'Entity not found' };
    }
    if (err instanceof Error && err.message === 'already_merged') {
      return { error: 'One of these entities has already been merged' };
    }
    if (err instanceof Error && err.message === 'not_admin') {
      return { error: 'Admin role required' };
    }
    throw err;
  }

  revalidatePath('/app/entities');
  revalidatePath(`/app/entities/${winnerParse.data}`);
  return { ok: true };
}

/**
 * Server action backing the merge typeahead: returns up to `limit` candidate
 * entities for the active team whose canonical name matches the query. Excludes
 * the current entity and any already-merged rows.
 */
export async function searchEntitiesAction(input: {
  query: string;
  excludeId: string;
  limit?: number;
}): Promise<{ id: string; canonicalName: string; type: string }[]> {
  const session = await auth();
  if (!session?.user) return [];
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return [];

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const q = input.query.trim().toLowerCase();
  if (q.length === 0) return [];
  const excludeOk = UUID_RE.test(input.excludeId);
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);

  const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  // Visibility-aware: the merge typeahead only surfaces entities backed by
  // at least one fact whose raw_event the caller can see. Mirrors the
  // /app/entities index filter so private-only entities (legacy or via
  // future bypass) never appear in admin merge search.
  const visibleEntityCondition = exists(
    db
      .select({ one: sql<number>`1` })
      .from(factEntities)
      .innerJoin(factsTable, eq(factsTable.id, factEntities.factId))
      .innerJoin(rawEvents, eq(rawEvents.id, factsTable.rawEventId))
      .where(
        and(
          eq(factEntities.entityId, entities.id),
          eq(rawEvents.teamId, active.teamId),
          or(
            eq(rawEvents.visibility, 'team'),
            and(eq(rawEvents.visibility, 'private'), eq(rawEvents.authorUserId, session.user.id)),
            and(
              eq(rawEvents.visibility, 'specific_users'),
              sql`${session.user.id}::uuid = ANY(${rawEvents.visibilityUserIds})`,
            ),
          ),
        ),
      ),
  );
  const rows = await db
    .select({
      id: entities.id,
      canonicalName: entities.canonicalName,
      type: entities.type,
    })
    .from(entities)
    .where(
      and(
        eq(entities.teamId, active.teamId),
        isNull(entities.mergedIntoId),
        excludeOk ? sql`${entities.id} <> ${input.excludeId}::uuid` : sql`true`,
        sql`lower(${entities.canonicalName}) LIKE ${pattern} ESCAPE '\\'`,
        visibleEntityCondition,
      ),
    )
    .limit(limit);
  return rows;
}
