import { PGlite } from '@electric-sql/pglite';
import {
  type Db,
  entities,
  teams,
  users,
  teamMembers,
  documents,
  documentVersions,
  documentChunks,
  rawEvents,
  agentSuggestionItems,
  objectIdentityFacets,
  entityRelationships,
} from '@timeline/db';
import { withTeam, llm, qdrant } from '@timeline/shared';
import { closeAllRedisConnections } from '@timeline/shared/redis';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { applyDbMigrations } from '#src/test/pglite.js';
import { processSuggestionJobForTests } from '#src/workers/suggestions.js';

// Live models, persisted approvals, real Redis and Qdrant; synthetic isolated teams only.
const meteredChat: typeof llm.chatStructured = async (input) => {
  const result = await llm.chatStructured(input);
  console.log(
    JSON.stringify({
      evaluationUsage: 'document_pipeline',
      model: result.model,
      openRouterUsd: result.openRouterUsd ?? null,
    }),
  );
  return result;
};
const live = process.env.ENGINE_END_TO_END_LIVE_EVAL === '1' ? describe : describe.skip;
live('prelaunch engine end-to-end', () => {
  let pg: PGlite, db: Db;
  const createdTeams: string[] = [];
  beforeAll(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg) as unknown as Db;
  });
  afterAll(async () => {
    for (const teamId of createdTeams) await qdrant.getQdrantClient().deleteTeamPoints(teamId);
    await pg.close();
    await closeAllRedisConnections();
  });
  for (let repeat = 0; repeat < 3; repeat++)
    it(`document client list yields approved company, person and affiliation (${repeat + 1})`, async () => {
      const teamId = crypto.randomUUID(),
        userId = crypto.randomUUID();
      createdTeams.push(teamId);
      await db
        .insert(teams)
        .values({ id: teamId, slug: `engine-${teamId}`, name: 'Synthetic engine evaluation' });
      await db.insert(users).values({ id: userId, email: `${userId}@example.test`, name: 'Owner' });
      await db.insert(teamMembers).values({ teamId, userId, role: 'owner' });
      const [company] = await db
        .insert(entities)
        .values({
          teamId,
          type: 'company',
          canonicalName: 'Northstar Audit',
          status: 'active',
          metadata: { domain: 'northstar-audit.test' },
        })
        .returning();
      const text =
        'Client contact list, confirmed 12 November 2026. Company: Northstar Audit. Company business domain: northstar-audit.test. Contact: Mara Linden, Head of Audit, email mara@northstar-audit.test. Mara works at Northstar Audit. This is a contact record, not a task.';
      const [event] = await db
        .insert(rawEvents)
        .values({
          teamId,
          source: 'document',
          contentText: 'Uploaded client list.csv',
          visibility: 'team',
          authorUserId: userId,
          occurredAt: new Date(),
        })
        .returning();
      const [doc] = await db
        .insert(documents)
        .values({ teamId, name: 'client list.csv', ownerUserId: userId, visibility: 'team' })
        .returning();
      const [version] = await db
        .insert(documentVersions)
        .values({
          teamId,
          documentId: required(doc).id,
          version: 1,
          objectKey: `synthetic/${teamId}/clients.csv`,
          sourceEventId: required(event).id,
          processingStatus: 'chunked',
        })
        .returning();
      await db
        .update(documents)
        .set({ currentVersionId: required(version).id })
        .where(eq(documents.id, required(doc).id));
      await db.insert(documentChunks).values({
        teamId,
        documentId: required(doc).id,
        documentVersionId: required(version).id,
        chunkIndex: 0,
        text,
        tokenCount: 70,
      });
      const job = { scope: 'document' as const, teamId, documentVersionId: required(version).id };
      await processSuggestionJobForTests({ db }, job, { chatStructured: meteredChat });
      const items = await db
        .select()
        .from(agentSuggestionItems)
        .where(eq(agentSuggestionItems.teamId, teamId));
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((item) => item.targetKind === 'identity_facet')).toBe(true);
      expect(await db.select().from(entities).where(eq(entities.teamId, teamId))).toHaveLength(1);
      const scope = withTeam(db, teamId, userId);
      for (const suggestionId of new Set(items.map((item) => item.suggestionId)))
        await scope.suggestions.acceptSelected({
          suggestionId,
          itemIds: items
            .filter((item) => item.suggestionId === suggestionId)
            .map((item) => item.id),
        });
      const objects = await scope.objects.listObjects();
      expect(objects.filter((object) => object.type === 'company')).toHaveLength(1);
      const person = objects.find(
        (object) => object.type === 'person' && object.canonicalName.includes('Mara'),
      );
      expect(person).toBeDefined();
      const facets = await db
        .select()
        .from(objectIdentityFacets)
        .where(eq(objectIdentityFacets.teamId, teamId));
      expect(
        facets.some(
          (facet) =>
            facet.entityId === required(person).id &&
            facet.normalizedValue === 'mara@northstar-audit.test',
        ),
      ).toBe(true);
      const relationships = await db
        .select()
        .from(entityRelationships)
        .where(eq(entityRelationships.teamId, teamId));
      expect(
        relationships.some(
          (edge) =>
            [edge.fromEntityId, edge.toEntityId].includes(required(person).id) &&
            [edge.fromEntityId, edge.toEntityId].includes(required(company).id),
        ),
      ).toBe(true);
      await processSuggestionJobForTests({ db }, job, { chatStructured: meteredChat });
      expect(
        await db.select().from(agentSuggestionItems).where(eq(agentSuggestionItems.teamId, teamId)),
      ).toHaveLength(items.length);
    }, 240000);
  it('recalls an unsummarized project from an entity-only vector with team filtering', async () => {
    const teamId = required(createdTeams[0]);
    const [owner] = await db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
    const [project] = await db
      .insert(entities)
      .values({
        teamId,
        type: 'project',
        canonicalName: 'Asiakasportaali',
        metadata: { description: 'Client audit evidence upload portal' },
      })
      .returning();
    const vector = await llm.embed({
      text: 'Asiakasportaali is the client audit evidence upload portal.',
    });
    const payload: qdrant.QdrantPayload = {
      team_id: teamId,
      source_kind: 'entity',
      source_scope: 'entity',
      source_id: required(project).id,
      embedding_model: vector.model,
      entity_id: required(project).id,
      object_id: null,
      entity_ids: [required(project).id],
      event_id: null,
      fact_id: null,
      note_id: null,
      change_id: null,
      occurred_at: new Date().toISOString(),
      author_user_id: null,
      visibility_owner_user_id: null,
      source: 'system',
      visibility: 'team',
      visibility_user_ids: null,
      chunk_index: 0,
      document_id: null,
      document_version_id: null,
      document_chunk_id: null,
      folder_id: null,
      owner_user_id: null,
      updated_at: null,
      meeting_id: null,
      meeting_chunk_id: null,
      speaker: null,
    };
    await qdrant
      .getQdrantClient()
      .upsertVector(
        qdrant.buildPointId('entity', required(project).id, vector.model),
        vector.vector,
        payload,
      );
    const recalled = await withTeam(
      db,
      teamId,
      required(owner).userId,
    ).engineMaintenance.semanticCandidates('client audit evidence portal');
    expect(recalled.some((row) => row.id === required(project).id)).toBe(true);
    expect(recalled.every((row) => row.teamId === teamId)).toBe(true);
  }, 120000);
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected fixture value');
  return value;
}
