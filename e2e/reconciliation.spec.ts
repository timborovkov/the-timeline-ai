import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { getDb, getDbClient } from '@timeline/db';
import {
  closeReconciliationQueue,
  getReconciliationQueue,
  type ReconciliationJobData,
} from '@timeline/shared/queue';
import { withTeam } from '@timeline/shared/team-scope';

import { processReconciliationJob } from '../apps/worker/src/workers/reconciliation.js';
import { signIn } from './helpers.js';
import { E2E_PREFIX, e2eTeam, e2eUsers } from './test-data.js';

const PREFIX = `${E2E_PREFIX} reconciliation`;

const fixtures = {
  team: {
    rawEvent: randomUUID(),
    evidence: randomUUID(),
    cluster: randomUUID(),
    association: randomUUID(),
    output: randomUUID(),
    failedOutput: randomUUID(),
    target: randomUUID(),
    title: `${PREFIX} Launch Control`,
    rawText: `${PREFIX} Monday launch board linked to Sentry issue`,
    visibility: 'team',
  },
  private: {
    rawEvent: randomUUID(),
    evidence: randomUUID(),
    cluster: randomUUID(),
    association: randomUUID(),
    output: randomUUID(),
    target: randomUUID(),
    title: `${PREFIX} Private Renewal Escalation`,
    rawText: `${PREFIX} owner-private renewal escalation with legal context`,
    visibility: 'private',
    ownerUserId: e2eUsers.owner.id,
  },
  specific: {
    rawEvent: randomUUID(),
    evidence: randomUUID(),
    cluster: randomUUID(),
    association: randomUUID(),
    output: randomUUID(),
    target: randomUUID(),
    title: `${PREFIX} Admin Support Escalation`,
    rawText: `${PREFIX} admin-visible support escalation with implementation notes`,
    visibility: 'specific_users',
    userIds: [e2eUsers.admin.id],
  },
  workerRepair: {
    rawEvent: randomUUID(),
    cluster: randomUUID(),
    target: randomUUID(),
    title: `${PREFIX} Worker Repair Side Effects`,
    rawText: `${PREFIX} worker repaired object-linked evidence after manual reconcile`,
  },
  approval: {
    title: `${PREFIX} Approval Cross Link`,
    itemTitle: `${PREFIX} approve linked follow-up`,
    dedupeKey: `${PREFIX}:approval-cross-link`,
  },
  approvalActions: {
    acceptTitle: `${PREFIX} Approval Accept Edge`,
    acceptItemTitle: `${PREFIX} accepted approval task`,
    acceptDedupeKey: `${PREFIX}:approval-action:accept`,
    rejectTitle: `${PREFIX} Approval Reject Edge`,
    rejectItemTitle: `${PREFIX} rejected approval task`,
    rejectDedupeKey: `${PREFIX}:approval-action:reject`,
  },
  approvalBulkPartial: {
    title: `${PREFIX} Approval Bulk Partial`,
    taskTitle: `${PREFIX} bulk accepted task`,
    calendarTitle: `${PREFIX} malformed bulk meeting`,
    dedupeKey: `${PREFIX}:approval-bulk-partial`,
  },
} as const;

const runId = randomUUID();
const runHistoryIds = Array.from({ length: 13 }, () => randomUUID());

type ReconciliationQueueFilter = (data: ReconciliationJobData) => boolean;

function queuedReconciliationJobStates() {
  return ['waiting', 'delayed', 'prioritized', 'paused'] as const;
}

async function queuedReconciliationJobs(
  filter: ReconciliationQueueFilter,
): Promise<ReconciliationJobData[]> {
  const queue = getReconciliationQueue();
  const jobs = await queue.getJobs(queuedReconciliationJobStates());
  return jobs.map((job) => job.data).filter(filter);
}

async function removeQueuedReconciliationJobs(filter: ReconciliationQueueFilter): Promise<void> {
  const queue = getReconciliationQueue();
  const jobs = await queue.getJobs(queuedReconciliationJobStates());
  await Promise.all(
    jobs.filter((job) => filter(job.data)).map((job) => job.remove().catch(() => undefined)),
  );
}

async function processQueuedReconciliationJobs(filter: ReconciliationQueueFilter): Promise<void> {
  const queue = getReconciliationQueue();
  const jobs = await queue.getJobs(queuedReconciliationJobStates());
  for (const job of jobs.filter((candidate) => filter(candidate.data))) {
    await processReconciliationJob(getDb(), job.data);
    await job.remove().catch(() => undefined);
  }
}

function isQueuedManualReconcileJob(
  data: ReconciliationJobData,
  scope: 'team' | 'cluster',
  targetId?: string,
): boolean {
  return (
    data.kind === 'scope_reconcile' &&
    data.teamId === e2eTeam.id &&
    data.scope === scope &&
    data.triggeredBy === e2eUsers.owner.id &&
    data.reason === 'admin_dashboard' &&
    (targetId === undefined ? data.targetId === undefined : data.targetId === targetId)
  );
}

