import {
  type Db,
  agentSuggestions,
  reconciliationRuns,
  artifactClusters,
  conversationReviews,
  documentVersions,
  documents,
  objectNotes,
  objectChanges,
  entities,
  engineMaintenanceRuns,
  factEntities,
  facts,
  rawEvents,
  objectIdentityFacets,
} from '@timeline/db';
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { getBillingContext } from '#src/billing/context.js';
import {
  tombstoneObjectDueDateCalendarEventsForEntities,
  dispatchDueDateCalendarEffects,
} from '#src/calendar/due-dates.js';
import { embed } from '#src/llm/embed.js';
import { getQdrantClient } from '#src/qdrant/client.js';

import type { IdentityObject } from '#src/suggestions/identity-resolution.js';
import type { TeamScopeCore } from '#src/team-scope.js';

import { assertDevelopmentResetEnvironment } from '#src/suggestions/development-reset.js';
import { IDENTITY_POLICY_VERSION } from '#src/suggestions/identity-resolution.js';

export function createEngineMaintenanceScope(db: Db, scope: TeamScopeCore) {
  const team = eq(entities.teamId, scope.teamId);
  return {
    async resetInventory() {
      await scope.requireMembership();
      const objectRows = await db.select({ id: entities.id }).from(entities).where(team);
      const factRows = await db
        .select({ id: facts.id })
        .from(facts)
        .where(eq(facts.teamId, scope.teamId));
      const notes = await db
        .select({ id: objectNotes.id })
        .from(objectNotes)
        .where(eq(objectNotes.teamId, scope.teamId));
      const changes = await db
        .select({ id: objectChanges.id })
        .from(objectChanges)
        .where(eq(objectChanges.teamId, scope.teamId));
      return { objects: objectRows, facts: factRows, notes, changes };
    },
    async resetDerivedState(runId: string) {
      assertDevelopmentResetEnvironment(process.env);
      await scope.requireMembership();
      const calendarEffects = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.teamId}, 105))`);
        const objectIds = await tx.select({ id: entities.id }).from(entities).where(team);
        const calendarEffects = await tombstoneObjectDueDateCalendarEventsForEntities(tx, {
          teamId: scope.teamId,
          entityIds: objectIds.map((row) => row.id),
          includeBoardItems: true,
        });
        await tx.delete(agentSuggestions).where(eq(agentSuggestions.teamId, scope.teamId));
        await tx.delete(reconciliationRuns).where(eq(reconciliationRuns.teamId, scope.teamId));
        await tx.delete(artifactClusters).where(eq(artifactClusters.teamId, scope.teamId));
        await tx.delete(conversationReviews).where(eq(conversationReviews.teamId, scope.teamId));
        await tx.delete(facts).where(eq(facts.teamId, scope.teamId));
        // Delete merge descendants before survivors; never null their identities into uniqueness conflicts.
        await tx.execute(
          sql`DELETE FROM entities WHERE team_id = ${scope.teamId} AND merged_into_id IS NOT NULL`,
        );
        await tx.delete(entities).where(team);
        await tx
          .update(rawEvents)
          .set({
            sourceMetadata: sql`COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(${rawEvents.sourceMetadata}) WHERE key !~ '^(suggestion_|suggestions_|extraction_|extracted_at$|conversation_review_)'), '{}'::jsonb)`,
          })
          .where(eq(rawEvents.teamId, scope.teamId));
        await tx
          .delete(engineMaintenanceRuns)
          .where(
            and(
              eq(engineMaintenanceRuns.teamId, scope.teamId),
              sql`${engineMaintenanceRuns.id} <> ${runId}::uuid`,
            ),
          );
        await tx
          .update(engineMaintenanceRuns)
          .set({
            cursor: null,
            examined: 0,
            metadata: sql`${engineMaintenanceRuns.metadata} || '{"phase":"replay_events"}'::jsonb`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(engineMaintenanceRuns.teamId, scope.teamId),
              eq(engineMaintenanceRuns.id, runId),
            ),
          );
        return calendarEffects;
      });
      await dispatchDueDateCalendarEffects({ teamId: scope.teamId }, calendarEffects);
    },
    async replayEvents(cursor: string | null) {
      await scope.requireMembership();
      return db
        .select({ id: rawEvents.id, source: rawEvents.source })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.teamId, scope.teamId),
            eq(rawEvents.visibility, 'team'),
            sql`${rawEvents.source} <> 'system'`,
            sql`COALESCE(${rawEvents.sourceMetadata}->>'deleted','false') <> 'true'`,
            sql`${rawEvents.contentText} IS NOT NULL`,
            ...(cursor ? [gt(rawEvents.id, cursor)] : []),
          ),
        )
        .orderBy(asc(rawEvents.id))
        .limit(100);
    },
    async replayDocuments() {
      await scope.requireMembership();
      return db
        .select({ id: documentVersions.id })
        .from(documentVersions)
        .innerJoin(documents, eq(documents.currentVersionId, documentVersions.id))
        .where(
          and(
            eq(documents.teamId, scope.teamId),
            isNull(documents.deletedAt),
            eq(documents.visibility, 'team'),
            eq(documents.fileKind, 'document'),
          ),
        );
    },
    async latestRuns() {
      await scope.requireMembership();
      const recent = await db
        .select()
        .from(engineMaintenanceRuns)
        .where(eq(engineMaintenanceRuns.teamId, scope.teamId))
        .orderBy(desc(engineMaintenanceRuns.startedAt))
        .limit(10);
      const [lastSuccess] = await db
        .select()
        .from(engineMaintenanceRuns)
        .where(
          and(
            eq(engineMaintenanceRuns.teamId, scope.teamId),
            eq(engineMaintenanceRuns.kind, 'cleanup'),
            eq(engineMaintenanceRuns.status, 'completed'),
          ),
        )
        .orderBy(desc(engineMaintenanceRuns.completedAt))
        .limit(1);
      return lastSuccess && !recent.some((run) => run.id === lastSuccess.id)
        ? [...recent, lastSuccess]
        : recent;
    },
    async beginCleanup(kind = 'cleanup') {
      await scope.requireMembership();
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.teamId}, 105))`);
        const [existing] = await tx
          .select()
          .from(engineMaintenanceRuns)
          .where(
            and(
              eq(engineMaintenanceRuns.teamId, scope.teamId),
              eq(engineMaintenanceRuns.kind, kind),
              inArray(
                engineMaintenanceRuns.status,
                kind.startsWith('document:')
                  ? ['running', 'paused', 'failed', 'completed']
                  : ['running', 'paused', 'failed'],
              ),
            ),
          )
          .limit(1);
        if (existing) return existing;
        const [coverage] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(entities)
          .where(and(team, isNull(entities.mergedIntoId)));
        const [created] = await tx
          .insert(engineMaintenanceRuns)
          .values({
            teamId: scope.teamId,
            kind,
            engineVersion: IDENTITY_POLICY_VERSION,
            metadata: kind === 'cleanup' ? { totalObjects: coverage?.total ?? 0 } : {},
          })
          .returning();
        if (!created) throw new Error('Could not create maintenance run');
        return created;
      });
    },
    async claimRun(id: string) {
      await scope.requireMembership();
      const token = crypto.randomUUID();
      const [claimed] = await db
        .update(engineMaintenanceRuns)
        .set({ leaseOwner: token, leaseExpiresAt: new Date(Date.now() + 300_000) })
        .where(
          and(
            eq(engineMaintenanceRuns.teamId, scope.teamId),
            eq(engineMaintenanceRuns.id, id),
            or(
              isNull(engineMaintenanceRuns.leaseOwner),
              sql`${engineMaintenanceRuns.leaseExpiresAt} < now()`,
            ),
          ),
        )
        .returning({ id: engineMaintenanceRuns.id });
      return claimed ? token : null;
    },
    async renewRun(id: string, token: string) {
      await scope.requireMembership();
      const [renewed] = await db
        .update(engineMaintenanceRuns)
        .set({ leaseExpiresAt: new Date(Date.now() + 300_000) })
        .where(
          and(
            eq(engineMaintenanceRuns.teamId, scope.teamId),
            eq(engineMaintenanceRuns.id, id),
            eq(engineMaintenanceRuns.leaseOwner, token),
          ),
        )
        .returning({ id: engineMaintenanceRuns.id });
      if (!renewed) throw new Error('Maintenance lease lost');
    },
    async releaseRun(id: string, token: string) {
      await scope.requireMembership();
      await db
        .update(engineMaintenanceRuns)
        .set({ leaseOwner: null, leaseExpiresAt: null })
        .where(
          and(
            eq(engineMaintenanceRuns.teamId, scope.teamId),
            eq(engineMaintenanceRuns.id, id),
            eq(engineMaintenanceRuns.leaseOwner, token),
          ),
        );
    },
    async checkpoint(
      id: string,
      input: {
        cursor?: string;
        examined?: number;
        status: string;
        metadata?: Record<string, unknown>;
      },
      token?: string,
    ) {
      await scope.requireMembership();
      const [counts] = await db
        .select({
          proposals: sql<number>`count(*)::int`,
          rejected: sql<number>`count(*) FILTER (WHERE ${agentSuggestions.status} = 'rejected')::int`,
        })
        .from(agentSuggestions)
        .where(
          and(
            eq(agentSuggestions.teamId, scope.teamId),
            sql`${agentSuggestions.metadata}->>'maintenance_run_id' = ${id}`,
          ),
        );
      const billing = getBillingContext();
      const operationId = billing?.teamId === scope.teamId ? billing.operationId : undefined;
      const usageMetadata = operationId
        ? sql`jsonb_build_object('billingOperationIds', (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(COALESCE(${engineMaintenanceRuns.metadata}->'billingOperationIds', '[]'::jsonb) || ${JSON.stringify([operationId])}::jsonb)))`
        : sql`'{}'::jsonb`;
      const changed = await db
        .update(engineMaintenanceRuns)
        .set({
          ...input,
          metadata: sql`${engineMaintenanceRuns.metadata} || ${JSON.stringify({ ...input.metadata, proposalCount: counts?.proposals ?? 0, rejectedProposalCount: counts?.rejected ?? 0 })}::jsonb || ${usageMetadata}`,
          updatedAt: new Date(),
          ...(token ? { leaseExpiresAt: new Date(Date.now() + 300_000) } : {}),
          ...(input.status === 'completed' ? { completedAt: new Date() } : {}),
        })
        .where(
          and(
            eq(engineMaintenanceRuns.teamId, scope.teamId),
            eq(engineMaintenanceRuns.id, id),
            token
              ? eq(engineMaintenanceRuns.leaseOwner, token)
              : isNull(engineMaintenanceRuns.leaseOwner),
          ),
        )
        .returning({ id: engineMaintenanceRuns.id });
      if (!changed.length) throw new Error('Maintenance lease lost');
    },
    async cleanupPage(cursor: string | null, cutoff: Date, limit = 25) {
      await scope.requireMembership();
      return db
        .select()
        .from(entities)
        .where(
          and(
            team,
            isNull(entities.mergedIntoId),
            lte(entities.createdAt, cutoff),
            ...(cursor ? [gt(entities.id, cursor)] : []),
          ),
        )
        .orderBy(asc(entities.id))
        .limit(Math.min(limit, 100));
    },
    async identityCandidates(subject: IdentityObject, limit = 40) {
      await scope.requireMembership();
      const names = [
        subject.canonicalName,
        ...(Array.isArray(subject.aliases)
          ? subject.aliases.filter((v): v is string => typeof v === 'string')
          : []),
      ];
      const conditions = names
        .slice(0, 12)
        .map(
          (name) =>
            sql`(lower(${entities.canonicalName}) = lower(${name}) OR ${entities.aliases} @> ${JSON.stringify([name])}::jsonb)`,
        );
      // Exact candidates first, then contextual candidates. A full result is explicitly bounded.
      const exact = await db
        .select()
        .from(entities)
        .where(
          and(
            team,
            isNull(entities.mergedIntoId),
            eq(entities.type, subject.type as typeof entities.$inferSelect.type),
            or(...conditions),
          ),
        )
        .limit(limit);
      const contextual = await db
        .select()
        .from(entities)
        .where(
          and(
            team,
            isNull(entities.mergedIntoId),
            eq(entities.type, subject.type as typeof entities.$inferSelect.type),
            sql`${entities.id} <> ${subject.id === 'candidate' ? '00000000-0000-0000-0000-000000000000' : subject.id}::uuid`,
            or(
              sql`${entities.metadata} ->> 'companyId' IS NOT NULL AND ${entities.metadata} ->> 'companyId' = ${typeof (subject.metadata as Record<string, unknown> | undefined)?.companyId === 'string' ? (subject.metadata as Record<string, string>).companyId : null}`,
              sql`EXISTS (SELECT 1 FROM fact_entities a JOIN fact_entities b ON a.fact_id = b.fact_id WHERE a.entity_id = ${subject.id === 'candidate' ? '00000000-0000-0000-0000-000000000000' : subject.id}::uuid AND b.entity_id = ${entities.id})`,
            ),
          ),
        )
        .orderBy(desc(entities.updatedAt))
        .limit(limit);
      return [...new Map([...exact, ...contextual].map((row) => [row.id, row])).values()].slice(
        0,
        limit,
      );
    },
    async semanticCandidates(query: string) {
      await scope.requireMembership();
      const vector = await embed({ text: query.slice(0, 6000) });
      const hits = await getQdrantClient().search(scope.teamId, scope.userId, vector.vector, {
        sourceKind: ['object', 'entity'],
        limit: 20,
      });
      const ids = hits
        .map((hit) => hit.payload.object_id ?? hit.payload.entity_id)
        .filter((id): id is string => Boolean(id));
      if (!ids.length) return [];
      return db
        .select()
        .from(entities)
        .where(and(team, isNull(entities.mergedIntoId), inArray(entities.id, ids)));
    },
    async humanEditedFields(objectId: string) {
      await scope.requireMembership();
      return db
        .select({ field: objectChanges.field })
        .from(objectChanges)
        .where(
          and(
            eq(objectChanges.teamId, scope.teamId),
            eq(objectChanges.entityId, objectId),
            eq(objectChanges.actorKind, 'user'),
            eq(objectChanges.status, 'applied'),
          ),
        );
    },
    async identityEvidence(objectIds: string[]) {
      await scope.requireMembership();
      if (!objectIds.length) return [];
      const evidence = await db
        .selectDistinct({
          objectId: factEntities.entityId,
          rawEventId: rawEvents.id,
          text: rawEvents.contentText,
          occurredAt: rawEvents.occurredAt,
        })
        .from(factEntities)
        .innerJoin(facts, eq(facts.id, factEntities.factId))
        .innerJoin(rawEvents, eq(rawEvents.id, facts.rawEventId))
        .where(
          and(
            eq(rawEvents.teamId, scope.teamId),
            eq(rawEvents.visibility, 'team'),
            sql`COALESCE(${rawEvents.sourceMetadata}->>'deleted','false') <> 'true'`,
            inArray(factEntities.entityId, objectIds),
          ),
        )
        .orderBy(desc(rawEvents.occurredAt))
        .limit(80);
      return evidence.flatMap((row) =>
        row.text?.trim()
          ? [{ objectId: row.objectId, rawEventId: row.rawEventId, text: row.text }]
          : [],
      );
    },
    async affiliationCandidates(objectId: string, proposedEmails: string[] = []) {
      await scope.requireMembership();
      const emails = await db
        .select({ value: objectIdentityFacets.normalizedValue })
        .from(objectIdentityFacets)
        .where(
          and(
            eq(objectIdentityFacets.teamId, scope.teamId),
            eq(objectIdentityFacets.entityId, objectId),
            eq(objectIdentityFacets.kind, 'email'),
            eq(objectIdentityFacets.status, 'approved'),
            isNull(objectIdentityFacets.archivedAt),
          ),
        );
      const values = [...emails.map((row) => row.value), ...proposedEmails];
      const domains = values
        .map((value) => value.split('@')[1])
        .filter((v): v is string => Boolean(v));
      if (!domains.length) return { emails: [], companies: [] };
      const companies = await db
        .select()
        .from(entities)
        .where(
          and(
            team,
            eq(entities.type, 'company'),
            isNull(entities.mergedIntoId),
            isNull(entities.archivedAt),
            or(
              ...domains.map(
                (domain) =>
                  sql`lower(${entities.metadata}->>'domain') = ${domain} OR lower(${entities.metadata}->>'website') IN (${`https://${domain}`},${`https://${domain}/`},${`https://www.${domain}`})`,
              ),
            ),
          ),
        )
        .limit(100);
      return { emails: values, companies };
    },
  };
}
