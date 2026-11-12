import { PGlite } from '@electric-sql/pglite';
import {
  type Db,
  entities,
  documents,
  documentVersions,
  documentChunks,
  rawEvents,
  agentSuggestions,
  agentSuggestionItems,
  engineMaintenanceRuns,
  objectIdentityFacets,
  facts,
  factEntities,
} from '@timeline/db';
import type { llm } from '@timeline/shared';
import { withTeam, getEnv, suggestions } from '@timeline/shared';
import { runWithBillingContext } from '@timeline/shared/billing';
import { resetEnvForTests } from '@timeline/shared/env';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import type { z } from 'zod';

import { applyDbMigrations } from '#src/test/pglite.js';
import { processSuggestionJobForTests } from '#src/workers/suggestions.js';

// Real migrated persistence verifies pagination, evidence lifetime and destructive reset isolation.
// LLM transport is injected; no external model, Redis or customer data is used here.
const teamId = '11111111-1111-4111-8111-111111111111';
const otherTeam = '22222222-2222-4222-8222-222222222222';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let pg: PGlite, db: Db;
beforeEach(async () => {
  process.env.IDENTITY_SEMANTIC_ENABLED = 'false';
  resetEnvForTests();
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg) as unknown as Db;
  await pg.exec(
    `INSERT INTO teams(id,slug,name) VALUES ('${teamId}','engine','Engine'),('${otherTeam}','other','Other'); INSERT INTO users(id,email,name) VALUES ('${userId}','owner@example.test','Owner'); INSERT INTO team_members(team_id,user_id,role) VALUES ('${teamId}','${userId}','owner');`,
  );
});
afterEach(async () => {
  await pg.close();
  resetEnvForTests();
});
const scope = () => withTeam(db, teamId, userId);
async function documentFixture(status: 'pending' | 'chunked' = 'chunked') {
  const [event] = await db
    .insert(rawEvents)
    .values({
      teamId,
      source: 'document',
      contentText: 'Uploaded clients.csv',
      visibility: 'team',
      authorUserId: userId,
      occurredAt: new Date(),
    })
    .returning();
  const [doc] = await db
    .insert(documents)
    .values({ teamId, name: 'clients.csv', ownerUserId: userId, visibility: 'team' })
    .returning();
  const [version] = await db
    .insert(documentVersions)
    .values({
      teamId,
      documentId: required(doc).id,
      version: 1,
      objectKey: 'synthetic/clients.csv',
      sourceEventId: required(event).id,
      processingStatus: status,
    })
    .returning();
  await db
    .update(documents)
    .set({ currentVersionId: required(version).id })
    .where(eq(documents.id, required(doc).id));
  return { event: required(event), doc: required(doc), version: required(version) };
}
const model: typeof llm.chatStructured = <T extends z.ZodType>(input: llm.ChatStructuredInput<T>) =>
  Promise.resolve({
    object: input.schema.parse({
      bundles: [
        {
          title: 'Remember Acme',
          reason: 'Client list identifies Acme.',
          confidence: 'high',
          items: [
            {
              operation: 'create',
              targetKind: 'object',
              title: 'Acme',
              proposedPayload: {
                type: 'company',
                canonicalName: 'Acme',
                metadata: { domain: 'acme.test' },
              },
            },
          ],
        },
      ],
    }),
    model: 'fixture',
  });