async function queuedManualReconcileJobs(
  scope: 'team' | 'cluster',
  targetId?: string,
): Promise<ReconciliationJobData[]> {
  return queuedReconciliationJobs((data) => isQueuedManualReconcileJob(data, scope, targetId));
}

function isQueuedAuditOrBackfillJob(data: ReconciliationJobData): boolean {
  return (
    data.teamId === e2eTeam.id &&
    data.triggeredBy === e2eUsers.owner.id &&
    ((data.kind === 'evidence_audit' && data.source === 'email') ||
      (data.kind === 'evidence_backfill' &&
        data.source === 'integration' &&
        data.dryRun === true &&
        data.missingOnly === true))
  );
}

async function removeQueuedReconciliationTestJobs(): Promise<void> {
  await removeQueuedReconciliationJobs(
    (data) =>
      isQueuedManualReconcileJob(data, 'team') ||
      isQueuedManualReconcileJob(data, 'cluster', fixtures.team.cluster) ||
      isQueuedAuditOrBackfillJob(data),
  );
}

async function cleanupReconciliationSeed(): Promise<void> {
  const sql = getDbClient();
  await sql`DELETE FROM entities WHERE team_id = ${e2eTeam.id} AND canonical_name IN (${fixtures.approvalActions.acceptItemTitle}, ${fixtures.approvalActions.rejectItemTitle}, ${fixtures.approvalBulkPartial.taskTitle})`;
  await sql`DELETE FROM agent_suggestions WHERE team_id = ${e2eTeam.id} AND dedupe_key = ${fixtures.approvalBulkPartial.dedupeKey}`;
  await sql`DELETE FROM reconciliation_outputs WHERE team_id = ${e2eTeam.id} AND payload ->> 'suggestion_dedupe_key' = ${fixtures.approvalBulkPartial.dedupeKey}`;
  await sql`DELETE FROM agent_suggestions WHERE team_id = ${e2eTeam.id} AND dedupe_key LIKE ${`${PREFIX}:approval-action:%`}`;
  await sql`DELETE FROM reconciliation_outputs WHERE team_id = ${e2eTeam.id} AND payload ->> 'suggestion_dedupe_key' LIKE ${`${PREFIX}:approval-action:%`}`;
  await sql`DELETE FROM agent_suggestions WHERE team_id = ${e2eTeam.id} AND dedupe_key = ${fixtures.approval.dedupeKey}`;
  await sql`DELETE FROM reconciliation_outputs WHERE team_id = ${e2eTeam.id} AND payload ->> 'suggestion_dedupe_key' = ${fixtures.approval.dedupeKey}`;
  for (const fixture of Object.values(fixtures)) {
    if (!('output' in fixture)) continue;
    if ('failedOutput' in fixture) {
      await sql`DELETE FROM reconciliation_outputs WHERE id = ${fixture.failedOutput}`;
    }
    await sql`DELETE FROM reconciliation_outputs WHERE id = ${fixture.output}`;
    await sql`DELETE FROM artifact_evidence_associations WHERE id = ${fixture.association}`;
    await sql`DELETE FROM reconciliation_evidence WHERE id = ${fixture.evidence}`;
    await sql`DELETE FROM artifact_clusters WHERE id = ${fixture.cluster}`;
    await sql`DELETE FROM raw_events WHERE id = ${fixture.rawEvent}`;
  }
  await sql`DELETE FROM reconciliation_outputs WHERE cluster_id = ${fixtures.workerRepair.cluster}`;
  await sql`DELETE FROM artifact_evidence_associations WHERE cluster_id = ${fixtures.workerRepair.cluster}`;
  await sql`DELETE FROM reconciliation_evidence WHERE raw_event_id = ${fixtures.workerRepair.rawEvent}`;
  await sql`DELETE FROM artifact_cluster_anchors WHERE cluster_id = ${fixtures.workerRepair.cluster}`;
  await sql`DELETE FROM artifact_clusters WHERE id = ${fixtures.workerRepair.cluster}`;
  await sql`DELETE FROM raw_events WHERE id = ${fixtures.workerRepair.rawEvent}`;
  await sql`DELETE FROM reconciliation_runs WHERE team_id = ${e2eTeam.id} AND scope IN ('evidence_audit:email', 'evidence_backfill:integration')`;
  await sql`DELETE FROM reconciliation_runs WHERE team_id = ${e2eTeam.id} AND scope = ${`object:${fixtures.workerRepair.target}`}`;
  await sql`DELETE FROM reconciliation_runs WHERE team_id = ${e2eTeam.id} AND scope LIKE ${`${PREFIX}:run-history:%`}`;
  await sql`DELETE FROM entities WHERE id = ${fixtures.workerRepair.target}`;
  await sql`DELETE FROM reconciliation_runs WHERE id = ${runId}`;
}

