import { PGlite } from '@electric-sql/pglite';
import {
  agentSuggestionEvidence,
  agentSuggestionItems,
  agentSuggestions,
  rawEvents,
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
      }),
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
    expect(repaired?.items.map((item) => item.title).sort()).toEqual([
      'Create Acme rollout task',
      'Schedule Acme kickoff',
    ]);
    expect(repaired?.items.map((item) => item.metadata.reconciliation_output_id).sort()).toEqual(
      [...outputIds].sort(),
    );
    expect(repaired?.evidence.map((evidence) => evidence.rawEventId)).toEqual([TEAM_RAW_EVENT_ID]);

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
    expect(acceptedItem?.resultId).toEqual(expect.any(String));
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      id: bundle.items[0]?.metadata.reconciliation_output_id,
      status: 'applied',
    });
    expect(outputs[0]?.payload).toMatchObject({
      projection_result_id: acceptedItem?.resultId,
    });

    const outboxRows = await db
      .select()
      .from(reconciliationProjectionOutbox)
      .orderBy(asc(reconciliationProjectionOutbox.createdAt));
    expect(outboxRows.map((row) => row.action)).toEqual(['create_projection', 'mark_applied']);
    expect(outboxRows[1]?.payload).toMatchObject({
      projection: 'agent_suggestions',
      projection_status: 'applied',
      projection_result_id: acceptedItem?.resultId,
    });
  });
});
