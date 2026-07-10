import { PGlite } from '@electric-sql/pglite';
import {
  type Db,
  artifactClusters,
  artifactEvidenceAssociations,
  entities,
  factEntities,
  facts,
  objectSummaries,
  rawEvents,
  reconciliationEvidence,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStructuredInput, ChatStructuredResult } from '#src/llm/chat.js';
import type { z } from 'zod';

import { generateAndStoreObjectSummary } from '#src/objects/summaries.js';
import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

vi.mock('#src/queue/queues.js', () => ({
  enqueueObjectEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectSummaryJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'summary-eval' }),
}));

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

let pg: PGlite;
let db: Db;

async function seedWorkspace(): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'summary-eval-team', 'Summary Eval Team');

    INSERT INTO users (id, email)
    VALUES ('${USER_ID}', 'summary-owner@test.local');

    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
}

beforeEach(async () => {
  vi.clearAllMocks();
  pg = new PGlite();
  await applyDbMigrations(pg);
  await seedWorkspace();
  db = drizzle(pg) as unknown as Db;
}, 60_000);

afterEach(async () => {
  await pg.close();
});

describe('object summary evals', () => {
  it('grounds summaries in visible reconciliation evidence without leaking private sources', async () => {
    const scope = withTeam(db, TEAM_ID, USER_ID);
    const [object] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'project',
        canonicalName: 'Northstar rollout',
        status: 'active',
        stage: 'renewal',
      })
      .returning({ id: entities.id });
    if (!object) throw new Error('failed to insert object');

    const [cluster] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactClusterKind: 'customer_project',
        artifactType: 'project',
        canonicalName: 'Northstar rollout',
        canonicalEntityId: object.id,
      })
      .returning({ id: artifactClusters.id });
    if (!cluster) throw new Error('failed to insert artifact cluster');

    const [visibleRaw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'Monday item: Northstar approved the rollout renewal packet.',
        occurredAt: new Date('2026-07-02T10:00:00.000Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'monday',
          source_payload_ref: 'monday://board/rollouts/item/northstar-approval',
        },
      })
      .returning({ id: rawEvents.id });
    if (!visibleRaw) throw new Error('failed to insert visible raw event');

    const [visibleFact] = await db
      .insert(facts)
      .values({
        teamId: TEAM_ID,
        rawEventId: visibleRaw.id,
        statement: 'Northstar approved the rollout renewal packet.',
        confidence: 0.98,
        modelVersion: 'summary-eval',
      })
      .returning({ id: facts.id });
    if (!visibleFact) throw new Error('failed to insert visible fact');
    await db.insert(factEntities).values({
      factId: visibleFact.id,
      entityId: object.id,
      role: 'subject',
    });

    const [visibleEvidence] = await db
      .insert(reconciliationEvidence)
      .values({
        teamId: TEAM_ID,
        rawEventId: visibleRaw.id,
        sourcePayloadRef: 'monday://board/rollouts/item/northstar-approval',
        payloadDigest: 'sha256:northstar-visible-payload',
        source: 'integration',
        provider: 'monday',
        externalObjectId: 'northstar-approval',
        externalEventId: 'northstar-approval:update',
        eventType: 'monday.item_update',
        occurredAt: new Date('2026-07-02T10:00:00.000Z'),
        visibility: 'team',
        actor: { kind: 'customer' },
        contentDigest: 'sha256:northstar-visible-content',
        title: 'Northstar approved renewal rollout',
        summary: 'Visible renewal packet signed by Northstar procurement.',
        metadata: {},
        normalizerVersion: 'summary-eval',
        replayState: 'full',
        dedupeKey: 'summary-eval-visible-evidence',
      })
      .returning({ id: reconciliationEvidence.id });
    if (!visibleEvidence) throw new Error('failed to insert visible evidence');
    await db.insert(artifactEvidenceAssociations).values({
      teamId: TEAM_ID,
      clusterId: cluster.id,
      evidenceId: visibleEvidence.id,
      rawEventId: visibleRaw.id,
      role: 'decision',
      strength: 'hard',
      associationSource: 'hard_anchor',
      sourceRefs: [
        { source: 'integration', rawEventId: visibleRaw.id, evidenceId: visibleEvidence.id },
      ],
      visibility: 'team',
      visibilityFloor: 'team',
      dedupeKey: 'summary-eval-visible-association',
    });

    const [privateRaw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'Sentry incident: Private severity-one outage is still customer-visible.',
        occurredAt: new Date('2026-07-02T11:00:00.000Z'),
        visibility: 'private',
        visibilityOwnerUserId: USER_ID,
        sourceMetadata: {
          provider: 'sentry',
          source_payload_ref: 'sentry://issue/private-sev-one',
        },
      })
      .returning({ id: rawEvents.id });
    if (!privateRaw) throw new Error('failed to insert private raw event');
    const [privateRawEvidence] = await db
      .insert(reconciliationEvidence)
      .values({
        teamId: TEAM_ID,
        rawEventId: privateRaw.id,
        sourcePayloadRef: 'sentry://issue/private-sev-one',
        payloadDigest: 'sha256:northstar-private-raw-payload',
        source: 'integration',
        provider: 'sentry',
        externalObjectId: 'private-sev-one',
        externalEventId: 'private-sev-one:update',
        eventType: 'sentry.issue_update',
        occurredAt: new Date('2026-07-02T11:00:00.000Z'),
        visibility: 'private',
        visibilityOwnerUserId: USER_ID,
        actor: {},
        contentDigest: 'sha256:northstar-private-raw-content',
        title: 'Private Sentry severity-one outage',
        summary: 'Private Sentry severity-one outage is still customer-visible.',
        metadata: {},
        normalizerVersion: 'summary-eval',
        replayState: 'full',
        dedupeKey: 'summary-eval-private-raw-evidence',
      })
      .returning({ id: reconciliationEvidence.id });
    if (!privateRawEvidence) throw new Error('failed to insert private raw evidence');
    await db.insert(artifactEvidenceAssociations).values({
      teamId: TEAM_ID,
      clusterId: cluster.id,
      evidenceId: privateRawEvidence.id,
      rawEventId: privateRaw.id,
      role: 'blocker',
      strength: 'hard',
      associationSource: 'hard_anchor',
      sourceRefs: [
        { source: 'integration', rawEventId: privateRaw.id, evidenceId: privateRawEvidence.id },
      ],
      visibility: 'team',
      visibilityFloor: 'team',
      dedupeKey: 'summary-eval-private-raw-association',
    });

    const [privateAssociationRaw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'email',
        contentText: 'Forwarded email: Private discount floor is forty percent.',
        occurredAt: new Date('2026-07-02T12:00:00.000Z'),
        visibility: 'team',
      })
      .returning({ id: rawEvents.id });
    if (!privateAssociationRaw) throw new Error('failed to insert private-association raw event');
    const [privateAssociationEvidence] = await db
      .insert(reconciliationEvidence)
      .values({
        teamId: TEAM_ID,
        rawEventId: privateAssociationRaw.id,
        sourcePayloadRef: 'email://message/private-discount-floor',
        payloadDigest: 'sha256:northstar-private-association-payload',
        source: 'email',
        provider: 'email',
        externalObjectId: 'private-discount-floor',
        externalEventId: 'private-discount-floor:update',
        eventType: 'customer_project_update',
        occurredAt: new Date('2026-07-02T12:00:00.000Z'),
        visibility: 'team',
        actor: {},
        contentDigest: 'sha256:northstar-private-association-content',
        title: 'Private discount floor',
        summary: 'Private discount floor is forty percent.',
        metadata: {},
        normalizerVersion: 'summary-eval',
        replayState: 'full',
        dedupeKey: 'summary-eval-private-association-evidence',
      })
      .returning({ id: reconciliationEvidence.id });
    if (!privateAssociationEvidence)
      throw new Error('failed to insert private association evidence');
    await db.insert(artifactEvidenceAssociations).values({
      teamId: TEAM_ID,
      clusterId: cluster.id,
      evidenceId: privateAssociationEvidence.id,
      rawEventId: privateAssociationRaw.id,
      role: 'related_context',
      strength: 'hard',
      associationSource: 'hard_anchor',
      sourceRefs: [
        {
          source: 'email',
          rawEventId: privateAssociationRaw.id,
          evidenceId: privateAssociationEvidence.id,
        },
      ],
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
      visibilityFloor: 'private',
      visibilityFloorOwnerUserId: USER_ID,
      dedupeKey: 'summary-eval-private-association',
    });

    let prompt = '';
    const chatStructured = vi.fn(
      <TSchema extends z.ZodType>(
        input: ChatStructuredInput<TSchema>,
      ): Promise<ChatStructuredResult<TSchema>> => {
        prompt = input.prompt;
        return Promise.resolve({
          model: 'summary-eval-model',
          object: input.schema.parse({
            overview: 'Northstar rollout is approved for renewal.',
            overviewSourceRefs: [
              { kind: 'fact', id: visibleFact.id },
              { kind: 'timeline_event', id: visibleRaw.id },
            ],
            currentState: [
              {
                label: 'Approval',
                text: 'The visible renewal packet is signed by procurement.',
                sourceRefs: [{ kind: 'timeline_event', id: visibleRaw.id }],
              },
            ],
            openQuestions: [],
            conflicts: [],
          }),
        });
      },
    );

    await expect(
      generateAndStoreObjectSummary(
        db,
        scope,
        object.id,
        { trigger: 'manual' },
        { chatStructured, enqueueObjectEmbedJob: vi.fn().mockResolvedValue(undefined) },
      ),
    ).resolves.toEqual({ status: 'ready' });

    expect(prompt).toContain('Visible renewal packet signed by Northstar procurement.');
    expect(prompt).toContain('Northstar approved the rollout renewal packet.');
    expect(prompt).not.toContain('Private Sentry severity-one outage');
    expect(prompt).not.toContain('Private discount floor');

    const [summary] = await db
      .select()
      .from(objectSummaries)
      .where(eq(objectSummaries.entityId, object.id));
    expect(summary?.status).toBe('ready');
    expect(summary?.sourceRefs).toEqual([
      { kind: 'fact', id: visibleFact.id },
      { kind: 'timeline_event', id: visibleRaw.id },
    ]);
    expect(summary?.sourceRefs).not.toContainEqual({ kind: 'timeline_event', id: privateRaw.id });
    expect(summary?.sourceRefs).not.toContainEqual({
      kind: 'timeline_event',
      id: privateAssociationRaw.id,
    });
    expect(summary?.sourceCounts).toMatchObject({ events: 1, facts: 1 });
  });
});