async function seedReconciliationState(): Promise<void> {
  const sql = getDbClient();
  await cleanupReconciliationSeed();
  const now = new Date().toISOString();

  await sql`
    INSERT INTO reconciliation_runs (
      id,
      team_id,
      trigger,
      scope,
      status,
      input_fingerprint,
      engine_version,
      started_at,
      completed_at,
      metrics
    )
    VALUES (
      ${runId},
      ${e2eTeam.id},
      'manual_repair',
      'scope_reconcile:team',
      'completed',
      ${`${PREFIX}:run:${runId}`},
      'e2e-reconciliation-2026-07',
      ${now},
      ${now},
      ${JSON.stringify({
        mode: 'manual_repair',
        target_id: null,
        output_count: 2,
        association_count: 1,
        cluster_count: 3,
        evidence_backfilled: 1,
        association_repair_count: 1,
        projection_repair_count: 1,
      })}::jsonb
    )
  `;

  for (const [index, historyRunId] of runHistoryIds.entries()) {
    const createdAt = new Date(Date.now() - index * 1_000).toISOString();
    await sql`
      INSERT INTO reconciliation_runs (
        id,
        team_id,
        trigger,
        scope,
        status,
        input_fingerprint,
        engine_version,
        started_at,
        completed_at,
        created_at,
        metrics
      )
      VALUES (
        ${historyRunId},
        ${e2eTeam.id},
        'eval',
        ${`${PREFIX}:run-history:${String(index + 1).padStart(2, '0')}`},
        'completed',
        ${`${PREFIX}:run-history:${historyRunId}`},
        'e2e-reconciliation-history-2026-07',
        ${createdAt},
        ${createdAt},
        ${createdAt},
        ${JSON.stringify({
          mode: 'production_sampling',
          run_kind: 'e2e_history',
          sample_count: 1,
          failed_count: 0,
          unconfirmed_fixture_candidate_count: 0,
        })}::jsonb
      )
    `;
  }

  for (const fixture of Object.values(fixtures)) {
    if (!('evidence' in fixture)) continue;
    const sourceRef = [{ source: 'integration', rawEventId: fixture.rawEvent }];
    const sourcePayloadRef = `inline://e2e/reconciliation/${fixture.rawEvent}`;
    const evidenceKey = fixture.rawEvent.replaceAll('-', '');
    const visibilityUserIds = fixture.userIds?.[0]
      ? sql`ARRAY[${fixture.userIds[0]}]::uuid[]`
      : sql`NULL::uuid[]`;
    const ownerUserId = fixture.ownerUserId ?? null;

    await sql`
      INSERT INTO raw_events (
        id,
        team_id,
        author_user_id,
        source,
        content_text,
        occurred_at,
        visibility,
        visibility_owner_user_id,
        visibility_user_ids,
        source_metadata
      )
      VALUES (
        ${fixture.rawEvent},
        ${e2eTeam.id},
        ${e2eUsers.owner.id},
        'integration',
        ${fixture.rawText},
        ${now},
        ${fixture.visibility},
        ${ownerUserId},
        ${visibilityUserIds},
        ${JSON.stringify({
          provider: 'monday',
          source_payload_ref: sourcePayloadRef,
          payload_digest: `sha256:${evidenceKey}${'1'.repeat(32)}`,
        })}::jsonb
      )
    `;

    await sql`
      INSERT INTO artifact_clusters (
        id,
        team_id,
        artifact_cluster_kind,
        artifact_type,
        canonical_name,
        status,
        metadata
      )
      VALUES (
        ${fixture.cluster},
        ${e2eTeam.id},
        'customer_project',
        'project',
        ${fixture.title},
        'active',
        ${JSON.stringify({ e2e: true, visibility: fixture.visibility })}::jsonb
      )
    `;

    await sql`
      INSERT INTO reconciliation_evidence (
        id,
        team_id,
        raw_event_id,
        source_payload_ref,
        payload_digest,
        source,
        provider,
        external_object_id,
        event_type,
        occurred_at,
        visibility,
        visibility_owner_user_id,
        visibility_user_ids,
        actor,
        content_digest,
        title,
        summary,
        metadata,
        normalizer_version,
        replay_state,
        dedupe_key
      )
      VALUES (
        ${fixture.evidence},
        ${e2eTeam.id},
        ${fixture.rawEvent},
        ${sourcePayloadRef},
        ${`sha256:${evidenceKey}${'1'.repeat(32)}`},
        'integration',
        'monday',
        ${`${evidenceKey}-launch-control`},
        'monday.item.updated',
        ${now},
        ${fixture.visibility},
        ${ownerUserId},
        ${visibilityUserIds},
        ${JSON.stringify({ displayName: 'Monday Bot' })}::jsonb,
        ${`sha256:${evidenceKey}${'2'.repeat(32)}`},
        ${fixture.title},
        'Monday project evidence linked to a customer launch.',
        ${JSON.stringify({ e2e: true, visibility: fixture.visibility })}::jsonb,
        'e2e-reconciliation-2026-07',
        'full',
        ${`${PREFIX}:evidence:${fixture.rawEvent}`}
      )
    `;

    await sql`
      INSERT INTO artifact_evidence_associations (
        id,
        team_id,
        cluster_id,
        evidence_id,
        raw_event_id,
        role,
        strength,
        confidence,
        association_source,
        rationale,
        source_refs,
        visibility,
        visibility_owner_user_id,
        visibility_user_ids,
        visibility_floor,
        visibility_floor_owner_user_id,
        visibility_floor_user_ids,
        metadata,
        dedupe_key
      )
      VALUES (
        ${fixture.association},
        ${e2eTeam.id},
        ${fixture.cluster},
        ${fixture.evidence},
        ${fixture.rawEvent},
        'origin',
        'hard',
        'high',
        'hard_anchor',
        'Provider payload carried a durable Monday item identity.',
        ${JSON.stringify(sourceRef)}::jsonb,
        ${fixture.visibility},
        ${ownerUserId},
        ${visibilityUserIds},
        ${fixture.visibility},
        ${ownerUserId},
        ${visibilityUserIds},
        ${JSON.stringify({ e2e: true, visibility: fixture.visibility })}::jsonb,
        ${`${PREFIX}:association:${fixture.cluster}:${fixture.evidence}`}
      )
    `;

    await sql`
      INSERT INTO reconciliation_outputs (
        id,
        team_id,
        run_id,
        cluster_id,
        output_kind,
        target_kind,
        operation,
        target_id,
        payload,
        authority_decision,
        confidence,
        requires_approval,
        source_refs,
        source_payload_refs,
        visibility,
        visibility_owner_user_id,
        visibility_user_ids,
        visibility_floor,
        visibility_floor_owner_user_id,
        visibility_floor_user_ids,
        dedupe_key,
        status
      )
      VALUES (
        ${fixture.output},
        ${e2eTeam.id},
        ${runId},
        ${fixture.cluster},
        'observed_association',
        'cluster_identity',
        'link',
        ${fixture.target},
        ${JSON.stringify({ e2e: true, canonicalName: fixture.title })}::jsonb,
        ${JSON.stringify({
          decision: 'direct_write',
          authority_decision: 'provider_record',
          policy_version: 'e2e-reconciliation-2026-07',
        })}::jsonb,
        'high',
        false,
        ${JSON.stringify(sourceRef)}::jsonb,
        ${JSON.stringify([sourcePayloadRef])}::jsonb,
        ${fixture.visibility},
        ${ownerUserId},
        ${visibilityUserIds},
        ${fixture.visibility},
        ${ownerUserId},
        ${visibilityUserIds},
        ${`${PREFIX}:output:${fixture.output}`},
        'applied'
      )
    `;

    if ('failedOutput' in fixture) {
      await sql`
        INSERT INTO reconciliation_outputs (
          id,
          team_id,
          run_id,
          cluster_id,
          output_kind,
          target_kind,
          operation,
          target_id,
          payload,
          authority_decision,
          confidence,
          requires_approval,
          source_refs,
          source_payload_refs,
          visibility,
          visibility_owner_user_id,
          visibility_user_ids,
          visibility_floor,
          visibility_floor_owner_user_id,
          visibility_floor_user_ids,
          dedupe_key,
          status
        )
        VALUES (
          ${fixture.failedOutput},
          ${e2eTeam.id},
          ${runId},
          ${fixture.cluster},
          'approval_bundle',
          'object',
          'update',
          ${fixture.target},
          ${JSON.stringify({
            e2e: true,
            reason: 'approval projection failed before repair',
            canonicalName: fixture.title,
          })}::jsonb,
          ${JSON.stringify({
            decision: 'requires_approval',
            reason: 'e2e_failed_projection',
            policy_version: 'e2e-reconciliation-2026-07',
          })}::jsonb,
          'medium',
          true,
          ${JSON.stringify(sourceRef)}::jsonb,
          ${JSON.stringify([sourcePayloadRef])}::jsonb,
          ${fixture.visibility},
          ${ownerUserId},
          ${visibilityUserIds},
          ${fixture.visibility},
          ${ownerUserId},
          ${visibilityUserIds},
          ${`${PREFIX}:failed-output:${fixture.failedOutput}`},
          'failed'
        )
      `;
    }
  }

  await seedApprovalCrossLinkState();
  await seedWorkerRepairState();
}

