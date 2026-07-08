import { PGlite } from '@electric-sql/pglite';
import {
  agentSuggestionEvidence,
  agentSuggestionItems,
  agentSuggestions,
  artifactClusters,
  rawEvents,
  reconciliationEvidence,
  reconciliationOutputs,
  reconciliationProjectionOutbox,
  reconciliationRuns,
} from '@timeline/db';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as QueueModule from '#src/queue/queues.js';

import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

vi.mock('#src/queue/queues.js', async (importOriginal) => {
  const actual = await importOriginal<typeof QueueModule>();
  const enqueue = vi.fn(() => Promise.resolve(undefined));
  return {
    ...actual,
    enqueueCalendarEventEmbedJob: enqueue,
    enqueueEmbedJob: enqueue,
    enqueueObjectEmbedJob: enqueue,
    enqueueObjectNoteEmbedJob: enqueue,
    enqueueObjectSummaryJob: vi.fn(() => Promise.resolve({ enqueued: true, jobId: 'summary-job' })),
  };
});

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLUSTER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REVIEWER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TEAM_RAW_EVENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'team-a', 'Team A');
    INSERT INTO users (id, email)
    VALUES
      ('${USER_ID}', 'a@example.com'),
      ('${REVIEWER_ID}', 'b@example.com');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_ID}', '${USER_ID}', 'owner'),
      ('${TEAM_ID}', '${REVIEWER_ID}', 'member');
  `);
}

describe('suggestion reconciliation projection', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('projects approval suggestions from reconciliation outputs with source refs and visibility floors', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'telegram',
      contentText: 'Nora approved creating the Acme implementation task.',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'specific_users',
      visibilityUserIds: [REVIEWER_ID],
      sourceMetadata: {
        source_payload_ref: '  s3://timeline-test/raw/telegram/acme-implementation-task  ',
      },
    });
    const scope = withTeam(db as never, TEAM_ID, REVIEWER_ID);

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create Acme implementation task',
      dedupeKey: 'reconciliation-projection-task',
      visibility: 'team',
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID, quote: 'Nora approved creating the task.' }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Create Acme implementation task',
          dedupeKey: 'reconciliation-projection-task:item',
          proposedPayload: { canonicalName: 'Create Acme implementation task' },
        },
      ],
    });

    const runs = await db.select().from(reconciliationRuns);
    expect(runs).toHaveLength(1);
    const bundleOutputIds = bundle.metadata.reconciliation_output_ids;
    if (!Array.isArray(bundleOutputIds)) throw new Error('expected reconciliation output ids');
    const stringBundleOutputIds = bundleOutputIds.filter(
      (value): value is string => typeof value === 'string',
    );
    expect(stringBundleOutputIds).toHaveLength(1);
    const bundleOutputId = stringBundleOutputIds[0];
    if (!bundleOutputId) throw new Error('expected reconciliation output id');
    const itemOutputId = bundle.items[0]?.metadata.reconciliation_output_id;
    if (typeof itemOutputId !== 'string') throw new Error('expected item reconciliation output id');
    expect(bundle.metadata).toMatchObject({
      reconciliation_run_id: runs[0]?.id,
      reconciliation_output_ids: [bundleOutputId],
      reconciliation_projection_version: 'approval-projection-2026-06',
      reconciliation_source_ref_validation: {
        ok: true,
        source_ref_count: 1,
      },
    });
    expect(bundle.items[0]?.metadata).toMatchObject({
      reconciliation_run_id: runs[0]?.id,
      reconciliation_output_id: itemOutputId,
      reconciliation_projection_version: 'approval-projection-2026-06',
    });
    expect(bundle.evidence[0]?.metadata).toMatchObject({
      reconciliation_source_ref: {
        source: 'telegram',
        rawEventId: TEAM_RAW_EVENT_ID,
        sourcePayloadRef: 's3://timeline-test/raw/telegram/acme-implementation-task',
      },
      reconciliation_source_payload_ref: 's3://timeline-test/raw/telegram/acme-implementation-task',
    });

    const outputs = await db.select().from(reconciliationOutputs);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      runId: runs[0]?.id,
      outputKind: 'approval_bundle',
      targetKind: 'task',
      operation: 'create',
      requiresApproval: true,
      status: 'approval_created',
      visibility: 'specific_users',
      visibilityUserIds: [REVIEWER_ID],
      visibilityFloor: 'specific_users',
      visibilityFloorUserIds: [REVIEWER_ID],
    });
    expect(outputs[0]?.sourceRefs).toEqual([
      expect.objectContaining({
        source: 'telegram',
        rawEventId: TEAM_RAW_EVENT_ID,
        sourcePayloadRef: 's3://timeline-test/raw/telegram/acme-implementation-task',
      }),
    ]);
    expect(outputs[0]?.sourcePayloadRefs).toEqual([
      's3://timeline-test/raw/telegram/acme-implementation-task',
    ]);
    expect(outputs[0]?.payload).toMatchObject({
      projection_metadata: {
        reconciliation_source_ref_validation: {
          ok: true,
          source_ref_count: 1,
        },
      },
    });
    expect(bundle.items[0]?.metadata.reconciliation_output_id).toBe(outputs[0]?.id);

    const outboxRows = await db.select().from(reconciliationProjectionOutbox);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toMatchObject({
      teamId: TEAM_ID,
      outputId: outputs[0]?.id,
      suggestionId: bundle.id,
      suggestionItemId: bundle.items[0]?.id,
      action: 'create_projection',
      status: 'processed',
    });
    expect(outboxRows[0]?.payload).toMatchObject({
      projection: 'agent_suggestions',
      projection_version: 'approval-projection-2026-06',
      suggestion_dedupe_key: 'reconciliation-projection-task',
      item_dedupe_key: 'reconciliation-projection-task:item',
    });
    expect(outboxRows[0]?.processedAt).toEqual(expect.any(Date));
  });

  it('repairs missing outbox rows when the approval projection already exists', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'telegram',
      contentText: 'Create the Acme implementation follow-up.',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'team',
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create Acme implementation follow-up',
      dedupeKey: 'reconciliation-projection-existing-outbox-repair',
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Create Acme implementation follow-up',
          dedupeKey: 'reconciliation-projection-existing-outbox-repair:item',
          proposedPayload: { canonicalName: 'Create Acme implementation follow-up' },
        },
      ],
    });
    const outputId = bundle.items[0]?.metadata.reconciliation_output_id;
    if (typeof outputId !== 'string') throw new Error('expected reconciliation output id');
    await db.delete(reconciliationProjectionOutbox);

    const repaired = await scope.suggestions.repairApprovalProjectionForOutput(outputId);

    expect(repaired?.id).toBe(bundle.id);
    expect(await db.select().from(agentSuggestions)).toHaveLength(1);
    const outboxRows = await db.select().from(reconciliationProjectionOutbox);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toMatchObject({
      outputId,
      suggestionId: bundle.id,
      suggestionItemId: bundle.items[0]?.id,
      action: 'repair_projection',
      status: 'processed',
    });
    expect(outboxRows[0]?.payload).toMatchObject({
      projection: 'agent_suggestions',
      suggestion_dedupe_key: 'reconciliation-projection-existing-outbox-repair',
      item_dedupe_key: 'reconciliation-projection-existing-outbox-repair:item',
      repaired_from_output_id: outputId,
    });
  });

  it('lets the visibility owner project private evidence even when they are not the author', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: null,
      visibilityOwnerUserId: REVIEWER_ID,
      source: 'email',
      contentText: 'Private customer email asks for an Acme follow-up.',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'private',
      sourceMetadata: {
        source_payload_ref: 's3://timeline-test/raw/email/private-owner.eml',
      },
    });

    await expect(
      withTeam(db as never, TEAM_ID, USER_ID).suggestions.createOrMergeSuggestionBundle({
        source: 'background',
        title: 'Create private Acme follow-up',
        dedupeKey: 'reconciliation-projection-private-owner-blocked',
        evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
        items: [
          {
            operation: 'create',
            targetKind: 'task',
            title: 'Create private Acme follow-up',
            dedupeKey: 'reconciliation-projection-private-owner:item',
            proposedPayload: { canonicalName: 'Create private Acme follow-up' },
          },
        ],
      }),
    ).rejects.toThrow('Suggestion evidence must reference visible events in this team');

    const bundle = await withTeam(
      db as never,
      TEAM_ID,
      REVIEWER_ID,
    ).suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create private Acme follow-up',
      dedupeKey: 'reconciliation-projection-private-owner',
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Create private Acme follow-up',
          dedupeKey: 'reconciliation-projection-private-owner:item',
          proposedPayload: { canonicalName: 'Create private Acme follow-up' },
        },
      ],
    });

    expect(bundle.visibility).toBe('private');
    expect(bundle.visibilityOwnerUserId).toBe(REVIEWER_ID);
    const outputs = await db.select().from(reconciliationOutputs);
    expect(outputs[0]).toMatchObject({
      visibility: 'private',
      visibilityOwnerUserId: REVIEWER_ID,
      visibilityFloor: 'private',
      visibilityFloorOwnerUserId: REVIEWER_ID,
    });
  });

  it('enforces output visibility floors when repairing approval projections', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: REVIEWER_ID,
      visibilityOwnerUserId: REVIEWER_ID,
      source: 'email',
      contentText: 'Private Acme rollout note should only be reviewed by its owner.',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'private',
    });
    const [run] = await db
      .insert(reconciliationRuns)
      .values({
        teamId: TEAM_ID,
        trigger: 'manual_repair',
        scope: 'approval_projection',
        status: 'completed',
        inputFingerprint: 'private-floor-repair-run',
        engineVersion: 'approval-projection-2026-06',
        completedAt: new Date('2026-06-20T10:00:00Z'),
      })
      .returning();
    if (!run) throw new Error('expected reconciliation run');
    const [output] = await db
      .insert(reconciliationOutputs)
      .values({
        teamId: TEAM_ID,
        runId: run.id,
        outputKind: 'approval_bundle',
        targetKind: 'task',
        operation: 'create',
        payload: {
          projection: 'agent_suggestions',
          suggestion_dedupe_key: 'private-floor-repair',
          suggestion_source: 'background',
          suggestion_title: 'Create private Acme task',
          item_dedupe_key: 'private-floor-repair:item',
          title: 'Create private Acme task',
          proposed_payload: { canonicalName: 'Create private Acme task' },
        },
        authorityDecision: {
          decision: 'requires_approval',
          reason: 'private_floor_test',
          policy_version: 'timeline-owned-approval-2026-06',
        },
        requiresApproval: true,
        sourceRefs: [{ source: 'email', rawEventId: TEAM_RAW_EVENT_ID }],
        visibility: 'team',
        visibilityFloor: 'private',
        visibilityFloorOwnerUserId: REVIEWER_ID,
        dedupeKey: 'private-floor-repair-output',
        status: 'pending',
      })
      .returning();
    if (!output) throw new Error('expected reconciliation output');

    await expect(
      withTeam(db as never, TEAM_ID, USER_ID).suggestions.repairApprovalProjectionForOutput(
        output.id,
      ),
    ).resolves.toBeNull();
    await expect(
      withTeam(db as never, TEAM_ID, REVIEWER_ID).suggestions.repairApprovalProjectionForOutput(
        output.id,
      ),
    ).resolves.toMatchObject({
      title: 'Create private Acme task',
      visibility: 'private',
      visibilityOwnerUserId: REVIEWER_ID,
    });
  });

  it('keeps one stable approval source ref when a raw event has multiple evidence rows', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'email',
      contentText: 'Customer approved the Acme implementation task.',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'team',
      sourceMetadata: {
        source_payload_ref: 's3://timeline-test/raw/email/acme-implementation-task.eml',
      },
    });
    await db.insert(reconciliationEvidence).values([
      {
        teamId: TEAM_ID,
        rawEventId: TEAM_RAW_EVENT_ID,
        sourcePayloadRef: 's3://timeline-test/evidence/email/acme-implementation-task-v1.json',
        source: 'email',
        provider: 'email',
        eventType: 'email.received',
        occurredAt: new Date('2026-06-20T10:00:00Z'),
        visibility: 'team',
        actor: {},
        contentDigest: 'sha256:projection-stable-v1',
        normalizerVersion: 'projection-stable-v1',
        replayState: 'full',
        dedupeKey: 'projection-stable-v1',
      },
      {
        teamId: TEAM_ID,
        rawEventId: TEAM_RAW_EVENT_ID,
        sourcePayloadRef: 's3://timeline-test/evidence/email/acme-implementation-task-v2.json',
        source: 'email',
        provider: 'email',
        eventType: 'email.received',
        occurredAt: new Date('2026-06-20T10:00:00Z'),
        visibility: 'team',
        actor: {},
        contentDigest: 'sha256:projection-stable-v2',
        normalizerVersion: 'projection-stable-v2',
        replayState: 'full',
        dedupeKey: 'projection-stable-v2',
      },
    ]);
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create Acme implementation task',
      dedupeKey: 'reconciliation-projection-stable-source-ref',
      visibility: 'team',
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Create Acme implementation task',
          dedupeKey: 'reconciliation-projection-stable-source-ref:item',
          proposedPayload: { canonicalName: 'Create Acme implementation task' },
        },
      ],
    });

    expect(bundle.metadata).toMatchObject({
      reconciliation_source_ref_validation: {
        ok: true,
        source_ref_count: 1,
      },
    });
    expect(bundle.evidence[0]?.metadata).toMatchObject({
      reconciliation_source_ref: {
        source: 'email',
        rawEventId: TEAM_RAW_EVENT_ID,
        sourcePayloadRef: 's3://timeline-test/raw/email/acme-implementation-task.eml',
      },
    });

    const outputs = await db.select().from(reconciliationOutputs);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.sourceRefs).toEqual([
      {
        source: 'email',
        rawEventId: TEAM_RAW_EVENT_ID,
        sourcePayloadRef: 's3://timeline-test/raw/email/acme-implementation-task.eml',
      },
    ]);
    expect(outputs[0]?.sourcePayloadRefs).toEqual([
      's3://timeline-test/evidence/email/acme-implementation-task-v1.json',
    ]);
  });

  it('refreshes projection output visibility when evidence visibility tightens on replay', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'email',
      contentText: 'Customer approved the Acme implementation task.',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'team',
      sourceMetadata: {
        source_payload_ref: 's3://timeline-test/raw/email/acme-implementation-task.eml',
      },
    });
    const firstScope = withTeam(db as never, TEAM_ID, USER_ID);
    const input = {
      source: 'background' as const,
      title: 'Create Acme implementation task',
      dedupeKey: 'reconciliation-projection-visibility-replay',
      visibility: 'team' as const,
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
      items: [
        {
          operation: 'create' as const,
          targetKind: 'task' as const,
          title: 'Create Acme implementation task',
          dedupeKey: 'reconciliation-projection-visibility-replay:item',
          proposedPayload: { canonicalName: 'Create Acme implementation task' },
        },
      ],
    };

    await firstScope.suggestions.createOrMergeSuggestionBundle(input);
    let [output] = await db.select().from(reconciliationOutputs);
    expect(output).toMatchObject({ visibility: 'team', visibilityFloor: 'team' });

    await db
      .update(rawEvents)
      .set({
        visibility: 'private',
        visibilityOwnerUserId: REVIEWER_ID,
      })
      .where(eq(rawEvents.id, TEAM_RAW_EVENT_ID));

    await withTeam(db as never, TEAM_ID, REVIEWER_ID).suggestions.createOrMergeSuggestionBundle(
      input,
    );
    const outputs = await db.select().from(reconciliationOutputs);
    expect(outputs).toHaveLength(1);
    [output] = outputs;
    expect(output).toMatchObject({
      visibility: 'private',
      visibilityOwnerUserId: REVIEWER_ID,
      visibilityFloor: 'private',
      visibilityFloorOwnerUserId: REVIEWER_ID,
    });
    const [suggestion] = await db.select().from(agentSuggestions);
    expect(suggestion).toMatchObject({
      visibility: 'private',
      visibilityOwnerUserId: REVIEWER_ID,
    });
  });

  it('mirrors projection rejection status back to reconciliation outputs', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'telegram',
      contentText: 'Maybe create a speculative Acme follow-up task.',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'team',
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create speculative Acme task',
      dedupeKey: 'reconciliation-projection-reject',
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Create speculative Acme task',
          dedupeKey: 'reconciliation-projection-reject:item',
          proposedPayload: { canonicalName: 'Create speculative Acme task' },
        },
      ],
    });

    await expect(scope.suggestions.rejectSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    const outputs = await db.select().from(reconciliationOutputs);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      id: bundle.items[0]?.metadata.reconciliation_output_id,
      status: 'rejected',
    });

    const outboxRows = await db
      .select()
      .from(reconciliationProjectionOutbox)
      .orderBy(asc(reconciliationProjectionOutbox.createdAt));
    expect(outboxRows.map((row) => row.action)).toEqual(['create_projection', 'mark_rejected']);
    expect(outboxRows[1]).toMatchObject({
      outputId: outputs[0]?.id,
      suggestionId: bundle.id,
      suggestionItemId: bundle.items[0]?.id,
      status: 'processed',
    });
    expect(outboxRows[1]?.payload).toMatchObject({
      projection_status: 'rejected',
      suggestion_item_status: 'rejected',
    });
  });

  it('repairs deleted approval projection rows from reconciliation outputs', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'telegram',
      contentText: 'Create Acme rollout and schedule the kickoff.',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'team',
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Plan Acme rollout',
      summary: 'Create the rollout task and kickoff calendar hold.',
      reason: 'Customer project kickoff evidence was captured from Telegram.',
      dedupeKey: 'reconciliation-projection-repair',
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Create Acme rollout task',
          dedupeKey: 'reconciliation-projection-repair:task',
          proposedPayload: { canonicalName: 'Create Acme rollout task' },
        },
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Schedule Acme kickoff',
          dedupeKey: 'reconciliation-projection-repair:calendar',
          proposedPayload: {
            title: 'Acme kickoff',
            startAt: '2026-06-23T13:00:00.000Z',
            endAt: '2026-06-23T13:30:00.000Z',
            timezone: 'UTC',
          },
        },
      ],
    });
    const outputIds = bundle.items
      .map((item) => item.metadata.reconciliation_output_id)
      .filter((value): value is string => typeof value === 'string');
    expect(outputIds).toHaveLength(2);
    await db.insert(artifactClusters).values({
      id: CLUSTER_ID,
      teamId: TEAM_ID,
      artifactClusterKind: 'customer_project',
      artifactType: 'project',
      canonicalName: 'Acme rollout',
    });
    await db
      .update(reconciliationOutputs)
      .set({ clusterId: CLUSTER_ID })
      .where(eq(reconciliationOutputs.teamId, TEAM_ID));

    await db.delete(agentSuggestions).where(eq(agentSuggestions.id, bundle.id));
    expect(await db.select().from(agentSuggestionItems)).toHaveLength(0);
    expect(await db.select().from(agentSuggestionEvidence)).toHaveLength(0);
    expect(await db.select().from(reconciliationProjectionOutbox)).toHaveLength(0);

    const repaired = await scope.suggestions.repairApprovalProjectionForOutput(outputIds[0] ?? '');
    expect(repaired).not.toBeNull();
    expect(repaired?.id).not.toBe(bundle.id);
    expect(repaired).toMatchObject({
      source: 'background',
      status: 'pending',
      title: 'Plan Acme rollout',
      summary: 'Create the rollout task and kickoff calendar hold.',
      reason: 'Customer project kickoff evidence was captured from Telegram.',
      visibility: 'team',
    });
    const repairedMetadata = repaired?.metadata ?? {};
    expect(typeof repairedMetadata.reconciliation_run_id).toBe('string');
    expect(repairedMetadata).toMatchObject({
      reconciliation_projection_version: 'approval-projection-2026-06',
      reconciliation_repaired_from_output_id: outputIds[0],
    });
    const repairedOutputIds = Array.isArray(repairedMetadata.reconciliation_output_ids)
      ? repairedMetadata.reconciliation_output_ids.filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    expect(repairedOutputIds.sort()).toEqual([...outputIds].sort());
    expect(repairedMetadata.reconciliation_cluster_ids).toEqual([CLUSTER_ID]);
    expect(repaired?.items.map((item) => item.title).sort()).toEqual([
      'Create Acme rollout task',
      'Schedule Acme kickoff',
    ]);
    expect(repaired?.items.map((item) => item.metadata.reconciliation_output_id).sort()).toEqual(
      [...outputIds].sort(),
    );
    expect(repaired?.items.map((item) => item.metadata.reconciliation_cluster_id)).toStrictEqual([
      CLUSTER_ID,
      CLUSTER_ID,
    ]);
    expect(repaired?.evidence.map((evidence) => evidence.rawEventId)).toEqual([TEAM_RAW_EVENT_ID]);
    const repairedEvidenceMetadata = repaired?.evidence[0]?.metadata ?? {};
    expect(repairedEvidenceMetadata).toMatchObject({
      projection: 'agent_suggestions',
      reconciliation_source_ref: {
        source: 'telegram',
        rawEventId: TEAM_RAW_EVENT_ID,
      },
    });
    const repairedFromOutputs = Array.isArray(repairedEvidenceMetadata.repaired_from_outputs)
      ? repairedEvidenceMetadata.repaired_from_outputs.filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    expect(repairedFromOutputs.sort()).toEqual([...outputIds].sort());

    const outboxRows = await db
      .select()
      .from(reconciliationProjectionOutbox)
      .orderBy(asc(reconciliationProjectionOutbox.createdAt));
    expect(outboxRows.map((row) => row.action)).toEqual(['repair_projection', 'repair_projection']);
    expect(outboxRows.every((row) => row.status === 'processed')).toBe(true);

    const secondRepair = await scope.suggestions.repairApprovalProjectionForOutput(
      outputIds[0] ?? '',
    );
    expect(secondRepair?.id).toBe(repaired?.id);
    expect(await db.select().from(reconciliationProjectionOutbox)).toHaveLength(2);
  });

  it('does not repair rejected outputs back into actionable approval rows', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'telegram',
      contentText: 'Maybe create a speculative Acme task.',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'team',
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create speculative Acme task',
      dedupeKey: 'reconciliation-projection-repair-rejected',
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Create speculative Acme task',
          dedupeKey: 'reconciliation-projection-repair-rejected:item',
          proposedPayload: { canonicalName: 'Create speculative Acme task' },
        },
      ],
    });
    const outputId = bundle.items[0]?.metadata.reconciliation_output_id;
    if (typeof outputId !== 'string') throw new Error('expected reconciliation output id');

    await expect(scope.suggestions.rejectSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );
    await db.delete(agentSuggestions).where(eq(agentSuggestions.id, bundle.id));

    await expect(scope.suggestions.repairApprovalProjectionForOutput(outputId)).resolves.toBeNull();
    expect(await db.select().from(agentSuggestions)).toHaveLength(0);
    const outputs = await db.select().from(reconciliationOutputs);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.status).toBe('rejected');
  });

  it('suppresses exact rejected output replays at projection creation time', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'telegram',
      contentText: 'Maybe create the speculative Acme task.',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'team',
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const input = {
      source: 'background' as const,
      title: 'Create speculative Acme task',
      dedupeKey: 'reconciliation-projection-replay-rejected',
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
      items: [
        {
          operation: 'create' as const,
          targetKind: 'task' as const,
          title: 'Create speculative Acme task',
          dedupeKey: 'reconciliation-projection-replay-rejected:item',
          proposedPayload: { canonicalName: 'Create speculative Acme task' },
        },
      ],
    };

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle(input);
    const outputId = bundle.items[0]?.metadata.reconciliation_output_id;
    if (typeof outputId !== 'string') throw new Error('expected reconciliation output id');
    await expect(scope.suggestions.rejectSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );
    await db.delete(agentSuggestions).where(eq(agentSuggestions.id, bundle.id));

    const replayed = await scope.suggestions.createOrMergeSuggestionBundle(input);

    expect(replayed.status).toBe('rejected');
    expect(replayed.items).toHaveLength(1);
    expect(replayed.items[0]?.status).toBe('rejected');
    expect(replayed.items[0]?.metadata).toMatchObject({
      reconciliation_output_id: outputId,
      reconciliation_projection_suppressed: true,
    });
    await expect(scope.suggestions.listPendingSuggestions()).resolves.toEqual([]);
    const outputs = await db.select().from(reconciliationOutputs);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.id).toBe(outputId);
    expect(outputs[0]?.status).toBe('rejected');
  });

  it('does not repair approval outputs with invalid source refs', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const [run] = await db
      .insert(reconciliationRuns)
      .values({
        teamId: TEAM_ID,
        trigger: 'manual_repair',
        scope: 'approval_projection',
        status: 'completed',
        inputFingerprint: 'invalid-source-ref-repair-run',
        engineVersion: 'approval-projection-2026-06',
        completedAt: new Date('2026-06-20T10:00:00Z'),
      })
      .returning();
    if (!run) throw new Error('expected reconciliation run');
    const [output] = await db
      .insert(reconciliationOutputs)
      .values({
        teamId: TEAM_ID,
        runId: run.id,
        outputKind: 'approval_bundle',
        targetKind: 'task',
        operation: 'create',
        payload: {
          projection: 'agent_suggestions',
          suggestion_dedupe_key: 'invalid-source-ref-repair',
          suggestion_source: 'background',
          suggestion_title: 'Create task from invalid provenance',
          item_dedupe_key: 'invalid-source-ref-repair:item',
          title: 'Create task from invalid provenance',
          proposed_payload: { canonicalName: 'Create task from invalid provenance' },
        },
        authorityDecision: {
          decision: 'requires_approval',
          reason: 'test_invalid_source_refs',
          policy_version: 'timeline-owned-approval-2026-06',
        },
        requiresApproval: true,
        sourceRefs: [],
        sourcePayloadRefs: [],
        visibility: 'team',
        visibilityFloor: 'team',
        dedupeKey: 'invalid-source-ref-repair-output',
        status: 'pending',
      })
      .returning();
    if (!output) throw new Error('expected reconciliation output');

    await expect(
      scope.suggestions.repairApprovalProjectionForOutput(output.id),
    ).resolves.toBeNull();

    expect(await db.select().from(agentSuggestions)).toHaveLength(0);
  });

  it('mirrors accepted projection status and result ids back to reconciliation outputs', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'telegram',
      contentText: 'Create Acme onboarding as a customer project object.',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'team',
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create Acme onboarding project',
      dedupeKey: 'reconciliation-projection-accept',
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Create Acme onboarding project',
          dedupeKey: 'reconciliation-projection-accept:item',
          proposedPayload: {
            type: 'project',
            canonicalName: 'Acme onboarding',
          },
        },
      ],
    });

    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    const [acceptedItem] = await db.select().from(agentSuggestionItems);
    const outputs = await db.select().from(reconciliationOutputs);
    const projectionOutput = outputs.find(
      (output) => output.id === bundle.items[0]?.metadata.reconciliation_output_id,
    );
    const directWriteOutput = outputs.find(
      (output) => output.id !== bundle.items[0]?.metadata.reconciliation_output_id,
    );
    expect(acceptedItem?.resultId).toEqual(expect.any(String));
    expect(outputs).toHaveLength(2);
    expect(projectionOutput).toMatchObject({
      id: bundle.items[0]?.metadata.reconciliation_output_id,
      status: 'applied',
    });
    expect(projectionOutput?.payload).toMatchObject({
      projection_result_id: acceptedItem?.resultId,
    });
    expect(directWriteOutput).toMatchObject({
      outputKind: 'direct_write',
      targetKind: 'object',
      operation: 'create',
      targetId: acceptedItem?.resultId,
      status: 'applied',
    });

    const outboxRows = await db
      .select()
      .from(reconciliationProjectionOutbox)
      .orderBy(asc(reconciliationProjectionOutbox.createdAt));
    expect(outboxRows.map((row) => row.action)).toEqual(['create_projection', 'mark_applied']);
    expect(outboxRows[1]?.payload).toMatchObject({
      projection: 'agent_suggestions',
      projection_status: 'applied',
      suggestion_item_status: 'accepted',
      projection_result_id: acceptedItem?.resultId,
    });
  });

  it('mirrors failed projection status back to reconciliation outputs', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'telegram',
      contentText: 'Create an Acme kickoff calendar event, but the source omitted times.',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'team',
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create Acme kickoff hold',
      dedupeKey: 'reconciliation-projection-failed-calendar',
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Create Acme kickoff hold',
          dedupeKey: 'reconciliation-projection-failed-calendar:item',
          proposedPayload: {
            title: 'Acme kickoff hold',
          },
        },
      ],
    });

    await expect(
      scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? ''),
    ).rejects.toMatchObject({
      name: 'ExpectedSuggestionApplyFailure',
      code: 'TIMELINE_EXPECTED_SUGGESTION_APPLY_FAILURE',
    });

    const outputs = await db.select().from(reconciliationOutputs);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      id: bundle.items[0]?.metadata.reconciliation_output_id,
      status: 'failed',
    });
    expect(outputs[0]?.payload).toMatchObject({
      projection_failure_reason:
        'Calendar proposal is missing a start or end time. Reject it or revise the source details before accepting.',
    });

    const outboxRows = await db
      .select()
      .from(reconciliationProjectionOutbox)
      .orderBy(asc(reconciliationProjectionOutbox.createdAt));
    expect(outboxRows.map((row) => row.action)).toEqual(['create_projection', 'mark_failed']);
    expect(outboxRows[1]?.payload).toMatchObject({
      projection: 'agent_suggestions',
      projection_status: 'failed',
      suggestion_item_status: 'failed',
      projection_failure_reason:
        'Calendar proposal is missing a start or end time. Reject it or revise the source details before accepting.',
    });
  });

  it('mirrors superseded dependent projection status back to reconciliation outputs', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'telegram',
      contentText: 'Create Maybe Person, Maybe Company, and relate them.',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'team',
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create rejected dependency bundle',
      dedupeKey: 'reconciliation-projection-superseded-dependent',
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Create Maybe Person',
          dedupeKey: 'reconciliation-projection-superseded-dependent:person',
          proposedPayload: {
            type: 'person',
            canonicalName: 'Maybe Person',
            localRef: 'Maybe-Person',
          },
        },
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Create Maybe Company',
          dedupeKey: 'reconciliation-projection-superseded-dependent:company',
          proposedPayload: {
            type: 'company',
            canonicalName: 'Maybe Company',
            localRef: 'maybe-company',
          },
        },
        {
          operation: 'create',
          targetKind: 'object_relationship',
          title: 'Relate Maybe Person and Maybe Company',
          dedupeKey: 'reconciliation-projection-superseded-dependent:relationship',
          proposedPayload: {
            fromRef: 'maybe-person',
            toRef: 'maybe-company',
            kind: 'related',
          },
        },
      ],
    });
    const personItem = bundle.items.find((item) => item.title === 'Create Maybe Person');
    const relationshipItem = bundle.items.find(
      (item) => item.title === 'Relate Maybe Person and Maybe Company',
    );
    if (!personItem || !relationshipItem) throw new Error('expected dependency items');

    await expect(scope.suggestions.rejectSuggestionItem(personItem.id)).resolves.toBe(true);

    const outputs = await db.select().from(reconciliationOutputs);
    const relationshipOutput = outputs.find(
      (output) => output.id === relationshipItem.metadata.reconciliation_output_id,
    );
    expect(relationshipOutput).toMatchObject({
      status: 'superseded',
    });

    const outboxRows = await db
      .select()
      .from(reconciliationProjectionOutbox)
      .orderBy(asc(reconciliationProjectionOutbox.createdAt));
    expect(outboxRows.map((row) => row.action)).toEqual([
      'create_projection',
      'create_projection',
      'create_projection',
      'mark_rejected',
      'mark_superseded',
    ]);
    expect(outboxRows[4]).toMatchObject({
      outputId: relationshipOutput?.id,
      suggestionId: bundle.id,
      suggestionItemId: relationshipItem.id,
      status: 'processed',
    });
    expect(outboxRows[4]?.payload).toMatchObject({
      projection: 'agent_suggestions',
      projection_status: 'superseded',
      suggestion_item_status: 'superseded',
      projection_superseded_reason:
        'Relationship endpoint "Maybe-Person" was rejected or superseded.',
    });
  });
});
