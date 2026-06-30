import { PGlite } from '@electric-sql/pglite';
import {
  artifactClusters,
  artifactEvidenceAssociations,
  rawEvents,
  reconciliationEvidence,
  reconciliationOutputs,
  reconciliationProjectionOutbox,
  reconciliationRuns,
} from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildAssociationDedupeKey, buildOutputDedupeKey } from '#src/reconciliation/index.js';
import { normalizeRawEventsToEvidence } from '#src/reconciliation/normalization.js';
import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('reconciliation dashboard snapshot', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'reconciliation-dashboard', 'Reconciliation Dashboard');
      INSERT INTO users (id, email) VALUES
        ('${ADMIN_ID}', 'admin@example.test'),
        ('${MEMBER_ID}', 'member@example.test');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_ID}', '${ADMIN_ID}', 'admin'),
        ('${TEAM_ID}', '${MEMBER_ID}', 'member');
    `);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('summarizes evidence coverage, runs, outputs, associations, clusters, and projection state', async () => {
    const raw = await db
      .insert(rawEvents)
      .values([
        {
          teamId: TEAM_ID,
          authorUserId: ADMIN_ID,
          source: 'email',
          contentText: 'Forwarded customer project decision with raw provider payload.',
          occurredAt: new Date('2026-06-27T09:00:00Z'),
          visibility: 'team',
          sourceMetadata: {
            message_id: '<dash-1@example.test>',
            raw_postmark: { MessageID: '<dash-1@example.test>', TextBody: 'Decision payload.' },
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: ADMIN_ID,
          source: 'slack',
          contentText: 'Slack update without retained provider payload.',
          occurredAt: new Date('2026-06-27T09:05:00Z'),
          visibility: 'team',
          sourceMetadata: {
            slack_workspace_id: 'T_DASH',
            slack_channel_id: 'C_DASH',
            slack_message_ts: '1800000000.000200',
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: ADMIN_ID,
          source: 'web',
          contentText: 'Manual note still missing reconciliation evidence.',
          occurredAt: new Date('2026-06-27T09:10:00Z'),
          visibility: 'team',
          sourceMetadata: { title: 'Dashboard missing evidence' },
        },
      ])
      .returning({ id: rawEvents.id });

    await normalizeRawEventsToEvidence({
      db: db as never,
      teamId: TEAM_ID,
      rawEventIds: raw.slice(0, 2).map((row) => row.id),
    });
    const slackRawEventId = raw[1]?.id;
    if (!slackRawEventId) throw new Error('expected slack raw event');
    const evidenceRows = await db.select().from(reconciliationEvidence);
    const emailEvidence = evidenceRows.find((row) => row.source === 'email');
    if (!emailEvidence) throw new Error('expected email evidence');
    const [privateRaw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: MEMBER_ID,
        source: 'email',
        contentText: 'Private member-only reconciliation evidence.',
        occurredAt: new Date('2026-06-27T09:12:00Z'),
        visibility: 'private',
        visibilityOwnerUserId: MEMBER_ID,
        sourceMetadata: { source_payload_ref: 'inline://dashboard/private' },
      })
      .returning({ id: rawEvents.id });
    if (!privateRaw) throw new Error('expected private raw event');
    const [privateEvidence] = await db
      .insert(reconciliationEvidence)
      .values({
        teamId: TEAM_ID,
        rawEventId: privateRaw.id,
        sourcePayloadRef: 'inline://dashboard/private',
        source: 'email',
        provider: 'email',
        eventType: 'private_context',
        occurredAt: new Date('2026-06-27T09:12:00Z'),
        visibility: 'private',
        visibilityOwnerUserId: MEMBER_ID,
        actor: {},
        contentDigest: 'sha256:dashboard-private',
        title: 'Private evidence',
        summary: 'Private member-only evidence.',
        metadata: {},
        normalizerVersion: 'dashboard-test-private',
        replayState: 'full',
        dedupeKey: 'dashboard-private-evidence',
      })
      .returning();
    if (!privateEvidence) throw new Error('expected private evidence');

    const [cluster] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactClusterKind: 'customer_project',
        artifactType: 'project',
        canonicalName: 'Acme rollout',
      })
      .returning();
    if (!cluster) throw new Error('expected cluster');

    await db.insert(artifactEvidenceAssociations).values({
      teamId: TEAM_ID,
      clusterId: cluster.id,
      evidenceId: emailEvidence.id,
      rawEventId: emailEvidence.rawEventId,
      role: 'decision',
      strength: 'hard',
      associationSource: 'hard_anchor',
      sourceRefs: [{ source: 'email', rawEventId: emailEvidence.rawEventId }],
      dedupeKey: buildAssociationDedupeKey({
        teamId: TEAM_ID,
        clusterId: cluster.id,
        evidenceId: emailEvidence.id,
        role: 'decision',
        associationSource: 'hard_anchor',
        associationPolicyVersion: 'dashboard-test',
      }),
    });
    await db.insert(artifactEvidenceAssociations).values({
      teamId: TEAM_ID,
      clusterId: cluster.id,
      evidenceId: privateEvidence.id,
      rawEventId: privateRaw.id,
      role: 'related_context',
      strength: 'human',
      associationSource: 'human',
      sourceRefs: [{ source: 'email', rawEventId: privateRaw.id, evidenceId: privateEvidence.id }],
      visibility: 'private',
      visibilityOwnerUserId: MEMBER_ID,
      visibilityFloor: 'private',
      visibilityFloorOwnerUserId: MEMBER_ID,
      dedupeKey: buildAssociationDedupeKey({
        teamId: TEAM_ID,
        clusterId: cluster.id,
        evidenceId: privateEvidence.id,
        role: 'related_context',
        associationSource: 'human',
        associationPolicyVersion: 'dashboard-test',
      }),
    });

    const [run] = await db
      .insert(reconciliationRuns)
      .values({
        teamId: TEAM_ID,
        trigger: 'manual_repair',
        scope: 'cluster:acme-rollout',
        status: 'completed',
        inputFingerprint: 'dashboard-run-1',
        engineVersion: 'dashboard-test-engine',
        startedAt: new Date('2026-06-27T09:15:00Z'),
        completedAt: new Date('2026-06-27T09:16:00Z'),
      })
      .returning();
    if (!run) throw new Error('expected run');

    const [output] = await db
      .insert(reconciliationOutputs)
      .values({
        teamId: TEAM_ID,
        runId: run.id,
        clusterId: cluster.id,
        outputKind: 'approval_bundle',
        targetKind: 'object',
        operation: 'create',
        requiresApproval: true,
        sourceRefs: [{ source: 'email', rawEventId: emailEvidence.rawEventId }],
        sourcePayloadRefs: [emailEvidence.sourcePayloadRef],
        dedupeKey: buildOutputDedupeKey({
          teamId: TEAM_ID,
          clusterId: cluster.id,
          targetKind: 'object',
          operation: 'create',
          targetIdentity: 'Acme rollout',
          sourceRefs: [{ source: 'email', rawEventId: emailEvidence.rawEventId }],
          authorityPolicyVersion: 'dashboard-test',
          plannerVersion: 'dashboard-test',
        }),
        status: 'approval_created',
      })
      .returning();
    if (!output) throw new Error('expected output');

    await db.insert(reconciliationOutputs).values([
      {
        teamId: TEAM_ID,
        runId: run.id,
        clusterId: cluster.id,
        outputKind: 'direct_write',
        targetKind: 'task',
        operation: 'update',
        requiresApproval: false,
        sourceRefs: [{ source: 'sentry', rawEventId: emailEvidence.rawEventId }],
        dedupeKey: 'dashboard-direct-write-sentry',
        status: 'applied',
      },
      {
        teamId: TEAM_ID,
        runId: run.id,
        clusterId: cluster.id,
        outputKind: 'conflict',
        targetKind: 'cluster_lifecycle',
        operation: 'update',
        requiresApproval: true,
        sourceRefs: [
          { source: 'sentry', rawEventId: emailEvidence.rawEventId },
          { source: 'slack', rawEventId: slackRawEventId },
        ],
        payload: { reason: 'ambiguous_lifecycle_state' },
        dedupeKey: 'dashboard-conflict-sentry-slack',
        status: 'pending',
      },
      {
        teamId: TEAM_ID,
        runId: run.id,
        clusterId: cluster.id,
        outputKind: 'no_action',
        targetKind: 'object',
        operation: 'noop',
        requiresApproval: false,
        sourceRefs: [{ source: 'slack', rawEventId: slackRawEventId }],
        payload: { reason_code: 'ambiguous_customer_request' },
        dedupeKey: 'dashboard-no-action-slack',
        status: 'applied',
      },
      {
        teamId: TEAM_ID,
        runId: run.id,
        clusterId: cluster.id,
        outputKind: 'approval_bundle',
        targetKind: 'object',
        operation: 'update',
        requiresApproval: true,
        sourceRefs: [{ source: 'email', rawEventId: emailEvidence.rawEventId }],
        dedupeKey: 'dashboard-approval-applied',
        status: 'applied',
      },
      {
        teamId: TEAM_ID,
        runId: run.id,
        clusterId: cluster.id,
        outputKind: 'approval_bundle',
        targetKind: 'object',
        operation: 'update',
        requiresApproval: true,
        sourceRefs: [{ source: 'email', rawEventId: emailEvidence.rawEventId }],
        dedupeKey: 'dashboard-approval-rejected',
        status: 'rejected',
      },
      {
        teamId: TEAM_ID,
        runId: run.id,
        clusterId: cluster.id,
        outputKind: 'approval_bundle',
        targetKind: 'object',
        operation: 'update',
        requiresApproval: true,
        sourceRefs: [{ source: 'email', rawEventId: privateRaw.id }],
        dedupeKey: 'dashboard-hidden-private-output',
        visibility: 'private',
        visibilityOwnerUserId: MEMBER_ID,
        visibilityFloor: 'private',
        visibilityFloorOwnerUserId: MEMBER_ID,
        status: 'pending',
      },
    ]);

    await db.insert(reconciliationProjectionOutbox).values({
      teamId: TEAM_ID,
      outputId: output.id,
      action: 'create_projection',
      status: 'pending',
      dedupeKey: `dashboard-outbox:${output.id}`,
    });

    const snapshot = await withTeam(
      db as never,
      TEAM_ID,
      ADMIN_ID,
    ).reconciliation.getDashboardSnapshot();

    expect(snapshot.evidenceCoverage).toMatchObject({
      totalRawEvents: 4,
      normalizedRawEvents: 3,
      missingRawEvents: 1,
      fullReplayEvidence: 2,
      degradedReplayEvidence: 1,
    });
    expect(snapshot.evidenceCoverage.bySource.web.missingRawEvents).toBe(1);
    expect(snapshot.runs.byStatus).toContainEqual({ key: 'completed', count: 1 });
    expect(snapshot.runs.byTrigger).toContainEqual({ key: 'manual_repair', count: 1 });
    expect(snapshot.outputs.byStatus).toContainEqual({ key: 'approval_created', count: 1 });
    expect(snapshot.outputs.byStatus).toContainEqual({ key: 'applied', count: 3 });
    expect(snapshot.outputs.byStatus).toContainEqual({ key: 'pending', count: 2 });
    expect(snapshot.outputs.byStatus).toContainEqual({ key: 'rejected', count: 1 });
    expect(snapshot.outputs.byKind).toContainEqual({ key: 'approval_bundle', count: 4 });
    expect(snapshot.outputs.byKind).toContainEqual({ key: 'conflict', count: 1 });
    expect(snapshot.outputs.byKind).toContainEqual({ key: 'direct_write', count: 1 });
    expect(snapshot.outputs.byKind).toContainEqual({ key: 'no_action', count: 1 });
    expect(snapshot.associations).toMatchObject({
      total: 2,
      byRole: [
        { key: 'decision', count: 1 },
        { key: 'related_context', count: 1 },
      ],
    });
    expect(snapshot.clusters).toMatchObject({
      total: 1,
      byKind: [{ key: 'customer_project', count: 1 }],
    });
    expect(snapshot.clusters.recent).toEqual([
      expect.objectContaining({
        id: cluster.id,
        artifactClusterKind: 'customer_project',
        canonicalName: 'Acme rollout',
      }),
    ]);
    expect(snapshot.projectionOutbox.byStatus).toContainEqual({ key: 'pending', count: 1 });
    expect(snapshot.runs.recent[0]).toMatchObject({
      id: run.id,
      trigger: 'manual_repair',
      scope: 'cluster:acme-rollout',
    });
    expect(snapshot.outputs.recent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: output.id,
          outputKind: 'approval_bundle',
          requiresApproval: true,
        }),
      ]),
    );
    expect(snapshot.diagnostics).toMatchObject({
      openConflicts: 1,
      directWritesBySource: [{ key: 'sentry', count: 1 }],
      approvalStats: {
        accepted: 1,
        rejected: 1,
        open: 3,
        totalDecided: 2,
        acceptanceRate: 0.5,
      },
      topNoActionReasons: [{ key: 'ambiguous_customer_request', count: 1 }],
    });
    expect(snapshot.diagnostics.ambiguityBySource).toEqual([
      { key: 'sentry', count: 1 },
      { key: 'slack', count: 1 },
    ]);

    const detail = await withTeam(db as never, TEAM_ID, ADMIN_ID).reconciliation.getClusterDetail({
      clusterId: cluster.id,
    });
    expect(detail?.cluster).toMatchObject({
      id: cluster.id,
      canonicalName: 'Acme rollout',
    });
    expect(detail?.evidence.map((row) => row.rawEventId)).toContain(emailEvidence.rawEventId);
    expect(detail?.evidence.map((row) => row.rawEventId)).not.toContain(privateRaw.id);
    expect(detail?.outputs.map((row) => row.id)).toContain(output.id);
    const visibleOutputSourceRefs: unknown[] = [];
    for (const row of detail?.outputs ?? []) {
      if (!Array.isArray(row.sourceRefs)) continue;
      const refs = row.sourceRefs as unknown[];
      for (const ref of refs) visibleOutputSourceRefs.push(ref);
    }
    expect(visibleOutputSourceRefs).not.toContainEqual(
      expect.objectContaining({ rawEventId: privateRaw.id }),
    );
  });

  it('requires admin membership through the team scope', async () => {
    await expect(
      withTeam(db as never, TEAM_ID, MEMBER_ID).reconciliation.getDashboardSnapshot(),
    ).rejects.toThrow('Requires admin role');
  });
});