async function seedApprovalCrossLinkState(): Promise<void> {
  const sql = getDbClient();
  const bundle = await withTeam(
    getDb(),
    e2eTeam.id,
    e2eUsers.owner.id,
  ).suggestions.createOrMergeSuggestionBundle({
    source: 'background',
    title: fixtures.approval.title,
    summary: 'Approval should link back to its reconciliation cluster.',
    reason: 'Operator needs to inspect the source reconciliation output before accepting.',
    dedupeKey: fixtures.approval.dedupeKey,
    evidence: [{ rawEventId: fixtures.team.rawEvent }],
    items: [
      {
        operation: 'create',
        targetKind: 'task',
        title: fixtures.approval.itemTitle,
        dedupeKey: `${fixtures.approval.dedupeKey}:task`,
        proposedPayload: { canonicalName: fixtures.approval.itemTitle },
      },
    ],
  });
  const outputId = bundle.items[0]?.metadata.reconciliation_output_id;
  if (typeof outputId !== 'string') throw new Error('expected approval reconciliation output id');

  await sql`
    UPDATE reconciliation_outputs
    SET cluster_id = ${fixtures.team.cluster}
    WHERE team_id = ${e2eTeam.id}
      AND id = ${outputId}
  `;
  await sql`
    UPDATE agent_suggestions
    SET metadata = metadata || ${JSON.stringify({
      reconciliation_cluster_ids: [fixtures.team.cluster],
    })}::jsonb
    WHERE team_id = ${e2eTeam.id}
      AND id = ${bundle.id}
  `;
  await sql`
    UPDATE agent_suggestion_items
    SET metadata = metadata || ${JSON.stringify({
      reconciliation_cluster_id: fixtures.team.cluster,
    })}::jsonb
    WHERE team_id = ${e2eTeam.id}
      AND id = ${bundle.items[0]?.id}
  `;
}

