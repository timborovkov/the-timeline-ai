import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStructuredInput, ChatStructuredResult } from '#src/llm/chat.js';
import type { EmbedResult } from '#src/llm/embed.js';
import type { SearchHit, SearchOpts } from '#src/qdrant/client.js';
import type { ZodType } from 'zod';

import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';
import { generateAndStoreTimelineMomentPresentation } from '#src/timeline-moments/generation.js';
import {
  buildTimelineMoments,
  timelineMomentLookupPlan,
  type TimelineMomentEvent,
} from '#src/timeline-moments/index.js';
import {
  buildTimelineMomentPresentationCacheFingerprint,
  buildTimelineMomentPresentationCacheKey,
} from '#src/timeline-moments/presentation.js';

// These tests protect the semantic retrieval contract the agent depends on:
// query text is embedded once, vector hits are only a first pass, and Postgres
// hydration still enforces team/visibility boundaries before evidence reaches
// chat, search, or outbound MCP callers.

const TEAM_A = '11111111-1111-1111-1111-111111111111';
const TEAM_B = '22222222-2222-2222-2222-222222222222';
const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OUTSIDER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const TEAM_EVENT = '00000000-0000-0000-0000-000000000101';
const PRIVATE_EVENT = '00000000-0000-0000-0000-000000000102';
const SPECIFIC_EVENT = '00000000-0000-0000-0000-000000000103';
const OTHER_TEAM_EVENT = '00000000-0000-0000-0000-000000000201';
const NULL_ANCHORED_ID = '00000000-0000-0000-0000-000000000301';
const RELATED_EVENT = '00000000-0000-0000-0000-000000000401';
const RELATED_PRIVATE_EVENT = '00000000-0000-0000-0000-000000000402';
const INTEGRATION_OBJECT_EVENT = '00000000-0000-0000-0000-000000000501';
const INTEGRATION_EXTERNAL_EVENT = '00000000-0000-0000-0000-000000000502';
const INTEGRATION_OTHER_TEAM_EVENT = '00000000-0000-0000-0000-000000000503';
const WORKFLOW_CI_EVENT = '00000000-0000-0000-0000-000000000504';
const WORKFLOW_DEPLOY_EVENT = '00000000-0000-0000-0000-000000000505';
const WORKFLOW_METADATA_EVENT = '00000000-0000-0000-0000-000000000506';
const CHAT_EVENT_A = '00000000-0000-0000-0000-000000000601';
const CHAT_EVENT_B = '00000000-0000-0000-0000-000000000602';
const CHAT_EVENT_C = '00000000-0000-0000-0000-000000000603';
const ARTIFACT_CLUSTER = '30000000-0000-0000-0000-000000000101';

const TEAM_FACT = '10000000-0000-0000-0000-000000000101';
const OTHER_TEAM_FACT = '10000000-0000-0000-0000-000000000201';
const ENTITY_ID = '20000000-0000-0000-0000-000000000101';

