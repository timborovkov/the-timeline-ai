import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileArtifactEvidence } from '#src/artifacts/index.js';
import { reconcileLinkArtifactsForRawEvent } from '#src/conversational/link-artifacts.js';
import { buildEvidencePack } from '#src/evidence-pack/index.js';
import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

// Evidence packs are a security and provenance seam: callers receive only
// visible immutable events, in deterministic order, with enough policy metadata
// to audit the prompt or answer that consumed them.

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ANCHOR_ID = '00000000-0000-0000-0000-000000000101';
const PRIVATE_ID = '00000000-0000-0000-0000-000000000102';
const SUPPORT_ID = '00000000-0000-0000-0000-000000000103';
const LONG_SUPPORT_ID = '00000000-0000-0000-0000-000000000104';
const SLACK_NEW_ID = '00000000-0000-0000-0000-000000000105';
const SLACK_OLD_ID = '00000000-0000-0000-0000-000000000106';
const CALENDAR_ID = '00000000-0000-0000-0000-000000000107';
const EMPTY_SUPPORT_ID = '00000000-0000-0000-0000-000000000108';
const OTHER_TEAM_EVENT_ID = '00000000-0000-0000-0000-000000000201';

describe('buildEvidencePack', () => {
  let pg: PGlite;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES
        ('${TEAM_ID}', 'pack-team', 'Pack Team'),
        ('${OTHER_TEAM_ID}', 'other-pack-team', 'Other Pack Team');
      INSERT INTO users (id, email, name) VALUES
        ('${USER_ID}', 'pack@example.com', 'Pack Owner'),
        ('${OTHER_USER_ID}', 'other-pack@example.com', 'Other Owner');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_ID}', '${USER_ID}', 'owner'),
        ('${OTHER_TEAM_ID}', '${OTHER_USER_ID}', 'owner');
      INSERT INTO raw_events
        (id, team_id, author_user_id, visibility_owner_user_id, source, content_text, occurred_at, visibility, source_metadata)
      VALUES
        ('${ANCHOR_ID}', '${TEAM_ID}', '${USER_ID}', '${USER_ID}', 'ingest_webhook', 'Acme launch webhook', '2026-08-01T10:00:00Z', 'team', '{"ingest_webhook_name":"Acme delivery"}'::jsonb),
        ('${PRIVATE_ID}', '${TEAM_ID}', '${USER_ID}', NULL, 'email', 'Private Acme note', '2026-08-01T11:00:00Z', 'private', '{}'::jsonb),
        ('${SUPPORT_ID}', '${TEAM_ID}', '${USER_ID}', '${USER_ID}', 'email', 'The signed Acme launch date is August 12.', '2026-08-01T09:00:00Z', 'team', '{}'::jsonb),
        ('${LONG_SUPPORT_ID}', '${TEAM_ID}', '${USER_ID}', '${USER_ID}', 'email', repeat('bounded evidence ', 100), '2026-08-01T08:00:00Z', 'team', '{}'::jsonb),
        ('${SLACK_NEW_ID}', '${TEAM_ID}', '${USER_ID}', '${USER_ID}', 'slack', 'Newest Slack evidence', '2026-08-01T13:00:00Z', 'team', '{}'::jsonb),
        ('${SLACK_OLD_ID}', '${TEAM_ID}', '${USER_ID}', '${USER_ID}', 'slack', 'Older Slack evidence', '2026-08-01T12:00:00Z', 'team', '{}'::jsonb),
        ('${CALENDAR_ID}', '${TEAM_ID}', '${USER_ID}', '${USER_ID}', 'calendar', 'Customer review is August 12 at 10:00.', '2026-08-12T10:00:00Z', 'team', '{}'::jsonb),
        ('${EMPTY_SUPPORT_ID}', '${TEAM_ID}', '${USER_ID}', '${USER_ID}', 'email', '   ', '2026-08-01T07:00:00Z', 'team', '{}'::jsonb),
        ('${OTHER_TEAM_EVENT_ID}', '${OTHER_TEAM_ID}', '${OTHER_USER_ID}', '${OTHER_USER_ID}', 'web', 'Other team event', '2026-08-01T12:00:00Z', 'team', '{}'::jsonb);
    `);
  }, 60_000);

  afterEach(async () => {
    await pg.close();
  });

  it('builds a deterministic proposal pack from visible team anchors', async () => {
    const db = drizzle(pg);
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    const first = await buildEvidencePack(scope, {
      purpose: 'proposal',
      anchorRawEventIds: [ANCHOR_ID],
    });
    const second = await buildEvidencePack(scope, {
      purpose: 'proposal',
      anchorRawEventIds: [ANCHOR_ID],
    });

    expect(first).toMatchObject({
      purpose: 'proposal',
      version: 'evidence-pack-v1',
      policyVersion: 'proposal-v1',
      audience: { visibility: 'team' },
      items: [
        {
          rawEventId: ANCHOR_ID,
          surface: 'Acme delivery',
          role: 'core',
          contentText: 'Acme launch webhook',
          rank: 1,
          relationshipSignals: [{ kind: 'anchor', strength: 'hard' }],
        },
      ],
      metrics: {
        candidateCount: 1,
        selectedCount: 1,
        surfaceCount: 1,
        truncated: false,
      },
    });
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it('changes the fingerprint when mutable calendar evidence changes', async () => {
    const db = drizzle(pg);
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const first = await buildEvidencePack(scope, {
      purpose: 'answer',
      anchorRawEventIds: [CALENDAR_ID],
    });

    await pg.exec(`
      UPDATE raw_events
      SET content_text = 'Customer review moved to August 13 at 14:00.',
          occurred_at = '2026-08-13T14:00:00Z'
      WHERE id = '${CALENDAR_ID}';
    `);
    const second = await buildEvidencePack(scope, {
      purpose: 'answer',
      anchorRawEventIds: [CALENDAR_ID],
    });

    expect(second.fingerprint).not.toBe(first.fingerprint);
  });

  it('fails closed when any required proposal anchor is inaccessible', async () => {
    const db = drizzle(pg);
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    await expect(
      buildEvidencePack(scope, {
        purpose: 'proposal',
        anchorRawEventIds: [PRIVATE_ID, OTHER_TEAM_EVENT_ID],
      }),
    ).rejects.toThrow('required evidence anchors are missing or inaccessible');
  });

  it('uses the author as the audience owner for visible legacy private events', async () => {
    const db = drizzle(pg);
    const pack = await buildEvidencePack(withTeam(db as never, TEAM_ID, USER_ID), {
      purpose: 'answer',
      anchorRawEventIds: [PRIVATE_ID],
      semanticRawEventIds: [PRIVATE_ID],
    });

    expect(pack.audience).toMatchObject({
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
    });
  });

  it('admits one-hop hard-linked evidence while excluding non-team supporting rows', async () => {
    const db = drizzle(pg);
    await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'project',
      canonicalName: 'Acme launch',
      status: 'active',
      rawEventId: ANCHOR_ID,
      role: 'discussion',
      strength: 'hard',
      authoritative: false,
      anchors: [{ type: 'canonical_url', value: 'https://acme.test/launch', strength: 'hard' }],
    });
    await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'project',
      canonicalName: 'Acme launch',
      status: 'active',
      rawEventId: PRIVATE_ID,
      role: 'discussion',
      strength: 'hard',
      authoritative: false,
      anchors: [{ type: 'canonical_url', value: 'https://acme.test/launch', strength: 'hard' }],
    });
    await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'project',
      canonicalName: 'Acme launch',
      status: 'active',
      rawEventId: SUPPORT_ID,
      role: 'document',
      strength: 'hard',
      authoritative: true,
      anchors: [{ type: 'canonical_url', value: 'https://acme.test/launch', strength: 'hard' }],
    });

    const pack = await buildEvidencePack(withTeam(db as never, TEAM_ID, USER_ID), {
      purpose: 'proposal',
      anchorRawEventIds: [ANCHOR_ID],
    });

    expect(pack.items.map((item) => item.rawEventId)).toEqual([ANCHOR_ID, SUPPORT_ID]);
    expect(pack.items[1]).toMatchObject({
      role: 'supporting',
      relationshipSignals: [
        expect.objectContaining({ kind: 'artifact_association', strength: 'hard' }),
      ],
    });
    expect(pack.metrics.omissionReasons).toMatchObject({ visibility: 1 });
  });

  it('rejects model-candidate associations even when their stored strength is structured', async () => {
    const db = drizzle(pg);
    await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'project',
      canonicalName: 'Acme launch',
      status: 'active',
      rawEventId: ANCHOR_ID,
      role: 'discussion',
      strength: 'hard',
      anchors: [{ type: 'canonical_url', value: 'https://acme.test/launch', strength: 'hard' }],
    });
    await reconcileArtifactEvidence(db as never, {
      teamId: TEAM_ID,
      artifactType: 'project',
      canonicalName: 'Acme launch',
      status: 'active',
      rawEventId: SUPPORT_ID,
      role: 'related_context',
      strength: 'structured',
      anchors: [{ type: 'canonical_url', value: 'https://acme.test/launch', strength: 'hard' }],
    });
    await pg.exec(`
      UPDATE artifact_evidence_associations
      SET association_source = 'model_candidate'
      WHERE raw_event_id = '${SUPPORT_ID}';
    `);

    const pack = await buildEvidencePack(withTeam(db as never, TEAM_ID, USER_ID), {
      purpose: 'proposal',
      anchorRawEventIds: [ANCHOR_ID],
    });

    expect(pack.items.map((item) => item.rawEventId)).toEqual([ANCHOR_ID]);
  });

  it('omits supporting events that contain no usable evidence', async () => {
    const db = drizzle(pg);
    for (const rawEventId of [ANCHOR_ID, EMPTY_SUPPORT_ID]) {
      await reconcileArtifactEvidence(db as never, {
        teamId: TEAM_ID,
        artifactType: 'project',
        canonicalName: 'Acme launch',
        status: 'active',
        rawEventId,
        role: 'discussion',
        strength: 'hard',
        anchors: [{ type: 'canonical_url', value: 'https://acme.test/launch', strength: 'hard' }],
      });
    }

    const pack = await buildEvidencePack(withTeam(db as never, TEAM_ID, USER_ID), {
      purpose: 'proposal',
      anchorRawEventIds: [ANCHOR_ID],
    });

    expect(pack.items.map((item) => item.rawEventId)).toEqual([ANCHOR_ID]);
    expect(pack.metrics.omissionReasons).toMatchObject({ empty_content: 1 });
  });

  it('canonicalizes duplicate relationship signals before fingerprinting', async () => {
    const db = drizzle(pg);
    const actualScope = withTeam(db as never, TEAM_ID, USER_ID);
    let reverse = false;
    const evidence = (clusterId: string) => ({
      rawEventId: SUPPORT_ID,
      source: 'email' as const,
      provider: null,
      externalObjectId: null,
      role: 'document',
      strength: 'hard',
      associationSource: 'manual',
      authoritative: false,
      occurredAt: '2026-08-01T09:00:00.000Z',
      snippet: 'The signed Acme launch date is August 12.',
      clusterId,
    });
    const listEvidencePackArtifactClusters = vi.fn(() => {
      const ids = reverse ? ['cluster-b', 'cluster-a'] : ['cluster-a', 'cluster-b'];
      return Promise.resolve({
        clusters: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              id,
              artifactType: 'project' as const,
              canonicalName: 'Acme launch',
              status: 'active',
              relatedEvidence: id === 'cluster-a' ? [evidence(id), evidence(id)] : [evidence(id)],
            },
          ]),
        ),
        truncatedCandidateCount: 0,
      });
    });
    const scope = {
      ...actualScope,
      timeline: { ...actualScope.timeline, listEvidencePackArtifactClusters },
    };

    const first = await buildEvidencePack(scope, {
      purpose: 'proposal',
      anchorRawEventIds: [ANCHOR_ID],
    });
    reverse = true;
    const second = await buildEvidencePack(scope, {
      purpose: 'proposal',
      anchorRawEventIds: [ANCHOR_ID],
    });

    expect(first.items[1]?.relationshipSignals.map((signal) => signal.clusterId)).toEqual([
      'cluster-a',
      'cluster-b',
    ]);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it('records a machine-readable reason when evidence content is truncated', async () => {
    const db = drizzle(pg);
    for (const rawEventId of [ANCHOR_ID, LONG_SUPPORT_ID]) {
      await reconcileArtifactEvidence(db as never, {
        teamId: TEAM_ID,
        artifactType: 'project',
        canonicalName: 'Acme launch',
        status: 'active',
        rawEventId,
        role: 'discussion',
        strength: 'hard',
        anchors: [{ type: 'canonical_url', value: 'https://acme.test/launch', strength: 'hard' }],
      });
    }

    const pack = await buildEvidencePack(withTeam(db as never, TEAM_ID, USER_ID), {
      purpose: 'proposal',
      anchorRawEventIds: [ANCHOR_ID],
    });

    expect(pack.items.find((item) => item.rawEventId === LONG_SUPPORT_ID)).toMatchObject({
      truncated: true,
      truncationReason: 'content_limit',
    });
    expect(pack.metrics.omissionReasons).toMatchObject({ content_limit: 1 });
  });

  it('changes the fingerprint when full content changes beyond the visible prefix', async () => {
    const db = drizzle(pg);
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await pg.exec(`
      UPDATE raw_events
      SET content_text = repeat('a', 5000)
      WHERE id = '${CALENDAR_ID}';
    `);
    const first = await buildEvidencePack(scope, {
      purpose: 'answer',
      anchorRawEventIds: [CALENDAR_ID],
    });

    await pg.exec(`
      UPDATE raw_events
      SET content_text = repeat('a', 4999) || 'b'
      WHERE id = '${CALENDAR_ID}';
    `);
    const second = await buildEvidencePack(scope, {
      purpose: 'answer',
      anchorRawEventIds: [CALENDAR_ID],
    });

    expect(first.items[0]?.contentText).toBe(second.items[0]?.contentText);
    expect(first.items[0]?.contentFingerprint).not.toBe(second.items[0]?.contentFingerprint);
    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it('reports candidate-limit truncation before pack selection', async () => {
    const db = drizzle(pg);
    for (const rawEventId of [ANCHOR_ID, SUPPORT_ID, SLACK_NEW_ID]) {
      await reconcileArtifactEvidence(db as never, {
        teamId: TEAM_ID,
        artifactType: 'project',
        canonicalName: 'Acme launch',
        status: 'active',
        rawEventId,
        role: 'discussion',
        strength: 'hard',
        anchors: [{ type: 'canonical_url', value: 'https://acme.test/launch', strength: 'hard' }],
      });
    }
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const discovery = await scope.timeline.listEvidencePackArtifactClusters([ANCHOR_ID], 1);
    expect(discovery.truncatedCandidateCount).toBe(1);

    const actualDiscovery = scope.timeline.listEvidencePackArtifactClusters;
    const limitedScope = {
      ...scope,
      timeline: {
        ...scope.timeline,
        listEvidencePackArtifactClusters: vi.fn(
          async (rawEventIds: string[], maxCandidates?: number) => {
            const result = await actualDiscovery(rawEventIds, maxCandidates ?? 500);
            return { ...result, truncatedCandidateCount: 1 };
          },
        ),
      },
    };
    const pack = await buildEvidencePack(limitedScope, {
      purpose: 'proposal',
      anchorRawEventIds: [ANCHOR_ID],
    });
    expect(pack.metrics.truncated).toBe(true);
    expect(pack.metrics.omissionReasons).toMatchObject({ candidate_limit: 1 });
  });

  it('prefers a new evidence surface before more same-surface evidence', async () => {
    const db = drizzle(pg);
    for (const rawEventId of [ANCHOR_ID, SUPPORT_ID, SLACK_NEW_ID, SLACK_OLD_ID]) {
      await reconcileArtifactEvidence(db as never, {
        teamId: TEAM_ID,
        artifactType: 'project',
        canonicalName: 'Acme launch',
        status: 'active',
        rawEventId,
        role: 'discussion',
        strength: 'hard',
        anchors: [{ type: 'canonical_url', value: 'https://acme.test/launch', strength: 'hard' }],
      });
    }

    const pack = await buildEvidencePack(withTeam(db as never, TEAM_ID, USER_ID), {
      purpose: 'proposal',
      anchorRawEventIds: [ANCHOR_ID],
    });

    expect(pack.items.map((item) => item.rawEventId)).toEqual([
      ANCHOR_ID,
      SLACK_NEW_ID,
      SUPPORT_ID,
      SLACK_OLD_ID,
    ]);
    expect(pack.items[2]?.rankReasons).toContain('source_diversity');
  });

  it('discovers supporting evidence through every cluster attached to an anchor', async () => {
    const db = drizzle(pg);
    const link = async (rawEventId: string, canonicalName: string, url: string) =>
      reconcileArtifactEvidence(db as never, {
        teamId: TEAM_ID,
        artifactType: 'project',
        canonicalName,
        status: 'active',
        rawEventId,
        role: 'discussion',
        strength: 'hard',
        anchors: [{ type: 'canonical_url', value: url, strength: 'hard' }],
      });
    await link(ANCHOR_ID, 'Acme launch', 'https://acme.test/launch');
    await link(SUPPORT_ID, 'Acme launch', 'https://acme.test/launch');
    await link(ANCHOR_ID, 'Acme renewal', 'https://acme.test/renewal');
    await link(SLACK_NEW_ID, 'Acme renewal', 'https://acme.test/renewal');

    const pack = await buildEvidencePack(withTeam(db as never, TEAM_ID, USER_ID), {
      purpose: 'proposal',
      anchorRawEventIds: [ANCHOR_ID],
    });

    expect(pack.items.map((item) => item.rawEventId)).toEqual(
      expect.arrayContaining([ANCHOR_ID, SUPPORT_ID, SLACK_NEW_ID]),
    );
  });

  it('admits supporting evidence linked by an ordinary canonical URL', async () => {
    const db = drizzle(pg);
    for (const rawEventId of [ANCHOR_ID, SUPPORT_ID]) {
      await reconcileLinkArtifactsForRawEvent(db as never, {
        teamId: TEAM_ID,
        rawEventId,
        text: 'Review https://example.com/acme-launch?utm_source=timeline',
      });
    }

    const pack = await buildEvidencePack(withTeam(db as never, TEAM_ID, USER_ID), {
      purpose: 'proposal',
      anchorRawEventIds: [ANCHOR_ID],
    });

    expect(pack.items.map((item) => item.rawEventId)).toEqual([ANCHOR_ID, SUPPORT_ID]);
    expect(pack.items[1]?.relationshipSignals).toEqual([
      expect.objectContaining({ kind: 'artifact_association', strength: 'hard' }),
    ]);
  });
});