async function seedApprovalActionBundle(input: {
  title: string;
  itemTitle: string;
  dedupeKey: string;
}): Promise<void> {
  await withTeam(getDb(), e2eTeam.id, e2eUsers.owner.id).suggestions.createOrMergeSuggestionBundle({
    source: 'background',
    title: input.title,
    summary: 'Approval action edge-state coverage.',
    reason: 'Browser should apply or reject exactly one approval row.',
    dedupeKey: input.dedupeKey,
    items: [
      {
        operation: 'create',
        targetKind: 'task',
        title: input.itemTitle,
        dedupeKey: `${input.dedupeKey}:task`,
        proposedPayload: {
          canonicalName: input.itemTitle,
          priority: input.dedupeKey.endsWith(':accept') ? 1 : 4,
        },
      },
    ],
  });
}

async function seedApprovalBulkPartialBundle(): Promise<void> {
  await withTeam(getDb(), e2eTeam.id, e2eUsers.owner.id).suggestions.createOrMergeSuggestionBundle({
    source: 'background',
    title: fixtures.approvalBulkPartial.title,
    summary: 'Bulk approval should keep only failed rows retryable.',
    reason: 'Operator needs partial-failure feedback when one item applies and another fails.',
    dedupeKey: fixtures.approvalBulkPartial.dedupeKey,
    items: [
      {
        operation: 'create',
        targetKind: 'task',
        title: fixtures.approvalBulkPartial.taskTitle,
        dedupeKey: `${fixtures.approvalBulkPartial.dedupeKey}:task`,
        proposedPayload: {
          canonicalName: fixtures.approvalBulkPartial.taskTitle,
          priority: 2,
        },
      },
      {
        operation: 'create',
        targetKind: 'calendar_event',
        title: fixtures.approvalBulkPartial.calendarTitle,
        dedupeKey: `${fixtures.approvalBulkPartial.dedupeKey}:calendar`,
        proposedPayload: {
          title: fixtures.approvalBulkPartial.calendarTitle,
        },
      },
    ],
  });
}

async function countEntitiesByName(canonicalName: string): Promise<number> {
  const sql = getDbClient();
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text
    FROM entities
    WHERE team_id = ${e2eTeam.id}
      AND canonical_name = ${canonicalName}
  `;
  return Number(rows[0]?.count ?? '0');
}

async function countSuggestionItemsByBundleDedupe(
  dedupeKey: string,
  status: 'accepted' | 'rejected' | 'failed' | 'pending',
): Promise<number> {
  const sql = getDbClient();
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text
    FROM agent_suggestions s
    JOIN agent_suggestion_items i ON i.suggestion_id = s.id
    WHERE s.team_id = ${e2eTeam.id}
      AND s.dedupe_key = ${dedupeKey}
      AND i.status = ${status}
  `;
  return Number(rows[0]?.count ?? '0');
}

