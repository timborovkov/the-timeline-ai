import { PGlite } from '@electric-sql/pglite';
import {
  artifactClusterAnchors,
  artifactClusterMembers,
  artifactClusters,
  entities,
  rawEvents,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { findArtifactClustersByAnchors, reconcileArtifactEvidence } from '#src/artifacts/index.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('artifact reconciliation', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'team-a', 'Team A');
      INSERT INTO users (id, email) VALUES ('${USER_ID}', 'owner@example.com');
      INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
    `);
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

  it('clusters a contract across conversation and signature evidence while preserving authority', async () => {
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
    const members = await db
      .select()
      .from(artifactClusterMembers)
      .where(eq(artifactClusterMembers.clusterId, first.clusterId));
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'discussion', authoritative: false }),
        expect.objectContaining({ role: 'signature', authoritative: true }),
      ]),
    );
    const [cluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.id, first.clusterId));
    expect(cluster?.status).toBe('resolved');
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
    });

    expect(second.clusterId).toBe(first.clusterId);
    const members = await db
      .select()
      .from(artifactClusterMembers)
      .where(eq(artifactClusterMembers.clusterId, first.clusterId));
    expect(members.map((member) => member.rawEventId).sort()).toEqual(
      [closed.id, opened.id].sort(),
    );
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

  it('promotes artifact identity when authoritative source evidence arrives after implementation evidence', async () => {
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
      anchors: [{ type: 'sentry_short_id', value: 'TIMELINE-AI-100', strength: 'structured' }],
    });

    expect(second.clusterId).toBe(first.clusterId);
    const [cluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.id, first.clusterId));
    expect(cluster).toMatchObject({
      artifactType: 'incident',
      canonicalName: 'Login fails on mobile',
      status: 'resolved',
    });
  });
});