type Db = ReturnType<typeof drizzle>;

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES
      ('${TEAM_A}', 'search-team-a', 'Search Team A'),
      ('${TEAM_B}', 'search-team-b', 'Search Team B');

    INSERT INTO users (id, email, name)
    VALUES
      ('${OWNER}', 'search-owner@example.com', 'Search Owner'),
      ('${MEMBER}', 'search-member@example.com', 'Search Member'),
      ('${OUTSIDER}', 'search-outsider@example.com', 'Search Outsider');

    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_A}', '${OWNER}', 'owner'),
      ('${TEAM_A}', '${MEMBER}', 'member'),
      ('${TEAM_B}', '${OUTSIDER}', 'owner');

    INSERT INTO raw_events
      (id, team_id, author_user_id, visibility_owner_user_id, source, content_text, occurred_at, visibility, visibility_user_ids, source_metadata)
    VALUES
      ('${TEAM_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'web', 'Acme renewal needs a pricing proposal by Friday.', '2026-06-01T09:00:00Z', 'team', NULL, '{"kind":"team"}'::jsonb),
      ('${PRIVATE_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'web', 'Owner private compensation note for Acme.', '2026-06-01T10:00:00Z', 'private', NULL, '{"kind":"private"}'::jsonb),
      ('${SPECIFIC_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'slack', 'Specific-users Acme escalation for the member.', '2026-06-01T11:00:00Z', 'specific_users', ARRAY['${MEMBER}'::uuid], '{"kind":"specific"}'::jsonb),
      ('${RELATED_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'integration', 'GitHub PR merged for the Acme pricing proposal.', '2026-06-01T13:00:00Z', 'team', NULL, '{"kind":"related"}'::jsonb),
      ('${RELATED_PRIVATE_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'telegram', 'Private Acme pricing side note.', '2026-06-01T14:00:00Z', 'private', NULL, '{"kind":"private-related"}'::jsonb),
      ('${OTHER_TEAM_EVENT}', '${TEAM_B}', '${OUTSIDER}', '${OUTSIDER}', 'web', 'Other team Acme proposal should never hydrate.', '2026-06-01T12:00:00Z', 'team', NULL, '{"kind":"other-team"}'::jsonb);

    INSERT INTO entities (id, team_id, type, canonical_name)
    VALUES ('${ENTITY_ID}', '${TEAM_A}', 'company', 'Acme');

    INSERT INTO facts (id, team_id, raw_event_id, statement, confidence, model_version)
    VALUES
      ('${TEAM_FACT}', '${TEAM_A}', '${TEAM_EVENT}', 'Acme renewal needs pricing by Friday.', 0.95, 'test-model'),
      ('${OTHER_TEAM_FACT}', '${TEAM_B}', '${OTHER_TEAM_EVENT}', 'Other team Acme fact.', 0.95, 'test-model');
  `);
}

function hit(
  eventId: string | null,
  score: number,
  overrides: Partial<SearchHit['payload']> = {},
): SearchHit {
  return {
    id: eventId ?? NULL_ANCHORED_ID,
    score,
    payload: {
      team_id: TEAM_A,
      source_kind: 'raw_event',
      event_id: eventId,
      fact_id: null,
      object_id: null,
      note_id: null,
      change_id: null,
      entity_id: null,
      entity_ids: [],
      source: 'web',
      occurred_at: '2026-06-01T09:00:00.000Z',
      author_user_id: OWNER,
      visibility: 'team',
      visibility_user_ids: null,
      visibility_owner_user_id: OWNER,
      embedding_model: 'test-embedding-model',
      source_scope: 'event',
      source_id: eventId ?? NULL_ANCHORED_ID,
      chunk_index: 0,
      document_id: null,
      document_version_id: null,
      document_chunk_id: null,
      folder_id: null,
      owner_user_id: null,
      updated_at: null,
      meeting_id: null,
      meeting_chunk_id: null,
      speaker: null,
      ...overrides,
    },
  };
}

describe('withTeam timeline semantic search', () => {
  let pg: PGlite;
  let db: Db;
  let embeddedTexts: string[];
  let qdrantCalls: { teamId: string; userId: string; vector: number[]; opts: SearchOpts }[];
  let hits: SearchHit[];

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
    embeddedTexts = [];
    qdrantCalls = [];
    hits = [];
  }, 60_000);

  afterEach(async () => {
    await pg.close();
  });

  function qdrantSearch(
    teamId: string,
    userId: string,
    vector: number[],
    opts: SearchOpts,
  ): Promise<SearchHit[]> {
    qdrantCalls.push({ teamId, userId, vector, opts });
    return Promise.resolve(hits);
  }

  function scopeFor(userId: string) {
    return withTeam(db as never, TEAM_A, userId, {
      embed: ({ text }): Promise<EmbedResult> => {
        embeddedTexts.push(text);
        return Promise.resolve({ vector: [0.11, 0.22, 0.33], model: 'fake-embedding-model' });
      },
      qdrantSearch,
    });
  }

  it('embeds the query, forwards search filters, and hydrates ranked deduped events', async () => {
    hits = [
      hit(TEAM_EVENT, 0.7, {
        source_kind: 'raw_event',
        entity_ids: [ENTITY_ID],
      }),
      hit(TEAM_EVENT, 0.92, {
        source_kind: 'fact',
        fact_id: TEAM_FACT,
        entity_ids: [ENTITY_ID],
      }),
      hit(null, 0.99, { source_kind: 'object', event_id: null }),
      hit(OTHER_TEAM_EVENT, 0.98, { team_id: TEAM_B, fact_id: OTHER_TEAM_FACT }),
    ];

    const results = await scopeFor(OWNER).timeline.searchEvents({
      query: 'Acme proposal',
      limit: 5,
      from: new Date('2026-06-01T00:00:00Z'),
      to: new Date('2026-06-02T00:00:00Z'),
      source: 'web',
      entityIds: [ENTITY_ID],
      sourceKind: ['raw_event', 'fact'],
    });

    expect(embeddedTexts).toEqual(['Acme proposal']);
    expect(qdrantCalls).toEqual([
      {
        teamId: TEAM_A,
        userId: OWNER,
        vector: [0.11, 0.22, 0.33],
        opts: {
          limit: 5,
          from: new Date('2026-06-01T00:00:00Z'),
          to: new Date('2026-06-02T00:00:00Z'),
          source: 'web',
          entityIds: [ENTITY_ID],
          sourceKind: ['raw_event', 'fact'],
        },
      },
    ]);
    expect(results).toEqual([
      expect.objectContaining({
        eventId: TEAM_EVENT,
        score: 0.92,
        factIds: [TEAM_FACT],
        entityIds: [ENTITY_ID],
        snippet: 'Acme renewal needs pricing by Friday.',
      }),
    ]);
  });

  it('uses Postgres hydration as a second visibility filter for private and specific-user hits', async () => {
    hits = [
      hit(PRIVATE_EVENT, 0.9, { visibility: 'private', visibility_owner_user_id: OWNER }),
      hit(SPECIFIC_EVENT, 0.8, {
        source: 'slack',
        visibility: 'specific_users',
        visibility_user_ids: [MEMBER],
      }),
      hit(TEAM_EVENT, 0.7),
    ];

    await expect(scopeFor(OWNER).timeline.searchEvents({ query: 'Acme' })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: PRIVATE_EVENT }),
        expect.objectContaining({ eventId: TEAM_EVENT }),
      ]),
    );

    await expect(scopeFor(MEMBER).timeline.searchEvents({ query: 'Acme' })).resolves.toEqual([
      expect.objectContaining({ eventId: SPECIFIC_EVENT }),
      expect.objectContaining({ eventId: TEAM_EVENT }),
    ]);
  });

  it('drops cross-team fact ids even when a stale Qdrant payload points at a visible event', async () => {
    hits = [hit(TEAM_EVENT, 0.8, { fact_id: OTHER_TEAM_FACT })];

    const results = await scopeFor(OWNER).timeline.searchEvents({ query: 'Acme' });

    expect(results).toEqual([
      expect.objectContaining({
        eventId: TEAM_EVENT,
        factIds: [],
        snippet: 'Acme renewal needs a pricing proposal by Friday.',
      }),
    ]);
  });

  it('does not hydrate artifact context from legacy artifact_cluster_members', async () => {
    await pg.exec(`
      INSERT INTO artifact_clusters
        (id, team_id, artifact_type, canonical_name, status)
      VALUES
        ('${ARTIFACT_CLUSTER}', '${TEAM_A}', 'deal', 'Owner-only Acme acquisition', 'resolved');

      INSERT INTO artifact_cluster_members
        (team_id, cluster_id, raw_event_id, provider, external_object_id, role, strength, authoritative, metadata)
      VALUES
        ('${TEAM_A}', '${ARTIFACT_CLUSTER}', '${TEAM_EVENT}', 'telegram', 'chat:acme', 'report', 'human', false, '{"canonical_name":"Public Acme renewal","status":"open"}'::jsonb),
        ('${TEAM_A}', '${ARTIFACT_CLUSTER}', '${RELATED_EVENT}', 'github', 'repo#77', 'lifecycle_update', 'provider', true, '{"canonical_name":"GitHub Acme implementation","status":"active"}'::jsonb),
        ('${TEAM_A}', '${ARTIFACT_CLUSTER}', '${RELATED_PRIVATE_EVENT}', 'telegram', 'private:acme', 'lifecycle_update', 'human', true, '{"canonical_name":"Owner-only Acme acquisition","status":"resolved"}'::jsonb),
        ('${TEAM_A}', '${ARTIFACT_CLUSTER}', '${OTHER_TEAM_EVENT}', 'web', 'other-team:acme', 'lifecycle_update', 'human', true, '{"canonical_name":"Other-team Acme acquisition","status":"blocked"}'::jsonb);
    `);
    hits = [hit(TEAM_EVENT, 0.9)];

    const memberResults = await scopeFor(MEMBER).timeline.searchEvents({
      query: 'Acme renewal',
      limit: 5,
    });
    expect(memberResults[0]?.artifactCluster).toBeNull();

    const ownerResults = await scopeFor(OWNER).timeline.searchEvents({
      query: 'Acme renewal',
      limit: 5,
    });
    expect(ownerResults[0]?.artifactCluster).toBeNull();
  });

  it('does not hydrate a cluster whose joined cluster row belongs to another team', async () => {
    await pg.exec(`
      INSERT INTO artifact_clusters
        (id, team_id, artifact_type, canonical_name, status)
      VALUES
        ('${ARTIFACT_CLUSTER}', '${TEAM_B}', 'deal', 'Other-team Acme acquisition', 'resolved');

      INSERT INTO artifact_cluster_members
        (team_id, cluster_id, raw_event_id, provider, external_object_id, role, strength, authoritative, metadata)
      VALUES
        ('${TEAM_A}', '${ARTIFACT_CLUSTER}', '${TEAM_EVENT}', 'web', 'cross-team:acme', 'report', 'human', false, '{"canonical_name":"Cross-team Acme","status":"resolved"}'::jsonb);
    `);
    hits = [hit(TEAM_EVENT, 0.9)];

    const results = await scopeFor(OWNER).timeline.searchEvents({
      query: 'Acme renewal',
      limit: 5,
    });

    expect(results[0]).toMatchObject({ eventId: TEAM_EVENT });
    expect(results[0]?.artifactCluster).toBeNull();
  });

  it('hydrates association-backed artifact context and enforces association visibility floors', async () => {
    const baseEvidence = '40000000-0000-0000-0000-000000000101';
    const ownerOnlyEvidence = '40000000-0000-0000-0000-000000000102';
    await pg.exec(`
      INSERT INTO artifact_clusters
        (id, team_id, artifact_cluster_kind, artifact_type, canonical_name, status)
      VALUES
        ('${ARTIFACT_CLUSTER}', '${TEAM_A}', 'customer_project', 'project', 'Acme pricing rollout', 'active');

      INSERT INTO reconciliation_evidence
        (id, team_id, raw_event_id, source, provider, external_object_id, event_type, occurred_at, visibility, actor, content_digest, normalizer_version, dedupe_key)
      VALUES
        ('${baseEvidence}', '${TEAM_A}', '${TEAM_EVENT}', 'web', 'email', 'msg-acme-pricing', 'email.thread', '2026-06-01T09:00:00Z', 'team', '{}'::jsonb, 'digest:base', 'test-v1', 'evidence:base'),
        ('${ownerOnlyEvidence}', '${TEAM_A}', '${RELATED_EVENT}', 'integration', 'github', 'repo#88', 'github.issue.updated', '2026-06-01T13:00:00Z', 'team', '{}'::jsonb, 'digest:owner-only', 'test-v1', 'evidence:owner-only');

      INSERT INTO artifact_evidence_associations
        (team_id, cluster_id, evidence_id, role, strength, association_source, source_refs, visibility, visibility_floor, visibility_floor_owner_user_id, metadata, dedupe_key)
      VALUES
        ('${TEAM_A}', '${ARTIFACT_CLUSTER}', '${baseEvidence}', 'origin', 'human', 'human', '[]'::jsonb, 'team', 'team', NULL, '{"canonical_name":"Acme pricing rollout","status":"active"}'::jsonb, 'association:base'),
        ('${TEAM_A}', '${ARTIFACT_CLUSTER}', '${ownerOnlyEvidence}', 'lifecycle_update', 'provider', 'authoritative_provider', '[]'::jsonb, 'team', 'private', '${OWNER}', '{"canonical_name":"Owner-only Acme rollout state","status":"blocked"}'::jsonb, 'association:owner-only');
    `);
    hits = [hit(TEAM_EVENT, 0.9)];

    const memberResults = await scopeFor(MEMBER).timeline.searchEvents({
      query: 'Acme renewal',
      limit: 5,
    });
    expect(memberResults[0]?.artifactCluster).toMatchObject({
      id: ARTIFACT_CLUSTER,
      artifactType: 'project',
      canonicalName: 'Acme pricing rollout',
      status: 'active',
    });
    expect(
      memberResults[0]?.artifactCluster?.relatedEvidence.map((evidence) => evidence.rawEventId),
    ).toEqual([TEAM_EVENT]);

    const ownerResults = await scopeFor(OWNER).timeline.searchEvents({
      query: 'Acme renewal',
      limit: 5,
    });
    expect(ownerResults[0]?.artifactCluster).toMatchObject({
      canonicalName: 'Owner-only Acme rollout state',
      status: 'blocked',
    });
    expect(ownerResults[0]?.artifactCluster?.relatedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rawEventId: RELATED_EVENT,
          provider: 'github',
          role: 'lifecycle_update',
          authoritative: true,
        }),
      ]),
    );
  });

  it('hydrates generic integration moment ids by object id or event id under team visibility', async () => {
    await pg.exec(`
      INSERT INTO raw_events
        (id, team_id, author_user_id, visibility_owner_user_id, source, content_text, occurred_at, visibility, visibility_user_ids, source_metadata)
      VALUES
        ('${INTEGRATION_OBJECT_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'integration', 'Provider object update.', '2026-06-01T15:00:00Z', 'team', NULL, '{"provider":"webhook","event_type":"object.updated","external_object_id":"shared-key"}'::jsonb),
        ('${INTEGRATION_EXTERNAL_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'integration', 'Provider delivery update.', '2026-06-01T15:05:00Z', 'team', NULL, '{"provider":"webhook","event_type":"delivery.received","external_event_id":"shared-key"}'::jsonb),
        ('${INTEGRATION_OTHER_TEAM_EVENT}', '${TEAM_B}', '${OUTSIDER}', '${OUTSIDER}', 'integration', 'Other team provider delivery update.', '2026-06-01T15:10:00Z', 'team', NULL, '{"provider":"webhook","event_type":"delivery.received","external_event_id":"shared-key"}'::jsonb);
    `);

    const plan = timelineMomentLookupPlan('moment:integration:webhook:shared-key');
    expect(plan).not.toBeNull();
    if (!plan) throw new Error('Expected integration moment lookup plan');

    const rows = await scopeFor(OWNER).timeline.listEventsForMomentLookup(plan);

    expect(rows.map((row) => row.id)).toEqual([
      INTEGRATION_EXTERNAL_EVENT,
      INTEGRATION_OBJECT_EVENT,
    ]);
  });

  it('hydrates GitHub workflow moment ids by workflow name without overfetching the branch', async () => {
    await pg.exec(`
      INSERT INTO raw_events
        (id, team_id, author_user_id, visibility_owner_user_id, source, content_text, occurred_at, visibility, visibility_user_ids, source_metadata)
      VALUES
        ('${WORKFLOW_CI_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'integration', 'GitHub workflow "CI" #1603 on timborovkov/audit-ai success', '2026-06-27T18:32:00Z', 'team', NULL, '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb),
        ('${WORKFLOW_METADATA_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'integration', 'GitHub workflow run #1604 on timborovkov/audit-ai success', '2026-06-27T18:40:00Z', 'team', NULL, '{"provider":"github","event_type":"workflow_run.success","workflow_name":"CI","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main","workflow_name":"CI"}}'::jsonb),
        ('${WORKFLOW_DEPLOY_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'integration', 'GitHub workflow "Deploy" #44 on timborovkov/audit-ai success', '2026-06-27T18:36:00Z', 'team', NULL, '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb);
    `);

    const plan = timelineMomentLookupPlan(
      'moment:integration:github:workflow_run:timborovkov/audit-ai:CI:main:2026-06-27',
    );
    expect(plan).not.toBeNull();
    if (!plan) throw new Error('Expected GitHub workflow moment lookup plan');

    const rows = await scopeFor(OWNER).timeline.listEventsForMomentLookup(plan);

    expect(rows.map((row) => row.id)).toEqual([WORKFLOW_METADATA_EVENT, WORKFLOW_CI_EVENT]);
  });

  it('persists timeline moment presentations by exact cache provenance and team', async () => {
    const scope = scopeFor(OWNER);
    const events = await scope.timeline.getEventsByIds([TEAM_EVENT]);
    const [moment] = buildTimelineMoments(events as TimelineMomentEvent[], new Map());
    if (!moment) throw new Error('expected moment');
    const cacheKey = buildTimelineMomentPresentationCacheKey({ teamId: TEAM_A, moment });
    const cacheFingerprint = buildTimelineMomentPresentationCacheFingerprint(cacheKey);

    await scope.timeline.upsertMomentPresentation({
      cacheKey,
      suggestion: {
        title: 'Pricing proposal due Friday',
        summary: 'Acme needs a pricing proposal by Friday.',
        previewEventIds: [TEAM_EVENT],
        topicLabels: ['pricing'],
        impactHints: [],
        crossSourceLinks: [],
      },
    });

    const records = await scope.timeline.listMomentPresentations([cacheKey]);
    expect(Object.keys(records)).toEqual([cacheFingerprint]);
    expect(records[cacheFingerprint]).toMatchObject({
      cacheFingerprint,
      cacheKey,
      suggestion: {
        title: 'Pricing proposal due Friday',
        previewEventIds: [TEAM_EVENT],
      },
    });

    await expect(
      scope.timeline.listMomentPresentations([
        { ...cacheKey, visibleSourceContentHash: 'stale-content-hash' },
      ]),
    ).resolves.toEqual({});

    await expect(
      scope.timeline.upsertMomentPresentation({
        cacheKey: { ...cacheKey, teamId: TEAM_B },
        suggestion: {
          title: 'Wrong team',
          summary: 'This should be rejected.',
          previewEventIds: [TEAM_EVENT],
          topicLabels: [],
          impactHints: [],
          crossSourceLinks: [],
        },
      }),
    ).rejects.toThrow(/another team/);
  });

  it('generates and stores timeline moment presentation through the shared LLM boundary', async () => {
    await pg.exec(`
      INSERT INTO raw_events
        (id, team_id, author_user_id, visibility_owner_user_id, source, content_text, occurred_at, visibility, visibility_user_ids, source_metadata)
      VALUES
        ('${CHAT_EVENT_A}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'telegram', 'Can we meet at 16:20 to review the launch checklist?', '2026-06-27T18:00:00Z', 'team', NULL, '{"tg_chat_id":"chat-a","tg_sender_name":"Ada"}'::jsonb),
        ('${CHAT_EVENT_B}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'telegram', '16:20 works for me.', '2026-06-27T18:01:00Z', 'team', NULL, '{"tg_chat_id":"chat-a","tg_sender_name":"Tim"}'::jsonb),
        ('${CHAT_EVENT_C}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'telegram', 'Booked. Use the daily call link.', '2026-06-27T18:02:00Z', 'team', NULL, '{"tg_chat_id":"chat-a","tg_sender_name":"Ada"}'::jsonb);
    `);
    const scope = scopeFor(OWNER);
    const events = await scope.timeline.getEventsByIds([CHAT_EVENT_A, CHAT_EVENT_B, CHAT_EVENT_C]);
    const [moment] = buildTimelineMoments(events as TimelineMomentEvent[], new Map());
    if (!moment) throw new Error('expected moment');
    const cacheKey = buildTimelineMomentPresentationCacheKey({ teamId: TEAM_A, moment });
    const chatStructured = vi.fn(
      <TSchema extends ZodType>(
        input: ChatStructuredInput<TSchema>,
      ): Promise<ChatStructuredResult<TSchema>> =>
        Promise.resolve({
          model: 'test/model',
          object: input.schema.parse({
            title: 'Launch checklist meeting booked at 16:20',
            summary: 'The group agreed to meet at 16:20 for launch checklist review.',
            previewEventIds: [CHAT_EVENT_A, CHAT_EVENT_B, CHAT_EVENT_C],
            topicLabels: ['launch'],
            impactHints: [],
            crossSourceLinks: [],
          }),
        }),
    );

    await expect(
      generateAndStoreTimelineMomentPresentation(
        db as never,
        scope,
        {
          rawEventIds: [CHAT_EVENT_A, CHAT_EVENT_B, CHAT_EVENT_C],
          cacheKey,
        },
        { chatStructured },
      ),
    ).resolves.toMatchObject({
      status: 'stored',
      momentId: moment.id,
    });

    const records = await scope.timeline.listMomentPresentations([cacheKey]);
    const cacheFingerprint = buildTimelineMomentPresentationCacheFingerprint(cacheKey);
    expect(records[cacheFingerprint]?.suggestion.title).toBe(
      'Launch checklist meeting booked at 16:20',
    );
    expect(chatStructured).toHaveBeenCalledOnce();
  });

  it('requires membership before embedding or searching', async () => {
    await expect(scopeFor(OUTSIDER).timeline.searchEvents({ query: 'Acme' })).rejects.toThrow(
      /not a member/i,
    );
    expect(embeddedTexts).toEqual([]);
    expect(qdrantCalls).toEqual([]);
  });
});