describe('engine persistence contracts', () => {
  it('uses captured source text instead of paraphrased facts for identity citations', async () => {
    const [object] = await db
      .insert(entities)
      .values({ teamId, type: 'project', canonicalName: 'Client Portal' })
      .returning();
    const text = 'PBC-portaali and Client Portal are the same audit document upload project.';
    const [event] = await db
      .insert(rawEvents)
      .values({
        teamId,
        source: 'email',
        contentText: text,
        visibility: 'team',
        occurredAt: new Date(),
      })
      .returning();
    const rows = await db
      .insert(facts)
      .values([
        {
          teamId,
          rawEventId: required(event).id,
          statement: 'The client portal has a Finnish alias.',
          confidence: 0.9,
          modelVersion: 'fixture',
        },
        {
          teamId,
          rawEventId: required(event).id,
          statement: 'Both names refer to an audit upload service.',
          confidence: 0.9,
          modelVersion: 'fixture',
        },
      ])
      .returning();
    await db.insert(factEntities).values(
      rows.map((fact) => ({
        factId: fact.id,
        entityId: required(object).id,
        role: 'subject' as const,
      })),
    );
    expect(await scope().engineMaintenance.identityEvidence([required(object).id])).toEqual([
      { objectId: required(object).id, rawEventId: required(event).id, text },
    ]);
  });

  it('keeps ordinary source extraction eligible after an object-only cleanup repair', async () => {
    process.env.IDENTITY_SEMANTIC_ENABLED = 'true';
    resetEnvForTests();
    // A task avoids the separate project/company semantic-resolution model call.
    const [task] = await db
      .insert(entities)
      .values({ teamId, type: 'task', canonicalName: 'Prepare audit outline', status: 'todo' })
      .returning();
    const [event] = await db
      .insert(rawEvents)
      .values({
        teamId,
        source: 'email',
        contentText:
          'The audit outline is complete. We also need to prepare a separate client checklist.',
        visibility: 'team',
        authorUserId: userId,
        occurredAt: new Date(),
        sourceMetadata: {
          extracted_at: new Date().toISOString(),
          extraction_model_version: 'fixture',
          source_payload_ref: 'inline://engine-repair-fixture',
        },
      })
      .returning();
    const [fact] = await db
      .insert(facts)
      .values({
        teamId,
        rawEventId: required(event).id,
        statement: 'The audit outline was completed.',
        confidence: 1,
        modelVersion: 'fixture',
      })
      .returning();
    await db
      .insert(factEntities)
      .values({ factId: required(fact).id, entityId: required(task).id, role: 'subject' });
    let calls = 0;
    const chat: typeof llm.chatStructured = (input) => {
      calls++;
      return Promise.resolve({
        model: 'fixture',
        object: input.schema.parse({
          bundles: [
            {
              title: 'Audit follow-through',
              confidence: 'high',
              reason: 'Completed outline and new checklist request.',
              items: [
                {
                  operation: 'update',
                  targetKind: 'task',
                  targetId: required(task).id,
                  title: 'Complete audit outline',
                  proposedPayload: { status: 'done' },
                },
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: 'Prepare client checklist',
                  proposedPayload: { canonicalName: 'Prepare client checklist', status: 'todo' },
                },
              ],
            },
          ],
        }),
      });
    };
    const io = {
      chatStructured: chat,
      modelId: 'fixture',
      taskCategoryClassificationEnabled: false,
    };
    await processSuggestionJobForTests(
      { db },
      { scope: 'object_cleanup', teamId, objectId: required(task).id },
      io,
    );
    const [afterRepair] = await db
      .select()
      .from(rawEvents)
      .where(eq(rawEvents.id, required(event).id));
    expect(required(afterRepair).sourceMetadata).not.toHaveProperty('suggestion_model_version');
    expect(
      (await db.select().from(agentSuggestionItems)).some(
        (item) => item.operation === 'create' && item.targetKind === 'task',
      ),
    ).toBe(false);
    await processSuggestionJobForTests({ db }, { teamId, rawEventId: required(event).id }, io);
    expect(calls).toBe(2);
    expect(
      (await scope().suggestions.listPendingSuggestions())
        .flatMap((bundle) => bundle.items)
        .some((item) => item.operation === 'create' && item.title === 'Prepare client checklist'),
    ).toBe(true);
  });

  it('does not propose merging same-name projects based only on a shared company', async () => {
    await db.insert(entities).values([
      {
        teamId,
        type: 'project',
        canonicalName: 'Client Portal',
        metadata: { companyId: 'same-company', scope: 'audit uploads' },
      },
      {
        teamId,
        type: 'project',
        canonicalName: 'Client-Portal',
        metadata: { companyId: 'same-company', scope: 'marketing downloads' },
      },
    ]);
    await processSuggestionJobForTests(
      { db },
      { scope: 'object_cleanup', teamId },
      { chatStructured: model },
    );
    const items = await db.select().from(agentSuggestionItems);
    expect(items.some((item) => item.targetKind === 'object_merge')).toBe(false);
  });

  it('persists deduplicated billing operation references for maintenance coverage', async () => {
    const run = await scope().engineMaintenance.beginCleanup();
    await runWithBillingContext(
      { db, teamId, userId, operationClass: 'test', operationId: 'synthetic-operation' },
      async () => {
        await scope().engineMaintenance.checkpoint(run.id, { status: 'running' });
        await scope().engineMaintenance.checkpoint(run.id, { status: 'paused' });
      },
    );
    expect(required((await scope().engineMaintenance.latestRuns())[0]).metadata).toMatchObject({
      billingOperationIds: ['synthetic-operation'],
      totalObjects: 0,
      proposalCount: 0,
    });
  });

  it('covers more than 500 objects despite concurrent updatedAt changes and excludes another team', async () => {
    await db.insert(entities).values(
      Array.from({ length: 601 }, (_, i) => ({
        teamId,
        type: 'project' as const,
        canonicalName: `Project ${i}`,
      })),
    );
    await db
      .insert(entities)
      .values({ teamId: otherTeam, type: 'project', canonicalName: 'Private other workspace' });
    const run = await scope().engineMaintenance.beginCleanup();
    const lease = await scope().engineMaintenance.claimRun(run.id);
    expect(lease).not.toBeNull();
    expect(await scope().engineMaintenance.claimRun(run.id)).toBeNull();
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (;;) {
      const page = await scope().engineMaintenance.cleanupPage(cursor, run.startedAt, 100);
      if (!page.length) break;
      for (const object of page) {
        expect(seen.has(object.id)).toBe(false);
        seen.add(object.id);
      }
      cursor = required(page.at(-1)).id;
      await db
        .update(entities)
        .set({ updatedAt: new Date() })
        .where(eq(entities.id, required(page[0]).id));
      await scope().engineMaintenance.checkpoint(
        run.id,
        { cursor, examined: seen.size, status: 'paused' },
        required(lease),
      );
    }
    expect(seen.size).toBe(601);
    expect((await scope().engineMaintenance.beginCleanup()).examined).toBe(601);
    await scope().engineMaintenance.releaseRun(run.id, required(lease));
  });
  it('creates document approvals once and rejects acceptance after source visibility changes', async () => {
    const fixture = await documentFixture();
    const [chunk] = await db
      .insert(documentChunks)
      .values({
        teamId,
        documentId: fixture.doc.id,
        documentVersionId: fixture.version.id,
        chunkIndex: 0,
        text: 'Acme is a client. Its business domain is acme.test.',
        tokenCount: 14,
      })
      .returning();
    const data = { scope: 'document' as const, teamId, documentVersionId: fixture.version.id };
    const io = { chatStructured: model, getEnv: () => getEnv(), modelId: 'fixture' };
    await processSuggestionJobForTests({ db }, data, io);
    await processSuggestionJobForTests({ db }, data, io);
    const bundles = await db.select().from(agentSuggestions);
    expect(bundles).toHaveLength(1);
    const runs = await scope().engineMaintenance.latestRuns();
    expect(required(runs[0]).metadata).toMatchObject({ proposalCount: 1 });
    expect(required(bundles[0]).metadata).toMatchObject({
      document_version_id: fixture.version.id,
      document_chunk_id: required(chunk).id,
    });
    expect(await db.select().from(entities)).toHaveLength(0);
    const [item] = await db.select().from(agentSuggestionItems);
    await db
      .update(documents)
      .set({ visibility: 'private' })
      .where(eq(documents.id, fixture.doc.id));
    await scope().suggestions.acceptSuggestionItem(required(item).id);
    expect(await db.select().from(entities)).toHaveLength(0);
  });
  it('fences a stale run owner before it can persist document approvals', async () => {
    const fixture = await documentFixture();
    await db.insert(documentChunks).values({
      teamId,
      documentId: fixture.doc.id,
      documentVersionId: fixture.version.id,
      chunkIndex: 0,
      text: 'Acme is a client.',
      tokenCount: 5,
    });
    const stealingModel: typeof llm.chatStructured = async (input) => {
      await db
        .update(engineMaintenanceRuns)
        .set({ leaseOwner: crypto.randomUUID() })
        .where(eq(engineMaintenanceRuns.teamId, teamId));
      return model(input);
    };
    const error = await processSuggestionJobForTests(
      { db },
      { scope: 'document', teamId, documentVersionId: fixture.version.id },
      { chatStructured: stealingModel },
    ).then(
      () => null,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('Maintenance lease lost');
    expect(await db.select().from(agentSuggestions)).toHaveLength(0);
  });
  it('does not publish document proposals if visibility changes during inference', async () => {
    const fixture = await documentFixture();
    await db.insert(documentChunks).values({
      teamId,
      documentId: fixture.doc.id,
      documentVersionId: fixture.version.id,
      chunkIndex: 0,
      text: 'Acme is a client.',
      tokenCount: 5,
    });
    const changingModel: typeof llm.chatStructured = async (input) => {
      await db
        .update(documents)
        .set({ visibility: 'private' })
        .where(eq(documents.id, fixture.doc.id));
      return model(input);
    };
    const error = await processSuggestionJobForTests(
      { db },
      { scope: 'document', teamId, documentVersionId: fixture.version.id },
      { chatStructured: changingModel },
    ).then(
      () => null,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('Document evidence changed');
    expect(await db.select().from(agentSuggestions)).toHaveLength(0);
  });
  it('does not permanently complete document review before extraction is ready', async () => {
    const fixture = await documentFixture('pending');
    await processSuggestionJobForTests(
      { db },
      { scope: 'document', teamId, documentVersionId: fixture.version.id },
      { chatStructured: model },
    );
    expect(await db.select().from(engineMaintenanceRuns)).toHaveLength(0);
  });
  it('proposes a supported company affiliation without writing canonical relationships', async () => {
    const [person, company] = await db
      .insert(entities)
      .values([
        { teamId, type: 'person', canonicalName: 'Alex Example' },
        { teamId, type: 'company', canonicalName: 'Acme', metadata: { domain: 'acme.test' } },
      ])
      .returning();
    await db.insert(objectIdentityFacets).values({
      teamId,
      entityId: required(person).id,
      kind: 'email',
      value: 'alex@acme.test',
      normalizedValue: 'alex@acme.test',
      source: 'manual',
      status: 'approved',
    });
    await processSuggestionJobForTests(
      { db },
      { scope: 'object_cleanup', teamId, objectId: required(person).id },
    );
    const items = await db.select().from(agentSuggestionItems);
    expect(
      items.some((item) => {
        const payload = item.proposedPayload as Record<string, unknown>;
        return (
          [payload.fromEntityId, payload.toEntityId].includes(required(company).id) &&
          [payload.fromEntityId, payload.toEntityId].includes(required(person).id)
        );
      }),
    ).toBe(true);
  });
  it('resets derived objects while preserving captured sources, documents and another team', async () => {
    const fixture = await documentFixture();
    await db.insert(rawEvents).values({
      teamId,
      source: 'system',
      contentText: 'Created discarded project',
      visibility: 'team',
      occurredAt: new Date(),
    });
    await db.insert(entities).values([
      { teamId, type: 'project', canonicalName: 'Discard development edits' },
      { teamId: otherTeam, type: 'company', canonicalName: 'Other workspace' },
    ]);
    const saved = {
      ENGINE_DEV_RESET_ALLOWED: process.env.ENGINE_DEV_RESET_ALLOWED,
      REDIS_URL: process.env.REDIS_URL,
      QDRANT_URL: process.env.QDRANT_URL,
    };
    Object.assign(process.env, {
      ENGINE_DEV_RESET_ALLOWED: 'true',
      REDIS_URL: 'redis://localhost:6379',
      QDRANT_URL: 'http://localhost:6333',
    });
    try {
      const run = await scope().engineMaintenance.beginCleanup('development_reset');
      await scope().engineMaintenance.resetDerivedState(run.id);
      expect(await db.select().from(entities)).toHaveLength(1);
      expect(required((await db.select().from(entities))[0]).teamId).toBe(otherTeam);
      expect(required((await db.select().from(rawEvents))[0]).id).toBe(fixture.event.id);
      expect(required((await db.select().from(documentVersions))[0]).id).toBe(fixture.version.id);
      expect((await scope().engineMaintenance.replayEvents(null)).map((row) => row.id)).toEqual([
        fixture.event.id,
      ]);
      expect(required((await scope().engineMaintenance.replayDocuments())[0]).id).toBe(
        fixture.version.id,
      );
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = value;
      }
    }
  });
  it('restricts destructive reset to local development infrastructure', () => {
    const base = {
      NODE_ENV: 'test',
      ENGINE_DEV_RESET_ALLOWED: 'true',
      DATABASE_URL: 'postgres://test@localhost/test',
      REDIS_URL: 'redis://localhost',
      QDRANT_URL: 'http://localhost:6333',
    };
    expect(() => {
      suggestions.assertDevelopmentResetEnvironment(base);
    }).not.toThrow();
    expect(() => {
      suggestions.assertDevelopmentResetEnvironment({ ...base, NODE_ENV: 'production' });
    }).toThrow();
    expect(() => {
      suggestions.assertDevelopmentResetEnvironment({
        ...base,
        DATABASE_URL: 'postgres://test@db.example.com/test',
      });
    }).toThrow();
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected fixture value');
  return value;
}
