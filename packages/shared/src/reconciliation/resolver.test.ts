import { PGlite } from '@electric-sql/pglite';
import {
  artifactClusterAnchors,
  artifactClusterMembers,
  artifactClusters,
  artifactEvidenceAssociations,
  rawEvents,
  reconciliationEvidence,
  reconciliationOutputs,
  reconciliationRuns,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizeRawEventsToEvidence } from '#src/reconciliation/normalization.js';
import { resolveEvidenceAssociations } from '#src/reconciliation/resolver.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-1111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('reconciliation evidence resolver', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'reconcile-resolver', 'Reconcile Resolver');
      INSERT INTO users (id, email) VALUES
        ('${USER_ID}', 'owner@example.test'),
        ('${USER_B_ID}', 'member@example.test');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_ID}', '${USER_ID}', 'owner'),
        ('${TEAM_ID}', '${USER_B_ID}', 'member');
    `);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('creates a cluster and association from normalized hard anchors without legacy members', async () => {
    const [raw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'ingest_webhook',
        contentText: 'Customer portal says Acme rollout is blocked by login crash.',
        occurredAt: new Date('2026-06-22T09:00:00Z'),
        visibility: 'private',
        visibilityOwnerUserId: USER_ID,
        sourceMetadata: {
          ingest_webhook_id: 'customer-portal',
          ingest_webhook_name: 'Customer Portal',
          ingest_webhook_dedup_key: 'customer-portal:acme-rollout',
          artifact_key: 'customer:acme:rollout',
          source_payload_ref: 's3://timeline-test/reconciliation/customer-portal/acme.json',
        },
      })
      .returning({ id: rawEvents.id });
    if (!raw) throw new Error('raw event insert failed');

    const [evidenceId] = await normalizeRawEventsToEvidence({
      db: db as never,
      teamId: TEAM_ID,
      rawEventIds: [raw.id],
    });
    if (!evidenceId) throw new Error('evidence insert failed');

    const result = await resolveEvidenceAssociations({
      db: db as never,
      teamId: TEAM_ID,
      evidenceIds: [evidenceId],
      clusterDefaults: {
        artifactClusterKind: 'customer_project',
        artifactType: 'project',
        canonicalName: 'Acme rollout',
        status: 'blocked',
      },
      role: 'blocker',
    });

    expect(result.skipped).toEqual([]);
    expect(result.associated).toHaveLength(1);
    expect(result.associated[0]).toMatchObject({
      evidenceId,
      rawEventId: raw.id,
      createdCluster: true,
    });

    const [cluster] = await db.select().from(artifactClusters);
    expect(cluster).toMatchObject({
      artifactClusterKind: 'customer_project',
      artifactType: 'project',
      canonicalName: 'Acme rollout',
      status: 'blocked',
    });

    const associations = await db.select().from(artifactEvidenceAssociations);
    expect(associations).toHaveLength(1);
    expect(associations[0]).toMatchObject({
      clusterId: cluster?.id,
      evidenceId,
      rawEventId: raw.id,
      role: 'blocker',
      strength: 'hard',
      associationSource: 'hard_anchor',
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
      visibilityFloor: 'private',
      visibilityFloorOwnerUserId: USER_ID,
    });
    expect(associations[0]?.sourceRefs).toEqual([
      {
        source: 'ingest_webhook',
        rawEventId: raw.id,
        evidenceId,
        sourcePayloadRef: 's3://timeline-test/reconciliation/customer-portal/acme.json',
      },
    ]);
    expect(associations[0]?.metadata).toMatchObject({
      artifact_cluster_kind: 'customer_project',
    });

    const runs = await db.select().from(reconciliationRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      trigger: 'evidence_batch',
      scope: 'anchor_resolution',
      status: 'completed',
      engineVersion: 'anchor-resolution-run-2026-06',
    });

    const outputs = await db.select().from(reconciliationOutputs);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      runId: runs[0]?.id,
      clusterId: cluster?.id,
      outputKind: 'observed_association',
      targetKind: 'cluster_identity',
      operation: 'link',
      requiresApproval: false,
      status: 'applied',
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
      visibilityFloor: 'private',
      visibilityFloorOwnerUserId: USER_ID,
    });
    expect(outputs[0]?.payload).toMatchObject({
      resolver: 'anchor-resolution',
      evidence_id: evidenceId,
      association_id: result.associated[0]?.associationId,
      association_role: 'blocker',
      artifact_cluster_kind: 'customer_project',
      created_cluster: true,
    });
    expect(outputs[0]?.sourceRefs).toEqual([
      {
        source: 'ingest_webhook',
        rawEventId: raw.id,
        evidenceId,
        associationId: result.associated[0]?.associationId,
        sourcePayloadRef: 's3://timeline-test/reconciliation/customer-portal/acme.json',
      },
    ]);
    expect(outputs[0]?.sourcePayloadRefs).toEqual([
      's3://timeline-test/reconciliation/customer-portal/acme.json',
    ]);

    const anchors = await db.select().from(artifactClusterAnchors);
    expect(anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clusterId: cluster?.id,
          anchorType: 'artifact_key',
          anchorValue: 'customer:acme:rollout',
        }),
        expect.objectContaining({
          clusterId: cluster?.id,
          anchorType: 'raw_event',
          anchorValue: raw.id,
        }),
      ]),
    );

    expect(await db.select().from(artifactClusterMembers)).toHaveLength(0);

    const retry = await resolveEvidenceAssociations({
      db: db as never,
      teamId: TEAM_ID,
      evidenceIds: [evidenceId],
      clusterDefaults: {
        artifactClusterKind: 'customer_project',
        artifactType: 'project',
        canonicalName: 'Acme rollout',
      },
      role: 'blocker',
    });
    expect(retry.skipped).toEqual([]);
    expect(retry.associated).toHaveLength(1);
    expect(retry.associated[0]?.createdCluster).toBe(false);
    expect(await db.select().from(artifactEvidenceAssociations)).toHaveLength(1);
    expect(await db.select().from(reconciliationOutputs)).toHaveLength(1);
  });

  it('carries artifact kind from an existing matched cluster into resolver outputs', async () => {
    const [cluster] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactClusterKind: 'provider_record',
        artifactType: 'other',
        canonicalName: 'Sentry release 2026.06.30',
      })
      .returning({ id: artifactClusters.id });
    if (!cluster) throw new Error('cluster insert failed');

    await db.insert(artifactClusterAnchors).values({
      teamId: TEAM_ID,
      clusterId: cluster.id,
      anchorType: 'url',
      anchorValue: 'https://sentry.example.test/releases/2026.06.30',
      strength: 'hard',
    });

    const [raw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'Sentry release 2026.06.30 links to release notes.',
        occurredAt: new Date('2026-06-30T12:00:00Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'sentry',
          external_object_id: 'acme/web/release/2026.06.30',
          event_type: 'release.created',
          url: 'https://sentry.example.test/releases/2026.06.30',
          source_payload_ref: 's3://timeline-test/reconciliation/sentry/release-2026.06.30',
        },
      })
      .returning({ id: rawEvents.id });
    if (!raw) throw new Error('raw event insert failed');

    const [evidenceId] = await normalizeRawEventsToEvidence({
      db: db as never,
      teamId: TEAM_ID,
      rawEventIds: [raw.id],
    });
    if (!evidenceId) throw new Error('evidence insert failed');

    const result = await resolveEvidenceAssociations({
      db: db as never,
      teamId: TEAM_ID,
      evidenceIds: [evidenceId],
      role: 'evidence_only',
    });

    expect(result.skipped).toEqual([]);
    expect(result.associated).toHaveLength(1);
    expect(result.associated[0]).toMatchObject({
      clusterId: cluster.id,
      createdCluster: false,
    });

    const [association] = await db.select().from(artifactEvidenceAssociations);
    expect(association).toMatchObject({
      clusterId: cluster.id,
      role: 'evidence_only',
      associationSource: 'hard_anchor',
    });
    expect(association?.metadata).toMatchObject({
      artifact_cluster_kind: 'provider_record',
    });

    const [output] = await db.select().from(reconciliationOutputs);
    expect(output).toMatchObject({
      clusterId: cluster.id,
      outputKind: 'observed_association',
      status: 'applied',
    });
    expect(output?.payload).toMatchObject({
      artifact_cluster_kind: 'provider_record',
      association_role: 'evidence_only',
      created_cluster: false,
    });
    expect(output?.sourcePayloadRefs).toEqual([
      's3://timeline-test/reconciliation/sentry/release-2026.06.30',
    ]);
  });

  it('refuses ambiguous anchor matches instead of silently merging clusters', async () => {
    const clusters = await db
      .insert(artifactClusters)
      .values([
        {
          teamId: TEAM_ID,
          artifactClusterKind: 'customer_project',
          artifactType: 'project',
          canonicalName: 'Acme rollout',
        },
        {
          teamId: TEAM_ID,
          artifactClusterKind: 'incident',
          artifactType: 'incident',
          canonicalName: 'Login crash',
        },
      ])
      .returning({ id: artifactClusters.id });
    const [firstCluster, secondCluster] = clusters;
    if (!firstCluster || !secondCluster) throw new Error('cluster insert failed');
    const firstClusterId = firstCluster.id;
    const secondClusterId = secondCluster.id;

    await db.insert(artifactClusterAnchors).values([
      {
        teamId: TEAM_ID,
        clusterId: firstClusterId,
        anchorType: 'artifact_key',
        anchorValue: 'customer:acme:rollout',
        strength: 'hard',
      },
      {
        teamId: TEAM_ID,
        clusterId: secondClusterId,
        anchorType: 'url',
        anchorValue: 'https://sentry.example.test/issues/issue-789',
        strength: 'hard',
      },
    ]);

    const [raw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'ingest_webhook',
        contentText: 'Portal links Acme rollout to Sentry ISSUE-789.',
        occurredAt: new Date('2026-06-22T10:00:00Z'),
        visibility: 'team',
        sourceMetadata: {
          ingest_webhook_id: 'customer-portal',
          ingest_webhook_dedup_key: 'customer-portal:acme-sentry',
          artifact_key: 'customer:acme:rollout',
          url: 'https://sentry.example.test/issues/ISSUE-789',
        },
      })
      .returning({ id: rawEvents.id });
    if (!raw) throw new Error('raw event insert failed');

    const [evidenceId] = await normalizeRawEventsToEvidence({
      db: db as never,
      teamId: TEAM_ID,
      rawEventIds: [raw.id],
    });
    if (!evidenceId) throw new Error('evidence insert failed');

    const result = await resolveEvidenceAssociations({
      db: db as never,
      teamId: TEAM_ID,
      evidenceIds: [evidenceId],
      clusterDefaults: {
        artifactClusterKind: 'customer_project',
        artifactType: 'project',
        canonicalName: 'Should not be created',
      },
    });

    expect(result.associated).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      evidenceId,
      reason: 'ambiguous_anchor_match',
      clusterIds: [firstClusterId, secondClusterId].sort(),
    });
    expect(result.skipped[0]?.outputId).toEqual(expect.any(String));
    expect(await db.select().from(artifactEvidenceAssociations)).toHaveLength(0);
    expect(await db.select().from(artifactClusters)).toHaveLength(2);

    const outputs = await db.select().from(reconciliationOutputs);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      id: result.skipped[0]?.outputId,
      clusterId: null,
      outputKind: 'conflict',
      targetKind: 'cluster_identity',
      operation: 'link',
      requiresApproval: true,
      status: 'pending',
      visibility: 'team',
      visibilityFloor: 'team',
      visibilityFloorOwnerUserId: null,
    });
    expect(outputs[0]?.payload).toMatchObject({
      resolver: 'anchor-resolution',
      reason: 'ambiguous_anchor_match',
      evidence_id: evidenceId,
      candidate_cluster_ids: [firstClusterId, secondClusterId].sort(),
    });
  });

  it('does not create clusters when defaults are absent', async () => {
    const [raw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'web',
        contentText: 'Loose note that should remain unclustered.',
        occurredAt: new Date('2026-06-22T11:00:00Z'),
        visibility: 'specific_users',
        visibilityOwnerUserId: USER_ID,
        visibilityUserIds: [USER_ID, USER_B_ID],
        sourceMetadata: {
          artifact_key: 'loose:note',
        },
      })
      .returning({ id: rawEvents.id });
    if (!raw) throw new Error('raw event insert failed');

    const [evidenceId] = await normalizeRawEventsToEvidence({
      db: db as never,
      teamId: TEAM_ID,
      rawEventIds: [raw.id],
    });
    if (!evidenceId) throw new Error('evidence insert failed');

    const result = await resolveEvidenceAssociations({
      db: db as never,
      teamId: TEAM_ID,
      evidenceIds: [evidenceId],
    });

    expect(result).toEqual({
      associated: [],
      skipped: [{ evidenceId, reason: 'no_cluster_defaults' }],
    });
    expect(await db.select().from(artifactClusters)).toHaveLength(0);
    expect(await db.select().from(artifactEvidenceAssociations)).toHaveLength(0);
    expect(await db.select().from(reconciliationOutputs)).toHaveLength(0);

    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.id, evidenceId));
    expect(evidence).toMatchObject({
      visibility: 'specific_users',
      visibilityOwnerUserId: USER_ID,
      visibilityUserIds: [USER_ID, USER_B_ID],
    });
  });
});
