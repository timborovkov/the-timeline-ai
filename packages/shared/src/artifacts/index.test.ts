import { PGlite } from '@electric-sql/pglite';
import {
  artifactEvidenceAssociations,
  artifactClusterAnchors,
  artifactClusterMembers,
  artifactClusters,
  entities,
  rawEvents,
  reconciliationEvidence,
} from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import {
  findArtifactClustersByAnchors,
  listArtifactClusterEvidence,
  reconcileArtifactEvidence,
  rebindDriveFileObjectLink,
  rebindDriveSelectionArtifactLink,
} from '#src/artifacts/index.js';
import { applyDbMigrations } from '#src/test/pglite.js';
const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const TEAM_B_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('artifact reconciliation', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${TEAM_ID}', 'team-a', 'Team A'), ('${TEAM_B_ID}', 'team-b', 'Team B');
      INSERT INTO users (id, email)
      VALUES ('${USER_ID}', 'owner@example.com'), ('${OTHER_USER_ID}', 'member@example.com');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '${USER_ID}', 'owner'), ('${TEAM_ID}', '${OTHER_USER_ID}', 'member');
    `);
  });

  afterEach(async () => {
    await pg.close();
  });

  async function rawEvent(contentText: string, occurredAt = '2026-06-20T10:00:00Z') {
    const [row] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'telegram',
        contentText,
        occurredAt: new Date(occurredAt),
        visibility: 'team',
        sourceMetadata: {},
      })
      .returning();
    if (!row) throw new Error('raw event insert failed');
    return row;
  }

  it('clusters a contract across conversation and signature evidence without direct memory writes', async () => {
    const report = await rawEvent('Acme said the MSA is approved pending signature.');
    const signature = await rawEvent('Signed PDF uploaded for Acme MSA.', '2026-06-20T12:00:00Z');

    const first = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'document',
      canonicalName: 'Acme master services agreement',
      rawEventId: report.id,
      role: 'discussion',
      strength: 'human',
      authoritative: false,
      anchors: [
        { type: 'artifact_key', value: 'contract:acme-msa-2026', strength: 'hard' },
        { type: 'contract_id', value: 'ACME-MSA-2026', strength: 'hard' },
      ],
    });
    const second = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'document',
      canonicalName: 'Acme master services agreement',
      status: 'resolved',
      rawEventId: signature.id,
      role: 'signature',
      strength: 'structured',
      authoritative: true,
      anchors: [{ type: 'contract_id', value: 'ACME-MSA-2026', strength: 'hard' }],
    });

    expect(second.clusterId).toBe(first.clusterId);
    const associations = await db
      .select()
      .from(artifactEvidenceAssociations)
      .where(eq(artifactEvidenceAssociations.clusterId, first.clusterId));
    expect(associations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'discussion', associationSource: 'human' }),
        expect.objectContaining({ role: 'update', associationSource: 'structured_anchor' }),
      ]),
    );
    expect(await db.select().from(artifactClusterMembers)).toHaveLength(0);
    const [cluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.id, first.clusterId));
    expect(cluster?.status).toBe('open');
  });

  it('keeps multiple raw-event evidence rows for the same mapped entity', async () => {
    const [entity] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'github/repo#17: Fix checkout',
      })
      .returning();
    if (!entity) throw new Error('entity insert failed');
    const opened = await rawEvent('GitHub issue opened for checkout failure.');
    const closed = await rawEvent(
      'GitHub issue closed after checkout fix.',
      '2026-06-20T13:00:00Z',
    );

    const first = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'task',
      canonicalName: 'github/repo#17: Fix checkout',
      status: 'open',
      canonicalEntityId: entity.id,
      rawEventId: opened.id,
      role: 'issue',
      strength: 'provider',
      authoritative: true,
      occurredAt: opened.occurredAt,
      provider: 'github',
      externalObjectId: 'github/repo#17',
      metadata: { event_type: 'issue.opened' },
    });
    const second = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'task',
      canonicalName: 'github/repo#17: Fix checkout',
      status: 'resolved',
      canonicalEntityId: entity.id,
      rawEventId: closed.id,
      role: 'lifecycle_update',
      strength: 'provider',
      authoritative: true,
      occurredAt: closed.occurredAt,
      provider: 'github',
      externalObjectId: 'github/repo#17',
      metadata: { event_type: 'issue.closed' },
    });

    expect(second.clusterId).toBe(first.clusterId);
    const associations = await db
      .select()
      .from(artifactEvidenceAssociations)
      .where(eq(artifactEvidenceAssociations.clusterId, first.clusterId));
    expect(associations.map((association) => association.rawEventId).sort()).toEqual(
      [closed.id, opened.id].sort(),
    );
    expect(await db.select().from(artifactClusterMembers)).toHaveLength(0);
    const [cluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.id, first.clusterId));
    expect(cluster?.status).toBe('resolved');
  });

  it('does not merge artifacts on semantic similarity alone', async () => {
    const firstMessage = await rawEvent('Plan the customer dinner for the Acme renewal.');
    const secondMessage = await rawEvent(
      'Plan the partner dinner for the Beta launch.',
      '2026-06-21T10:00:00Z',
    );

    const first = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'follow_up',
      canonicalName: 'Plan Acme renewal dinner',
      rawEventId: firstMessage.id,
      role: 'schedule',
      strength: 'semantic',
      anchors: [{ type: 'semantic_topic', value: 'plan dinner', strength: 'semantic' }],
    });
    const second = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'follow_up',
      canonicalName: 'Plan Beta launch dinner',
      rawEventId: secondMessage.id,
      role: 'schedule',
      strength: 'semantic',
      anchors: [{ type: 'semantic_topic', value: 'plan dinner', strength: 'semantic' }],
    });

    expect(second.clusterId).not.toBe(first.clusterId);
    const clusters = await db.select().from(artifactClusters);
    expect(clusters).toHaveLength(2);
  });

  it('finds deal and event clusters by explicit structured anchors', async () => {
    const dealEvent = await rawEvent('Pricing approved for the Northstar expansion.');
    const partyEvent = await rawEvent(
      'Venue confirmed for the launch party.',
      '2026-06-22T10:00:00Z',
    );

    const deal = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'deal',
      canonicalName: 'Northstar expansion',
      rawEventId: dealEvent.id,
      role: 'approval',
      strength: 'structured',
      anchors: [{ type: 'deal_id', value: 'northstar-expansion-2026', strength: 'hard' }],
    });
    const party = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'follow_up',
      canonicalName: 'Launch party',
      rawEventId: partyEvent.id,
      role: 'schedule',
      strength: 'structured',
      anchors: [{ type: 'event_slug', value: 'launch-party-2026', strength: 'hard' }],
    });

    const foundDeal = await findArtifactClustersByAnchors(db as never, {
      teamId: TEAM_ID,
      anchors: [{ type: 'deal_id', value: 'northstar-expansion-2026' }],
    });
    const foundParty = await findArtifactClustersByAnchors(db as never, {
      teamId: TEAM_ID,
      anchors: [{ type: 'event_slug', value: 'launch-party-2026' }],
    });

    expect(foundDeal.map((row) => row.id)).toEqual([deal.clusterId]);
    expect(foundParty.map((row) => row.id)).toEqual([party.clusterId]);
  });

  it('keeps existing cluster anchors when a race claims only the current evidence anchor', async () => {
    const [entity] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'deal',
        canonicalName: 'Northstar expansion',
      })
      .returning();
    if (!entity) throw new Error('entity insert failed');
    const source = await rawEvent('Northstar expansion contract started.');
    const winnerEvent = await rawEvent('Race winner event.', '2026-06-20T11:00:00Z');
    const raceEvent = await rawEvent(
      'Late evidence mentions a racy anchor.',
      '2026-06-20T12:00:00Z',
    );

    const original = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'deal',
      canonicalName: 'Northstar expansion',
      canonicalEntityId: entity.id,
      rawEventId: source.id,
      role: 'report',
      strength: 'structured',
      anchors: [{ type: 'artifact_key', value: 'deal:northstar', strength: 'hard' }],
    });
    const winner = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'deal',
      canonicalName: 'Winning race cluster',
      rawEventId: winnerEvent.id,
      role: 'report',
      strength: 'structured',
      anchors: [{ type: 'artifact_key', value: 'deal:race-winner', strength: 'hard' }],
    });

    await pg.exec(`
      CREATE OR REPLACE FUNCTION inject_artifact_anchor_race() RETURNS trigger AS $$
      BEGIN
        IF NEW.anchor_type = 'deal_id'
          AND NEW.anchor_value = 'racy-claim'
          AND NEW.cluster_id <> '${winner.clusterId}'::uuid
        THEN
          INSERT INTO artifact_cluster_anchors
            (team_id, cluster_id, anchor_type, anchor_value, strength, source_raw_event_id, metadata)
          VALUES
            (NEW.team_id, '${winner.clusterId}'::uuid, NEW.anchor_type, NEW.anchor_value, NEW.strength, NEW.source_raw_event_id, NEW.metadata)
          ON CONFLICT DO NOTHING;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER inject_artifact_anchor_race_before_insert
      BEFORE INSERT ON artifact_cluster_anchors
      FOR EACH ROW EXECUTE FUNCTION inject_artifact_anchor_race();
    `);

    const reconciled = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'deal',
      canonicalName: 'Northstar expansion',
      canonicalEntityId: entity.id,
      rawEventId: raceEvent.id,
      role: 'report',
      strength: 'structured',
      anchors: [{ type: 'deal_id', value: 'racy-claim', strength: 'hard' }],
    });

    expect(reconciled.clusterId).toBe(winner.clusterId);
    const anchors = await db.select().from(artifactClusterAnchors);
    expect(anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clusterId: original.clusterId,
          anchorType: 'artifact_key',
          anchorValue: 'deal:northstar',
        }),
        expect.objectContaining({
          clusterId: winner.clusterId,
          anchorType: 'deal_id',
          anchorValue: 'racy-claim',
        }),
      ]),
    );
  });

  it('keeps provider identity context observed while preserving direct lifecycle status', async () => {
    const pr = await rawEvent('GitHub PR merged. Fixes TIMELINE-AI-100.', '2026-06-20T12:00:00Z');
    const sentry = await rawEvent(
      'Sentry issue TIMELINE-AI-100: Login fails on mobile.',
      '2026-06-20T10:00:00Z',
    );

    const first = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'task',
      canonicalName: 'github/repo#77: Fix mobile login crash',
      status: 'resolved',
      rawEventId: pr.id,
      role: 'implementation',
      strength: 'provider',
      authoritative: true,
      occurredAt: pr.occurredAt,
      provider: 'github',
      externalObjectId: 'github/repo#77',
      metadata: { event_type: 'pr.merged' },
      anchors: [{ type: 'sentry_short_id', value: 'TIMELINE-AI-100', strength: 'structured' }],
    });
    const second = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'incident',
      canonicalName: 'Login fails on mobile',
      status: 'open',
      rawEventId: sentry.id,
      role: 'error',
      strength: 'provider',
      authoritative: true,
      occurredAt: sentry.occurredAt,
      provider: 'sentry',
      externalObjectId: '100',
      metadata: { event_type: 'issue.created' },
      anchors: [{ type: 'sentry_short_id', value: 'TIMELINE-AI-100', strength: 'structured' }],
    });

    expect(second.clusterId).toBe(first.clusterId);
    const [cluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.id, first.clusterId));
    expect(cluster).toMatchObject({
      artifactType: 'task',
      canonicalName: 'github/repo#77: Fix mobile login crash',
      status: 'resolved',
    });
  });

  it('does not let later routine updates revert terminal lifecycle status', async () => {
    const merged = await rawEvent('GitHub PR merged for checkout fix.', '2026-06-20T12:00:00Z');
    const updated = await rawEvent(
      'GitHub PR updated after merge with stale open status.',
      '2026-06-20T12:10:00Z',
    );

    const first = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'task',
      canonicalName: 'github/repo#91: Fix checkout',
      status: 'resolved',
      rawEventId: merged.id,
      role: 'lifecycle_update',
      strength: 'provider',
      authoritative: true,
      occurredAt: merged.occurredAt,
      provider: 'github',
      externalObjectId: 'github/repo#91',
      metadata: { event_type: 'pr.merged' },
      anchors: [{ type: 'github_pr', value: 'github/repo#91', strength: 'hard' }],
    });
    const second = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'task',
      canonicalName: 'github/repo#91: Fix checkout',
      status: 'active',
      rawEventId: updated.id,
      role: 'implementation',
      strength: 'provider',
      authoritative: true,
      occurredAt: updated.occurredAt,
      provider: 'github',
      externalObjectId: 'github/repo#91',
      metadata: { event_type: 'pr.updated' },
      anchors: [{ type: 'github_pr', value: 'github/repo#91', strength: 'hard' }],
    });

    expect(second.clusterId).toBe(first.clusterId);
    const [cluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.id, first.clusterId));
    expect(cluster?.status).toBe('resolved');
  });

  it('lets a newer authoritative source event reopen the same issue artifact', async () => {
    const closed = await rawEvent('GitHub issue closed for checkout fix.', '2026-06-20T12:00:00Z');
    const reopened = await rawEvent(
      'GitHub issue reopened for checkout fix.',
      '2026-06-20T12:10:00Z',
    );

    const first = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'task',
      canonicalName: 'github/repo#92: Fix checkout',
      status: 'resolved',
      rawEventId: closed.id,
      role: 'lifecycle_update',
      strength: 'provider',
      authoritative: true,
      occurredAt: closed.occurredAt,
      provider: 'github',
      externalObjectId: 'github/repo#92',
      metadata: { event_type: 'issue.closed' },
      anchors: [{ type: 'github_issue', value: 'github/repo#92', strength: 'hard' }],
    });
    const second = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'task',
      canonicalName: 'github/repo#92: Fix checkout',
      status: 'open',
      rawEventId: reopened.id,
      role: 'issue',
      strength: 'provider',
      authoritative: true,
      occurredAt: reopened.occurredAt,
      provider: 'github',
      externalObjectId: 'github/repo#92',
      metadata: { event_type: 'issue.reopened' },
      anchors: [{ type: 'github_issue', value: 'github/repo#92', strength: 'hard' }],
    });

    expect(second.clusterId).toBe(first.clusterId);
    const [cluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.id, first.clusterId));
    expect(cluster?.status).toBe('open');
  });

  it('keeps artifact helper joins scoped to the requested team', async () => {
    const source = await rawEvent('Acme contract evidence.');
    const cluster = await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'document',
      canonicalName: 'Acme contract',
      rawEventId: source.id,
      role: 'document',
      strength: 'structured',
      anchors: [{ type: 'contract_id', value: 'ACME-2026', strength: 'hard' }],
    });
    const crossTeamRawEventId = '00000000-0000-0000-0000-000000000222';
    const crossTeamClusterId = '30000000-0000-0000-0000-000000000222';

    await pg.exec(`
      INSERT INTO raw_events
        (id, team_id, author_user_id, source, content_text, occurred_at, visibility, source_metadata)
      VALUES
        ('${crossTeamRawEventId}', '${TEAM_B_ID}', '${USER_ID}', 'web', 'Other team evidence', '2026-06-20T13:00:00Z', 'team', '{}'::jsonb);

      INSERT INTO artifact_cluster_members
        (team_id, cluster_id, raw_event_id, role, strength, authoritative, metadata)
      VALUES
        ('${TEAM_B_ID}', '${cluster.clusterId}', '${crossTeamRawEventId}', 'document', 'structured', true, '{"canonical_name":"Other team contract"}'::jsonb);

      INSERT INTO artifact_clusters
        (id, team_id, artifact_type, canonical_name, status)
      VALUES
        ('${crossTeamClusterId}', '${TEAM_B_ID}', 'document', 'Other team contract', 'open');

      INSERT INTO artifact_cluster_anchors
        (team_id, cluster_id, anchor_type, anchor_value, strength, metadata)
      VALUES
        ('${TEAM_ID}', '${crossTeamClusterId}', 'contract_id', 'cross-team-contract', 'hard', '{}'::jsonb);
    `);

    const evidence = await listArtifactClusterEvidence(db as never, {
      teamId: TEAM_ID,
      clusterId: cluster.clusterId,
      viewerUserId: USER_ID,
    });
    expect(evidence.map((row) => row.rawEventId)).toEqual([source.id]);

    await expect(
      findArtifactClustersByAnchors(db as never, {
        teamId: TEAM_ID,
        anchors: [{ type: 'contract_id', value: 'cross-team-contract', strength: 'hard' }],
      }),
    ).resolves.toEqual([]);
  });

  it('does not list legacy artifact_cluster_members as provenance evidence', async () => {
    const source = await rawEvent('Legacy cluster member should not display as evidence.');
    const [cluster] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactClusterKind: 'incident',
        artifactType: 'incident',
        canonicalName: 'Legacy checkout incident',
        status: 'active',
      })
      .returning();
    if (!cluster) throw new Error('artifact cluster insert failed');
    await db.insert(artifactClusterMembers).values({
      teamId: TEAM_ID,
      clusterId: cluster.id,
      rawEventId: source.id,
      role: 'lifecycle_update',
      strength: 'provider',
      authoritative: true,
      metadata: { canonical_name: 'Legacy checkout incident' },
    });

    await expect(
      listArtifactClusterEvidence(db as never, {
        teamId: TEAM_ID,
        clusterId: cluster.id,
        viewerUserId: USER_ID,
      }),
    ).resolves.toEqual([]);
  });

  it('lists evidence from the reconciliation association graph without legacy members', async () => {
    const source = await rawEvent('Sentry issue affected Acme checkout.');
    const [cluster] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactClusterKind: 'incident',
        artifactType: 'incident',
        canonicalName: 'Acme checkout outage',
        status: 'active',
      })
      .returning();
    if (!cluster) throw new Error('artifact cluster insert failed');
    const [evidence] = await db
      .insert(reconciliationEvidence)
      .values({
        teamId: TEAM_ID,
        rawEventId: source.id,
        source: 'telegram',
        provider: 'sentry',
        externalObjectId: 'SENTRY-123',
        eventType: 'issue.updated',
        occurredAt: source.occurredAt,
        visibility: 'team',
        actor: {},
        contentDigest: 'digest:sentry-acme-checkout',
        normalizerVersion: 'test-v1',
        dedupeKey: 'evidence:sentry-acme-checkout',
      })
      .returning();
    if (!evidence) throw new Error('reconciliation evidence insert failed');
    await db.insert(artifactEvidenceAssociations).values({
      teamId: TEAM_ID,
      clusterId: cluster.id,
      evidenceId: evidence.id,
      role: 'lifecycle_update',
      strength: 'provider',
      associationSource: 'authoritative_provider',
      sourceRefs: [],
      visibility: 'team',
      visibilityFloor: 'team',
      metadata: { canonical_name: 'Acme checkout outage', status: 'active' },
      dedupeKey: 'association:sentry-acme-checkout',
    });

    const evidenceRows = await listArtifactClusterEvidence(db as never, {
      teamId: TEAM_ID,
      clusterId: cluster.id,
      viewerUserId: USER_ID,
    });

    expect(evidenceRows).toEqual([
      expect.objectContaining({
        clusterId: cluster.id,
        rawEventId: source.id,
        provider: 'sentry',
        externalObjectId: 'SENTRY-123',
        role: 'lifecycle_update',
        strength: 'provider',
        authoritative: true,
      }),
    ]);
  });

  it('enforces association visibility floors when listing cluster evidence', async () => {
    const source = await rawEvent('Private Sentry incident notes for Acme checkout.');
    const [cluster] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactClusterKind: 'incident',
        artifactType: 'incident',
        canonicalName: 'Private checkout incident',
        status: 'active',
      })
      .returning();
    if (!cluster) throw new Error('artifact cluster insert failed');
    const [evidence] = await db
      .insert(reconciliationEvidence)
      .values({
        teamId: TEAM_ID,
        rawEventId: source.id,
        source: 'telegram',
        provider: 'sentry',
        externalObjectId: 'SENTRY-PRIVATE',
        eventType: 'issue.private_note',
        occurredAt: source.occurredAt,
        visibility: 'private',
        visibilityOwnerUserId: USER_ID,
        actor: {},
        contentDigest: 'digest:sentry-private-checkout',
        normalizerVersion: 'test-v1',
        dedupeKey: 'evidence:sentry-private-checkout',
      })
      .returning();
    if (!evidence) throw new Error('reconciliation evidence insert failed');
    await db.insert(artifactEvidenceAssociations).values({
      teamId: TEAM_ID,
      clusterId: cluster.id,
      evidenceId: evidence.id,
      rawEventId: source.id,
      role: 'discussion',
      strength: 'human',
      associationSource: 'human',
      sourceRefs: [
        {
          source: 'telegram',
          rawEventId: source.id,
          evidenceId: evidence.id,
        },
      ],
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
      visibilityFloor: 'private',
      visibilityFloorOwnerUserId: USER_ID,
      metadata: { canonical_name: 'Private checkout incident' },
      dedupeKey: 'association:sentry-private-checkout',
    });

    await expect(
      listArtifactClusterEvidence(db as never, {
        teamId: TEAM_ID,
        clusterId: cluster.id,
        viewerUserId: OTHER_USER_ID,
      }),
    ).resolves.toEqual([]);

    await expect(
      listArtifactClusterEvidence(db as never, {
        teamId: TEAM_ID,
        clusterId: cluster.id,
        viewerUserId: USER_ID,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        clusterId: cluster.id,
        rawEventId: source.id,
        role: 'discussion',
      }),
    ]);
  });

  it('moves Drive file anchors onto the replacement object cluster without rewriting the previous entity', async () => {
    const [northstar] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Northstar',
        status: 'open',
      })
      .returning();
    const [acme] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Acme Labs',
        status: 'open',
      })
      .returning();
    if (!northstar || !acme) throw new Error('company insert failed');
    const [source] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactType: 'company',
        canonicalName: 'Northstar',
        canonicalEntityId: northstar.id,
      })
      .returning();
    if (!source) throw new Error('cluster insert failed');
    await db.insert(artifactClusterAnchors).values([
      {
        teamId: TEAM_ID,
        clusterId: source.id,
        anchorType: 'provider_object',
        anchorValue: 'google_drive:file-1',
        strength: 'hard',
      },
      {
        teamId: TEAM_ID,
        clusterId: source.id,
        anchorType: 'alias:company',
        anchorValue: 'file-1',
        strength: 'structured',
      },
    ]);

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: '33333333-3333-4333-8333-333333333333',
      selectionKind: 'drive.file',
      externalId: 'file-1',
      previousObjectId: northstar.id,
      selections: [{ kind: 'drive.file', externalId: 'file-1', linkedObjectId: acme.id }],
    });

    const [northstarCluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.id, source.id));
    expect(northstarCluster?.canonicalEntityId).toBe(northstar.id);
    const [acmeCluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.canonicalEntityId, acme.id));
    expect(acmeCluster?.id).toBeDefined();
    expect(acmeCluster?.id).not.toBe(source.id);
    const moved = await db
      .select()
      .from(artifactClusterAnchors)
      .where(eq(artifactClusterAnchors.teamId, TEAM_ID));
    expect(moved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clusterId: acmeCluster?.id,
          anchorType: 'provider_object',
          anchorValue: 'google_drive:file-1',
        }),
        expect.objectContaining({
          clusterId: acmeCluster?.id,
          anchorType: 'alias:company',
          anchorValue: 'file-1',
        }),
      ]),
    );
    expect(moved.every((row) => row.clusterId !== source.id)).toBe(true);
  });

  it('unbinds Drive file anchors onto a new cluster instead of nulling the company cluster', async () => {
    const [northstar] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Northstar',
        status: 'open',
      })
      .returning();
    if (!northstar) throw new Error('company insert failed');
    const [source] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactType: 'company',
        canonicalName: 'Northstar',
        canonicalEntityId: northstar.id,
      })
      .returning();
    if (!source) throw new Error('cluster insert failed');
    await db.insert(artifactClusterAnchors).values({
      teamId: TEAM_ID,
      clusterId: source.id,
      anchorType: 'provider_object',
      anchorValue: 'google_drive:file-2',
      strength: 'hard',
    });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: '33333333-3333-4333-8333-333333333333',
      selectionKind: 'drive.file',
      externalId: 'file-2',
      previousObjectId: northstar.id,
      selections: [{ kind: 'drive.file', externalId: 'file-2', linkedObjectId: null }],
    });

    const [northstarCluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.id, source.id));
    expect(northstarCluster?.canonicalEntityId).toBe(northstar.id);
    const [anchor] = await db
      .select()
      .from(artifactClusterAnchors)
      .where(eq(artifactClusterAnchors.anchorValue, 'google_drive:file-2'));
    expect(anchor?.clusterId).not.toBe(source.id);
    const [unbound] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.id, anchor?.clusterId ?? ''));
    expect(unbound?.canonicalEntityId).toBeNull();
  });

  const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333';
  const OTHER_INTEGRATION_ID = '44444444-4444-4444-8444-444444444444';

  async function insertCompany(name: string, teamId = TEAM_ID) {
    const [company] = await db
      .insert(entities)
      .values({
        teamId,
        type: 'company',
        canonicalName: name,
        status: 'open',
      })
      .returning();
    if (!company) throw new Error(`${name} insert failed`);
    return company;
  }

  async function insertCluster(company: { id: string; canonicalName: string }, teamId = TEAM_ID) {
    const [cluster] = await db
      .insert(artifactClusters)
      .values({
        teamId,
        artifactType: 'company',
        canonicalName: company.canonicalName,
        canonicalEntityId: company.id,
      })
      .returning();
    if (!cluster) throw new Error('cluster insert failed');
    return cluster;
  }

  async function insertDriveFileAnchor(input: {
    clusterId: string;
    fileId: string;
    inheritedFrom?: string;
    candidates?: string[];
    integrationId?: string;
    teamId?: string;
  }) {
    await db.insert(artifactClusterAnchors).values({
      teamId: input.teamId ?? TEAM_ID,
      clusterId: input.clusterId,
      anchorType: 'provider_object',
      anchorValue: `google_drive:${input.fileId}`,
      strength: 'hard',
      metadata: {
        ...(input.inheritedFrom ? { drive_inherited_from: input.inheritedFrom } : {}),
        ...(input.candidates ? { drive_inherited_candidates: input.candidates } : {}),
        ...(input.integrationId ? { drive_integration_id: input.integrationId } : {}),
      },
    });
  }

  async function clusterIdFor(objectId: string) {
    const [row] = await db
      .select({ id: artifactClusters.id })
      .from(artifactClusters)
      .where(eq(artifactClusters.canonicalEntityId, objectId));
    return row?.id;
  }

  async function anchorCluster(fileId: string, teamId = TEAM_ID) {
    const [row] = await db
      .select({ clusterId: artifactClusterAnchors.clusterId })
      .from(artifactClusterAnchors)
      .where(
        and(
          eq(artifactClusterAnchors.teamId, teamId),
          eq(artifactClusterAnchors.anchorValue, `google_drive:${fileId}`),
        ),
      );
    return row?.clusterId;
  }

  it('rebinds one Drive file onto the live resolver object without moving sibling files', async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    const target = await insertCluster(acme);
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'file-1',
      inheritedFrom: 'folder-a',
      candidates: ['file-1', 'folder-a'],
    });
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'file-other',
      inheritedFrom: 'folder-a',
      candidates: ['file-other', 'folder-a'],
    });

    await rebindDriveFileObjectLink(db as never, {
      teamId: TEAM_ID,
      fileId: 'file-1',
      nextObjectId: acme.id,
      metadata: {
        drive_inherited_from: 'folder-b',
        drive_inherited_candidates: ['file-1', 'folder-b'],
      },
    });

    expect(await anchorCluster('file-1')).toBe(target.id);
    expect(await anchorCluster('file-other')).toBe(source.id);
    const [moved] = await db
      .select()
      .from(artifactClusterAnchors)
      .where(eq(artifactClusterAnchors.anchorValue, 'google_drive:file-1'));
    expect(moved?.metadata).toEqual(
      expect.objectContaining({
        drive_inherited_from: 'folder-b',
        drive_inherited_candidates: ['file-1', 'folder-b'],
      }),
    );
    const [sibling] = await db
      .select()
      .from(artifactClusterAnchors)
      .where(eq(artifactClusterAnchors.anchorValue, 'google_drive:file-other'));
    expect(sibling?.metadata).toEqual(
      expect.objectContaining({
        drive_inherited_from: 'folder-a',
        drive_inherited_candidates: ['file-other', 'folder-a'],
      }),
    );
  });

  it('does not rebind another team’s Drive file anchors that share the same file id', async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    const target = await insertCluster(acme);
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'file-1',
      inheritedFrom: 'folder-a',
      candidates: ['file-1', 'folder-a'],
    });

    const otherCompany = await insertCompany('Other Co', TEAM_B_ID);
    const otherCluster = await insertCluster(otherCompany, TEAM_B_ID);
    await insertDriveFileAnchor({
      teamId: TEAM_B_ID,
      clusterId: otherCluster.id,
      fileId: 'file-1',
      inheritedFrom: 'folder-other',
      candidates: ['file-1', 'folder-other'],
    });
    await db.insert(artifactClusterAnchors).values({
      teamId: TEAM_B_ID,
      clusterId: otherCluster.id,
      anchorType: 'alias:file',
      anchorValue: 'file-1',
      strength: 'structured',
      metadata: {},
    });

    await rebindDriveFileObjectLink(db as never, {
      teamId: TEAM_ID,
      fileId: 'file-1',
      nextObjectId: acme.id,
    });

    expect(await anchorCluster('file-1')).toBe(target.id);
    expect(await anchorCluster('file-1', TEAM_B_ID)).toBe(otherCluster.id);
    const [otherAlias] = await db
      .select({ clusterId: artifactClusterAnchors.clusterId })
      .from(artifactClusterAnchors)
      .where(
        and(
          eq(artifactClusterAnchors.teamId, TEAM_B_ID),
          eq(artifactClusterAnchors.anchorType, 'alias:file'),
          eq(artifactClusterAnchors.anchorValue, 'file-1'),
        ),
      );
    expect(otherAlias?.clusterId).toBe(otherCluster.id);
  });

  it('moves inherited folder file anchors except files that keep their own object link', async () => {
    const [northstar] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Northstar',
        status: 'open',
      })
      .returning();
    const [acme] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Acme Labs',
        status: 'open',
      })
      .returning();
    if (!northstar || !acme) throw new Error('company insert failed');
    const [source] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactType: 'company',
        canonicalName: 'Northstar',
        canonicalEntityId: northstar.id,
      })
      .returning();
    if (!source) throw new Error('cluster insert failed');
    await db.insert(artifactClusterAnchors).values([
      {
        teamId: TEAM_ID,
        clusterId: source.id,
        anchorType: 'provider_object',
        anchorValue: 'google_drive:file-keep',
        strength: 'hard',
      },
      {
        teamId: TEAM_ID,
        clusterId: source.id,
        anchorType: 'provider_object',
        anchorValue: 'google_drive:file-move',
        strength: 'hard',
      },
    ]);

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: '33333333-3333-4333-8333-333333333333',
      selectionKind: 'drive.folder',
      externalId: 'folder-1',
      previousObjectId: northstar.id,
      selections: [
        { kind: 'drive.file', externalId: 'file-keep', linkedObjectId: northstar.id },
        { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: acme.id },
      ],
    });

    const [acmeCluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.canonicalEntityId, acme.id));
    const anchors = await db
      .select()
      .from(artifactClusterAnchors)
      .where(eq(artifactClusterAnchors.teamId, TEAM_ID));
    expect(anchors.find((row) => row.anchorValue === 'google_drive:file-keep')?.clusterId).toBe(
      source.id,
    );
    expect(anchors.find((row) => row.anchorValue === 'google_drive:file-move')?.clusterId).toBe(
      acmeCluster?.id,
    );
  });

  it("replacing one of two folders that share an object only rebinds that folder's files", async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'file-folder-1',
      inheritedFrom: 'folder-1',
      candidates: ['file-folder-1', 'folder-1'],
      integrationId: INTEGRATION_ID,
    });
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'file-folder-2',
      inheritedFrom: 'folder-2',
      candidates: ['file-folder-2', 'folder-2'],
      integrationId: INTEGRATION_ID,
    });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-1',
      previousObjectId: northstar.id,
      selections: [
        { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: acme.id },
        { kind: 'drive.folder', externalId: 'folder-2', linkedObjectId: northstar.id },
      ],
    });

    expect(await anchorCluster('file-folder-1')).toBe(await clusterIdFor(acme.id));
    expect(await anchorCluster('file-folder-2')).toBe(source.id);
  });

  it("unlinking one of two folders that share an object leaves the other folder's files bound", async () => {
    const northstar = await insertCompany('Northstar');
    const source = await insertCluster(northstar);
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'file-folder-1',
      inheritedFrom: 'folder-1',
      candidates: ['file-folder-1', 'folder-1'],
      integrationId: INTEGRATION_ID,
    });
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'file-folder-2',
      inheritedFrom: 'folder-2',
      candidates: ['file-folder-2', 'folder-2'],
      integrationId: INTEGRATION_ID,
    });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-1',
      previousObjectId: northstar.id,
      selections: [
        { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: null },
        { kind: 'drive.folder', externalId: 'folder-2', linkedObjectId: northstar.id },
      ],
    });

    expect(await anchorCluster('file-folder-2')).toBe(source.id);
    const unboundClusterId = await anchorCluster('file-folder-1');
    expect(unboundClusterId).not.toBe(source.id);
    const [unbound] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.id, unboundClusterId ?? ''));
    expect(unbound?.canonicalEntityId).toBeNull();
  });

  it('rebinds a file onto the earlier overlapping folder when that folder is relinked', async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'file-both',
      inheritedFrom: 'folder-1',
      candidates: ['file-both', 'folder-1', 'folder-2'],
      integrationId: INTEGRATION_ID,
    });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-1',
      previousObjectId: northstar.id,
      selections: [
        { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: acme.id },
        { kind: 'drive.folder', externalId: 'folder-2', linkedObjectId: northstar.id },
      ],
    });

    expect(await anchorCluster('file-both')).toBe(await clusterIdFor(acme.id));
  });

  it('keeps a file when an earlier remaining folder still links the previous object', async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'file-both',
      inheritedFrom: 'folder-2',
      candidates: ['file-both', 'folder-1', 'folder-2'],
      integrationId: INTEGRATION_ID,
    });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-2',
      previousObjectId: northstar.id,
      selections: [
        { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: northstar.id },
        { kind: 'drive.folder', externalId: 'folder-2', linkedObjectId: acme.id },
      ],
    });

    expect(await anchorCluster('file-both')).toBe(source.id);
  });

  it('rebinds nested files when a folder is relinked even if the shared drive still points at A', async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'nested-file',
      inheritedFrom: 'folder-1',
      candidates: ['nested-file', 'folder-1', 'shared-drive'],
      integrationId: INTEGRATION_ID,
    });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-1',
      previousObjectId: northstar.id,
      selections: [
        { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: acme.id },
        { kind: 'drive.shared_drive', externalId: 'shared-drive', linkedObjectId: northstar.id },
      ],
    });

    expect(await anchorCluster('nested-file')).toBe(await clusterIdFor(acme.id));
  });

  it('keeps nested files on A when the earlier folder still links A and the shared drive is relinked', async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'nested-file',
      inheritedFrom: 'folder-1',
      candidates: ['nested-file', 'folder-1', 'shared-drive'],
      integrationId: INTEGRATION_ID,
    });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.shared_drive',
      externalId: 'shared-drive',
      previousObjectId: northstar.id,
      selections: [
        { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: northstar.id },
        { kind: 'drive.shared_drive', externalId: 'shared-drive', linkedObjectId: acme.id },
      ],
    });

    expect(await anchorCluster('nested-file')).toBe(source.id);
  });

  it('moves nested-folder files with the selected ancestor and ignores another integration files', async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'file-nested',
      inheritedFrom: 'folder-1',
      candidates: ['file-nested', 'nested', 'folder-1'],
      integrationId: INTEGRATION_ID,
    });
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'file-other-integration',
      inheritedFrom: 'folder-1',
      candidates: ['file-other-integration', 'folder-1'],
      integrationId: OTHER_INTEGRATION_ID,
    });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-1',
      previousObjectId: northstar.id,
      selections: [{ kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: acme.id }],
    });

    expect(await anchorCluster('file-nested')).toBe(await clusterIdFor(acme.id));
    expect(await anchorCluster('file-other-integration')).toBe(source.id);
  });

  it('rebinds shared-drive files without moving a sibling folder still linked to the same object', async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'shared-file',
      inheritedFrom: 'shared-drive',
      candidates: ['shared-file', 'shared-drive'],
      integrationId: INTEGRATION_ID,
    });
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'folder-file',
      inheritedFrom: 'folder-1',
      candidates: ['folder-file', 'folder-1'],
      integrationId: INTEGRATION_ID,
    });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.shared_drive',
      externalId: 'shared-drive',
      previousObjectId: northstar.id,
      selections: [
        { kind: 'drive.shared_drive', externalId: 'shared-drive', linkedObjectId: acme.id },
        { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: northstar.id },
      ],
    });

    expect(await anchorCluster('shared-file')).toBe(await clusterIdFor(acme.id));
    expect(await anchorCluster('folder-file')).toBe(source.id);
  });

  it('does not rebind unstamped sibling files when another folder still links to the object', async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    await insertDriveFileAnchor({ clusterId: source.id, fileId: 'unstamped-a' });
    await insertDriveFileAnchor({ clusterId: source.id, fileId: 'unstamped-b' });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-1',
      previousObjectId: northstar.id,
      selections: [
        { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: acme.id },
        { kind: 'drive.folder', externalId: 'folder-2', linkedObjectId: northstar.id },
      ],
    });

    expect(await anchorCluster('unstamped-a')).toBe(source.id);
    expect(await anchorCluster('unstamped-b')).toBe(source.id);
  });

  it('reconstructs folder membership from the latest Drive event when anchors have no stamp', async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    await insertDriveFileAnchor({ clusterId: source.id, fileId: 'file-from-event' });
    await insertDriveFileAnchor({ clusterId: source.id, fileId: 'file-other-folder' });
    await db.insert(rawEvents).values([
      {
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'Folder 1 file changed',
        occurredAt: new Date('2026-06-20T10:00:00Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'google_drive',
          integration_id: INTEGRATION_ID,
          external_object_id: 'file-from-event',
          drive: { parents: ['folder-1'], inherited_from: 'folder-1' },
        },
      },
      {
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'Folder 2 file changed',
        occurredAt: new Date('2026-06-20T11:00:00Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'google_drive',
          integration_id: INTEGRATION_ID,
          external_object_id: 'file-other-folder',
          drive: { parents: ['folder-2'], inherited_from: 'folder-2' },
        },
      },
    ]);

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-1',
      previousObjectId: northstar.id,
      selections: [
        { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: acme.id },
        { kind: 'drive.folder', externalId: 'folder-2', linkedObjectId: northstar.id },
      ],
    });

    expect(await anchorCluster('file-from-event')).toBe(await clusterIdFor(acme.id));
    expect(await anchorCluster('file-other-folder')).toBe(source.id);
  });

  async function insertUnboundCluster(name: string) {
    const [cluster] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactType: 'company',
        canonicalName: name,
        canonicalEntityId: null,
      })
      .returning();
    if (!cluster) throw new Error('unbound cluster insert failed');
    return cluster;
  }

  it('assigns a nested unlinked folder by rebinding files already on the outer folder object', async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'nested-file',
      inheritedFrom: 'folder-outer',
      candidates: ['nested-file', 'folder-inner', 'folder-outer'],
      integrationId: INTEGRATION_ID,
    });
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'outer-only-file',
      inheritedFrom: 'folder-outer',
      candidates: ['outer-only-file', 'folder-outer'],
      integrationId: INTEGRATION_ID,
    });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-inner',
      previousObjectId: null,
      selections: [
        { kind: 'drive.folder', externalId: 'folder-inner', linkedObjectId: acme.id },
        { kind: 'drive.folder', externalId: 'folder-outer', linkedObjectId: northstar.id },
      ],
    });

    expect(await anchorCluster('nested-file')).toBe(await clusterIdFor(acme.id));
    expect(await anchorCluster('outer-only-file')).toBe(source.id);
  });

  it('assigns a nested unlinked folder under a linked shared drive without moving sibling drive files', async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'nested-file',
      inheritedFrom: 'shared-drive',
      candidates: ['nested-file', 'folder-inner', 'shared-drive'],
      integrationId: INTEGRATION_ID,
    });
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'drive-file',
      inheritedFrom: 'shared-drive',
      candidates: ['drive-file', 'shared-drive'],
      integrationId: INTEGRATION_ID,
    });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-inner',
      previousObjectId: null,
      selections: [
        { kind: 'drive.folder', externalId: 'folder-inner', linkedObjectId: acme.id },
        { kind: 'drive.shared_drive', externalId: 'shared-drive', linkedObjectId: northstar.id },
      ],
    });

    expect(await anchorCluster('nested-file')).toBe(await clusterIdFor(acme.id));
    expect(await anchorCluster('drive-file')).toBe(source.id);
  });

  it('assigns a nested unlinked folder from event ancestry when the file is already on A', async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    await insertDriveFileAnchor({ clusterId: source.id, fileId: 'nested-from-event' });
    await insertDriveFileAnchor({ clusterId: source.id, fileId: 'outer-from-event' });
    await db.insert(rawEvents).values([
      {
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'Nested file changed',
        occurredAt: new Date('2026-06-20T10:00:00Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'google_drive',
          integration_id: INTEGRATION_ID,
          external_object_id: 'nested-from-event',
          drive: {
            parents: ['folder-inner'],
            inherited_from: 'folder-outer',
            inherited_candidates: ['nested-from-event', 'folder-inner', 'folder-outer'],
          },
        },
      },
      {
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'Outer file changed',
        occurredAt: new Date('2026-06-20T11:00:00Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'google_drive',
          integration_id: INTEGRATION_ID,
          external_object_id: 'outer-from-event',
          drive: {
            parents: ['folder-outer'],
            inherited_from: 'folder-outer',
            inherited_candidates: ['outer-from-event', 'folder-outer'],
          },
        },
      },
    ]);

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-inner',
      previousObjectId: null,
      selections: [
        { kind: 'drive.folder', externalId: 'folder-inner', linkedObjectId: acme.id },
        { kind: 'drive.folder', externalId: 'folder-outer', linkedObjectId: northstar.id },
      ],
    });

    expect(await anchorCluster('nested-from-event')).toBe(await clusterIdFor(acme.id));
    expect(await anchorCluster('outer-from-event')).toBe(source.id);
  });

  it('assigns a previously unlinked folder by rebinding inherited files from unbound clusters', async () => {
    const acme = await insertCompany('Acme Labs');
    const unbound = await insertUnboundCluster('Unbound Drive files');
    await insertDriveFileAnchor({
      clusterId: unbound.id,
      fileId: 'file-folder-1',
      inheritedFrom: 'folder-1',
      candidates: ['file-folder-1', 'folder-1'],
      integrationId: INTEGRATION_ID,
    });
    await insertDriveFileAnchor({
      clusterId: unbound.id,
      fileId: 'file-folder-2',
      inheritedFrom: 'folder-2',
      candidates: ['file-folder-2', 'folder-2'],
      integrationId: INTEGRATION_ID,
    });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-1',
      previousObjectId: null,
      selections: [{ kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: acme.id }],
    });

    expect(await anchorCluster('file-folder-1')).toBe(await clusterIdFor(acme.id));
    expect(await anchorCluster('file-folder-2')).toBe(unbound.id);
  });

  it('does not steal another unlinked folder file when assigning from an unbound cluster', async () => {
    const northstar = await insertCompany('Northstar');
    const acme = await insertCompany('Acme Labs');
    const source = await insertCluster(northstar);
    const unbound = await insertUnboundCluster('Unbound folder-1 files');
    await insertDriveFileAnchor({
      clusterId: unbound.id,
      fileId: 'file-folder-1',
      inheritedFrom: 'folder-1',
      candidates: ['file-folder-1', 'folder-1'],
      integrationId: INTEGRATION_ID,
    });
    await insertDriveFileAnchor({
      clusterId: source.id,
      fileId: 'file-folder-2',
      inheritedFrom: 'folder-2',
      candidates: ['file-folder-2', 'folder-2'],
      integrationId: INTEGRATION_ID,
    });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-1',
      previousObjectId: null,
      selections: [
        { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: acme.id },
        { kind: 'drive.folder', externalId: 'folder-2', linkedObjectId: northstar.id },
      ],
    });

    expect(await anchorCluster('file-folder-1')).toBe(await clusterIdFor(acme.id));
    expect(await anchorCluster('file-folder-2')).toBe(source.id);
  });

  it('moves unstamped unbound files only when no linked sibling container remains', async () => {
    const acme = await insertCompany('Acme Labs');
    const unbound = await insertUnboundCluster('Unbound unstamped files');
    await insertDriveFileAnchor({ clusterId: unbound.id, fileId: 'unstamped-last' });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-1',
      previousObjectId: null,
      selections: [{ kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: acme.id }],
    });

    expect(await anchorCluster('unstamped-last')).toBe(await clusterIdFor(acme.id));
  });

  it('leaves unstamped unbound files unbound when a linked sibling container remains', async () => {
    const acme = await insertCompany('Acme Labs');
    const unbound = await insertUnboundCluster('Unbound unstamped files');
    await insertDriveFileAnchor({ clusterId: unbound.id, fileId: 'unstamped-sibling' });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.folder',
      externalId: 'folder-1',
      previousObjectId: null,
      selections: [
        { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: acme.id },
        { kind: 'drive.folder', externalId: 'folder-2', linkedObjectId: acme.id },
      ],
    });

    expect(await anchorCluster('unstamped-sibling')).toBe(unbound.id);
  });

  it('assigns a previously unlinked shared drive from unbound clusters', async () => {
    const acme = await insertCompany('Acme Labs');
    const unbound = await insertUnboundCluster('Unbound shared-drive files');
    await insertDriveFileAnchor({
      clusterId: unbound.id,
      fileId: 'shared-file',
      inheritedFrom: 'shared-drive',
      candidates: ['shared-file', 'shared-drive'],
      integrationId: INTEGRATION_ID,
    });
    await insertDriveFileAnchor({
      clusterId: unbound.id,
      fileId: 'folder-file',
      inheritedFrom: 'folder-1',
      candidates: ['folder-file', 'folder-1'],
      integrationId: INTEGRATION_ID,
    });

    await rebindDriveSelectionArtifactLink(db as never, {
      teamId: TEAM_ID,
      integrationId: INTEGRATION_ID,
      selectionKind: 'drive.shared_drive',
      externalId: 'shared-drive',
      previousObjectId: null,
      selections: [
        { kind: 'drive.shared_drive', externalId: 'shared-drive', linkedObjectId: acme.id },
      ],
    });

    expect(await anchorCluster('shared-file')).toBe(await clusterIdFor(acme.id));
    expect(await anchorCluster('folder-file')).toBe(unbound.id);
  });
});