async function seedWorkerRepairState(): Promise<void> {
  const sql = getDbClient();
  const now = new Date().toISOString();

  await sql`
    INSERT INTO entities (
      id,
      team_id,
      type,
      canonical_name
    )
    VALUES (
      ${fixtures.workerRepair.target},
      ${e2eTeam.id},
      'project',
      ${fixtures.workerRepair.title}
    )
  `;

  await sql`
    INSERT INTO artifact_clusters (
      id,
      team_id,
      artifact_type,
      artifact_cluster_kind,
      canonical_name,
      canonical_entity_id,
      status
    )
    VALUES (
      ${fixtures.workerRepair.cluster},
      ${e2eTeam.id},
      'project',
      'customer_project',
      ${fixtures.workerRepair.title},
      ${fixtures.workerRepair.target},
      'active'
    )
  `;

  await sql`
    INSERT INTO raw_events (
      id,
      team_id,
      author_user_id,
      source,
      content_text,
      occurred_at,
      visibility,
      source_metadata
    )
    VALUES (
      ${fixtures.workerRepair.rawEvent},
      ${e2eTeam.id},
      ${e2eUsers.owner.id},
      'email',
      ${fixtures.workerRepair.rawText},
      ${now},
      'team',
      ${JSON.stringify({
        entity_id: fixtures.workerRepair.target,
        message_id: `${PREFIX}:worker-repair-message`,
        source_payload_ref: `inline://e2e/reconciliation/worker-repair/${fixtures.workerRepair.rawEvent}`,
        source_snapshot: {
          subject: fixtures.workerRepair.title,
          body: fixtures.workerRepair.rawText,
        },
      })}::jsonb
    )
  `;

  await processReconciliationJob(getDb(), {
    kind: 'scope_reconcile',
    teamId: e2eTeam.id,
    scope: 'object',
    targetId: fixtures.workerRepair.target,
    triggeredBy: e2eUsers.owner.id,
    reason: 'e2e_worker_repair',
  });
}

async function openAdvancedTools(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  const details = page.locator('details').filter({ hasText: 'Advanced tools' });
  await expect(details).toBeVisible();
  if (!(await details.evaluate((element: HTMLDetailsElement) => element.open))) {
    await details.locator('summary').click();
  }
  await expect(page.getByRole('heading', { name: 'Manual reconcile' })).toBeVisible();
}

test.describe.serial('reconciliation dashboard', () => {
  test.beforeAll(seedReconciliationState);
  test.afterAll(async () => {
    await cleanupReconciliationSeed();
    await removeQueuedReconciliationTestJobs();
    await closeReconciliationQueue();
  });

  test('renders persisted artifact reconciliation state and cluster drilldown', async ({
    page,
  }) => {
    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/team/reconciliation');

    await expect(page.getByRole('heading', { name: 'Reconciliation', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check coverage' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview repair' })).toBeVisible();
    await expect(page.getByText(fixtures.team.title).first()).toBeVisible();
    await expect(page.getByText('Customer project').first()).toBeVisible();
    await openAdvancedTools(page);
    await expect(page.getByText('customer_project').first()).toBeVisible();
    await expect(page.getByText('observed_association').first()).toBeVisible();
    await expect(page.getByText('approval_bundle').first()).toBeVisible();
    await expect(page.getByText('failed').first()).toBeVisible();
    await expect(page.getByText('evidence').first()).toBeVisible();
    await expect(page.getByText('projections').first()).toBeVisible();
    await expect(page.getByText(fixtures.workerRepair.title).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check coverage' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview repair' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reconcile' })).toBeVisible();

    await page.getByRole('link', { name: new RegExp(fixtures.team.title) }).click();
    await expect(page).toHaveURL(
      new RegExp(`/app/team/reconciliation/clusters/${fixtures.team.cluster}`),
    );
    await expect(
      page.getByRole('heading', { name: fixtures.team.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Evidence' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Outputs' })).toBeVisible();
    const teamEvidence = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Evidence' }) });
    await expect(page.getByText(fixtures.team.rawText)).toBeVisible();
    await expect(
      teamEvidence.locator(`[title*="${fixtures.team.rawEvent}"]`).first(),
    ).toBeVisible();

    await page.goto(`/app/team/reconciliation/clusters/${fixtures.workerRepair.cluster}`);
    await expect(
      page.getByRole('heading', { name: fixtures.workerRepair.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(fixtures.workerRepair.rawText)).toBeVisible();
    const repairEvidence = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Evidence' }) });
    await expect(
      repairEvidence.locator(`[title*="${fixtures.workerRepair.rawEvent}"]`).first(),
    ).toBeVisible();
  });

  test('surfaces operator errors from invalid manual reconciliation requests', async ({ page }) => {
    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/team/reconciliation');
    await openAdvancedTools(page);
    await page.getByLabel('Scope').selectOption('object');
    await page.getByRole('button', { name: 'Reconcile' }).click();

    await expect(page).toHaveURL(/reconciliationNotice=error/);
    await expect(
      page.getByText('Object and cluster reconciliation require a target id'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Reconciliation', exact: true })).toBeVisible();
  });

  test('filters and paginates run history from the dashboard', async ({ page }) => {
    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/team/reconciliation');
    await openAdvancedTools(page);
    await page.getByLabel('Status').selectOption('completed');
    await expect(page).toHaveURL(/runStatus=completed/);
    await openAdvancedTools(page);
    await page.getByLabel('Trigger').selectOption('eval');

    await expect(page).toHaveURL(/runTrigger=eval/);
    await openAdvancedTools(page);
    await expect(page.getByText('Showing page 1 of 2')).toBeVisible();
    await expect(page.getByText(`${PREFIX}:run-history:01`)).toBeVisible();
    await expect(page.getByText(`${PREFIX}:run-history:13`)).toHaveCount(0);

    await page.getByRole('link', { name: 'Next' }).click();
    await expect(page).toHaveURL(/runPage=2/);
    await openAdvancedTools(page);
    await expect(page.getByText('Showing page 2 of 2')).toBeVisible();
    await expect(page.getByText(`${PREFIX}:run-history:13`)).toBeVisible();
    await expect(page.getByText(`${PREFIX}:run-history:01`)).toHaveCount(0);
  });

  test('links approval queue rows back to reconciliation cluster context', async ({ page }) => {
    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/approvals');

    const approval = page.locator('article').filter({ hasText: fixtures.approval.title });
    await expect(approval).toBeVisible();
    await expect(approval.getByText('Technical details')).toHaveCount(0);
    await expect(approval.getByText('Open processing record')).toHaveCount(0);
    await approval
      .getByRole('button', { name: new RegExp(`Preview ${fixtures.approval.title}`) })
      .click();
    await expect(page.getByText(/Proposed record|Current record/)).toBeVisible();

    await page.goto(`/app/team/reconciliation/clusters/${fixtures.team.cluster}`);
    await expect(
      page.getByRole('heading', { name: fixtures.team.title, exact: true }),
    ).toBeVisible();
  });

  test('applies accept and reject approval queue actions from the browser', async ({ page }) => {
    await seedApprovalActionBundle({
      title: fixtures.approvalActions.acceptTitle,
      itemTitle: fixtures.approvalActions.acceptItemTitle,
      dedupeKey: fixtures.approvalActions.acceptDedupeKey,
    });
    await seedApprovalActionBundle({
      title: fixtures.approvalActions.rejectTitle,
      itemTitle: fixtures.approvalActions.rejectItemTitle,
      dedupeKey: fixtures.approvalActions.rejectDedupeKey,
    });

    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/approvals');

    const acceptApproval = page
      .locator('article')
      .filter({ hasText: fixtures.approvalActions.acceptTitle });
    await expect(acceptApproval).toBeVisible();
    await acceptApproval
      .getByRole('button', { name: `Accept ${fixtures.approvalActions.acceptItemTitle}` })
      .click();
    await expect(page.getByText(fixtures.approvalActions.acceptItemTitle)).toHaveCount(0);
    await expect.poll(() => countEntitiesByName(fixtures.approvalActions.acceptItemTitle)).toBe(1);
    await expect
      .poll(() =>
        countSuggestionItemsByBundleDedupe(fixtures.approvalActions.acceptDedupeKey, 'accepted'),
      )
      .toBe(1);

    const rejectApproval = page
      .locator('article')
      .filter({ hasText: fixtures.approvalActions.rejectTitle });
    await expect(rejectApproval).toBeVisible();
    await rejectApproval
      .getByRole('button', { name: `Reject ${fixtures.approvalActions.rejectItemTitle}` })
      .click();
    await expect(page.getByText(fixtures.approvalActions.rejectItemTitle)).toHaveCount(0);
    await expect.poll(() => countEntitiesByName(fixtures.approvalActions.rejectItemTitle)).toBe(0);
    await expect
      .poll(() =>
        countSuggestionItemsByBundleDedupe(fixtures.approvalActions.rejectDedupeKey, 'rejected'),
      )
      .toBe(1);
  });

  test('moves failed rows to the Failed filter after partial bulk approval', async ({ page }) => {
    await seedApprovalBulkPartialBundle();
    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/approvals');

    const approval = page
      .locator('article')
      .filter({ hasText: fixtures.approvalBulkPartial.title });
    await expect(approval).toBeVisible();
    await approval
      .getByRole('checkbox', { name: `Select ${fixtures.approvalBulkPartial.taskTitle}` })
      .check();
    await approval
      .getByRole('checkbox', { name: `Select ${fixtures.approvalBulkPartial.calendarTitle}` })
      .check();
    await page.getByRole('button', { name: 'Accept', exact: true }).click();

    await expect(approval.getByText(fixtures.approvalBulkPartial.taskTitle)).toHaveCount(0);
    await expect(
      approval.getByText(fixtures.approvalBulkPartial.calendarTitle, { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'failed 1' })).toBeVisible();

    await page.goto('/app/approvals?status=failed');
    const failedApproval = page
      .locator('article')
      .filter({ hasText: fixtures.approvalBulkPartial.title });
    await expect(
      failedApproval.getByText(fixtures.approvalBulkPartial.calendarTitle, { exact: true }),
    ).toBeVisible();
    await expect(
      failedApproval.getByText(
        'Calendar proposal is missing a start or end time. Reject it or revise the source details before accepting.',
      ),
    ).toBeVisible();
    await expect.poll(() => countEntitiesByName(fixtures.approvalBulkPartial.taskTitle)).toBe(1);
    await expect
      .poll(() => countEntitiesByName(fixtures.approvalBulkPartial.calendarTitle))
      .toBe(0);
  });

  test('queues team and cluster manual reconciliation from the dashboard', async ({ page }) => {
    await removeQueuedReconciliationTestJobs();
    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/team/reconciliation');
    await openAdvancedTools(page);
    await page.getByRole('button', { name: 'Reconcile' }).click();
    await expect(page).toHaveURL(/reconciliationNotice=queued/);
    await expect(page.getByText('Queued manual reconciliation for the team.')).toBeVisible();

    await openAdvancedTools(page);
    await page.getByLabel('Scope').selectOption('cluster');
    await page.getByLabel('Target id').fill(fixtures.team.cluster);
    await page.getByRole('button', { name: 'Reconcile' }).click();
    await expect(page).toHaveURL(/reconciliationNotice=queued/);
    await expect(
      page.getByText(`Queued manual reconciliation for cluster ${fixtures.team.cluster}.`),
    ).toBeVisible();

    await expect.poll(() => queuedManualReconcileJobs('team')).toHaveLength(1);
    await expect
      .poll(() => queuedManualReconcileJobs('cluster', fixtures.team.cluster))
      .toHaveLength(1);
  });

  test('queues and processes source audit and dry-run backfill from the dashboard', async ({
    page,
  }) => {
    await removeQueuedReconciliationTestJobs();
    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/team/reconciliation');

    await page.locator('select[name="source"]').selectOption('email');
    await page.getByRole('button', { name: 'Check coverage' }).click();
    await expect(page).toHaveURL(/reconciliationNotice=queued/);
    await expect(page.getByText('Queued audit for email.')).toBeVisible();

    await page.locator('select[name="source"]').selectOption('integration');
    await page.getByRole('button', { name: 'Preview repair' }).click();
    await expect(page).toHaveURL(/reconciliationNotice=queued/);
    await expect(page.getByText('Queued missing-only backfill for integration.')).toBeVisible();

    await expect
      .poll(() =>
        queuedReconciliationJobs(
          (data) =>
            data.kind === 'evidence_audit' &&
            data.teamId === e2eTeam.id &&
            data.source === 'email' &&
            data.limit === 5_000 &&
            data.pageSize === 500 &&
            data.triggeredBy === e2eUsers.owner.id,
        ),
      )
      .toHaveLength(1);
    await expect
      .poll(() =>
        queuedReconciliationJobs(
          (data) =>
            data.kind === 'evidence_backfill' &&
            data.teamId === e2eTeam.id &&
            data.source === 'integration' &&
            data.limit === 5_000 &&
            data.pageSize === 500 &&
            data.dryRun === true &&
            data.missingOnly === true &&
            data.triggeredBy === e2eUsers.owner.id,
        ),
      )
      .toHaveLength(1);

    await processQueuedReconciliationJobs(isQueuedAuditOrBackfillJob);
    await page.goto('/app/team/reconciliation');
    await openAdvancedTools(page);
    await expect(page.getByText('evidence_audit:email')).toBeVisible();
    await expect(page.getByText('release passed')).toBeVisible();
    await expect(page.getByText('missing').first()).toBeVisible();
    await expect(page.getByText('evidence_backfill:integration')).toBeVisible();
    await expect(page.getByText('candidates')).toBeVisible();
    await expect(page.getByText('normalized').first()).toBeVisible();
  });

  test('filters private and specific-user clusters for the active viewer', async ({ browser }) => {
    test.setTimeout(120_000);
    const owner = await browser.newPage();
    await signIn(owner, e2eUsers.owner.email);
    await owner.goto('/app/team/reconciliation');

    await expect(owner.getByText(fixtures.team.title).first()).toBeVisible();
    await expect(owner.getByText(fixtures.private.title).first()).toBeVisible();
    await expect(owner.getByText(fixtures.specific.title)).toHaveCount(0);
    await owner.goto(`/app/team/reconciliation/clusters/${fixtures.private.cluster}`);
    await expect(
      owner.getByRole('heading', { name: fixtures.private.title, exact: true }),
    ).toBeVisible();
    await owner.goto(`/app/team/reconciliation/clusters/${fixtures.specific.cluster}`);
    await expect(owner.getByRole('heading', { name: 'Page not found' })).toBeVisible();

    const admin = await browser.newPage();
    await signIn(admin, e2eUsers.admin.email);
    await admin.goto('/app/team/reconciliation');

    await expect(admin.getByText(fixtures.team.title).first()).toBeVisible();
    await expect(admin.getByText(fixtures.specific.title).first()).toBeVisible();
    await expect(admin.getByText(fixtures.private.title)).toHaveCount(0);
    await admin.goto(`/app/team/reconciliation/clusters/${fixtures.specific.cluster}`);
    await expect(
      admin.getByRole('heading', { name: fixtures.specific.title, exact: true }),
    ).toBeVisible();
    await admin.goto(`/app/team/reconciliation/clusters/${fixtures.private.cluster}`);
    await expect(admin.getByRole('heading', { name: 'Page not found' })).toBeVisible();

    await owner.context().close();
    await admin.context().close();
  });

  test('keeps the reconciliation dashboard usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, e2eUsers.owner.email);
    await page.goto('/app/team/reconciliation');

    await expect(page.getByText(fixtures.team.title).first()).toBeVisible();
    await expect(page.getByLabel('Open floating agent chat')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Check coverage' })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const viewportWidth = page.viewportSize()?.width ?? 0;
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });
});
