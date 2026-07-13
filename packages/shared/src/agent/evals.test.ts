import { PGlite } from '@electric-sql/pglite';
import {
  calendarEvents,
  documentChunks,
  documents,
  documentVersions,
  entities,
} from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SearchHit } from '#src/qdrant/client.js';
import type { SearchOpts } from '#src/qdrant/client.js';

import { buildAgentTools } from '#src/agent/tools.js';
import { withTeam } from '#src/team-scope.js';
import {
  type AgentEvalToolName,
  answerFromToolResult,
  buildDocumentSearchHit,
  buildMeetingSearchHit,
  buildSearchHit,
  runAgentToolEval,
} from '#src/test/agent-eval-harness.js';
import { applyDbMigrations } from '#src/test/pglite.js';

// Fast agent evals: these run the real Timeline agent tools against seeded
// workspace state with deterministic retrieval. Success means the tool trace
// and synthesized answer have the right evidence and no cross-team/private
// leakage. Live model quality belongs in a separate, explicit eval suite.

const TEAM_A = '11111111-1111-1111-1111-111111111111';
const TEAM_B = '22222222-2222-2222-2222-222222222222';
const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_USER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const TEAM_EVENT = '00000000-0000-0000-0000-000000000401';
const PRIVATE_EVENT = '00000000-0000-0000-0000-000000000402';
const SPECIFIC_EVENT = '00000000-0000-0000-0000-000000000403';
const OTHER_TEAM_EVENT = '00000000-0000-0000-0000-000000000404';
const CI_EVENT_A = '00000000-0000-0000-0000-000000000405';
const CI_EVENT_B = '00000000-0000-0000-0000-000000000406';
const MEETING_EVENT_ID = '00000000-0000-0000-0000-000000000407';
const MONDAY_ITEM_EVENT = '00000000-0000-0000-0000-000000000408';
const MONDAY_SUBITEM_EVENT = '00000000-0000-0000-0000-000000000409';
const MONDAY_HELPER_EVENT = '00000000-0000-0000-0000-000000000410';
const MONDAY_INTEGRATION = '00000000-0000-0000-0000-000000000411';
const FACT_ID = '10000000-0000-0000-0000-000000000401';
const TASK_ID = '20000000-0000-0000-0000-000000000401';
const OBJECT_ID = '20000000-0000-0000-0000-000000000402';
const PERSON_ID = '20000000-0000-0000-0000-000000000403';
const CALENDAR_ID = '30000000-0000-0000-0000-000000000401';
const DOCUMENT_ID = '40000000-0000-0000-0000-000000000401';
const DOCUMENT_VERSION_ID = '40000000-0000-0000-0000-000000000402';
const DOCUMENT_CHUNK_ID = '40000000-0000-0000-0000-000000000403';
const MEETING_ID = '50000000-0000-0000-0000-000000000401';
const MEETING_CHUNK_ID = '50000000-0000-0000-0000-000000000402';

type Db = ReturnType<typeof drizzle>;

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES
      ('${TEAM_A}', 'eval-team-a', 'Eval Team A'),
      ('${TEAM_B}', 'eval-team-b', 'Eval Team B');

    INSERT INTO users (id, email, name)
    VALUES
      ('${OWNER}', 'eval-owner@example.com', 'Eval Owner'),
      ('${MEMBER}', 'eval-member@example.com', 'Eval Member'),
      ('${OTHER_USER}', 'eval-other@example.com', 'Eval Other');

    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_A}', '${OWNER}', 'owner'),
      ('${TEAM_A}', '${MEMBER}', 'member'),
      ('${TEAM_B}', '${OTHER_USER}', 'owner');

    INSERT INTO raw_events
      (id, team_id, author_user_id, visibility_owner_user_id, source, content_text, occurred_at, visibility, visibility_user_ids, source_metadata)
    VALUES
      ('${TEAM_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'web', 'Acme renewal needs a pricing proposal by Friday.', '2026-06-01T09:00:00Z', 'team', NULL, '{}'::jsonb),
      ('${PRIVATE_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'web', 'Owner private Acme compensation detail.', '2026-06-01T10:00:00Z', 'private', NULL, '{}'::jsonb),
      ('${SPECIFIC_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'slack', 'Member-only Acme escalation.', '2026-06-01T11:00:00Z', 'specific_users', ARRAY['${MEMBER}'::uuid], '{}'::jsonb),
      ('${OTHER_TEAM_EVENT}', '${TEAM_B}', '${OTHER_USER}', '${OTHER_USER}', 'web', 'Other-team Acme secret.', '2026-06-01T12:00:00Z', 'team', NULL, '{}'::jsonb),
      ('${CI_EVENT_A}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'integration', 'GitHub workflow "CI" #1603 on timborovkov/audit-ai success', '2026-06-27T18:32:00Z', 'team', NULL, '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb),
      ('${CI_EVENT_B}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'integration', 'GitHub workflow "CI" #1602 on timborovkov/audit-ai success', '2026-06-27T18:08:00Z', 'team', NULL, '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb),
      ('${MONDAY_ITEM_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'integration', 'Monday item updated on Ext-Faba: Checkout redesign\nStatus: Working on it\nOwner: Fabian', '2026-07-12T12:00:00Z', 'team', NULL, '{"provider":"monday","event_type":"item.updated","monday_board_id":"board-faba","monday_board_name":"Ext-Faba","monday_item_board_id":"board-faba","monday_item_id":"item-faba-1","monday_record_kind":"item"}'::jsonb),
      ('${MONDAY_SUBITEM_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'integration', 'Monday subitem updated on Ext-Faba: Verify checkout analytics\nParent: Checkout redesign\nStatus: Open', '2026-07-12T12:05:00Z', 'team', NULL, '{"provider":"monday","event_type":"subitem.updated","monday_board_id":"board-faba","monday_board_name":"Ext-Faba","monday_item_board_id":"subitems-board-faba","monday_item_id":"subitem-faba-1","monday_parent_item_id":"item-faba-1","monday_record_kind":"subitem"}'::jsonb),
      ('${MONDAY_HELPER_EVENT}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'integration', 'Monday item updated on Subitems of Ext-Faba: Legacy closed item\nStatus: Done', '2022-07-12T12:05:00Z', 'team', NULL, '{"provider":"monday","event_type":"item.updated","monday_board_id":"subitems-board-faba","monday_board_name":"Subitems of Ext-Faba","monday_item_board_id":"subitems-board-faba","monday_item_id":"legacy-subitem","monday_record_kind":"item"}'::jsonb),
      ('${MEETING_EVENT_ID}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'meeting', 'Acme renewal meeting transcript fallback summary.', '2026-06-02T14:00:00Z', 'team', NULL, '{"meeting_id":"${MEETING_ID}"}'::jsonb);

    INSERT INTO integrations
      (id, team_id, connected_by_user_id, provider, display_name, external_account_id, enabled)
    VALUES
      ('${MONDAY_INTEGRATION}', '${TEAM_A}', '${OWNER}', 'monday', 'Monday eval', 'monday-eval', true);

    INSERT INTO integration_selections
      (integration_id, selection_kind, external_id, external_label)
    VALUES
      ('${MONDAY_INTEGRATION}', 'monday.board', 'board-faba', 'Ext-Faba');

    INSERT INTO facts (id, team_id, raw_event_id, statement, confidence, model_version)
    VALUES ('${FACT_ID}', '${TEAM_A}', '${TEAM_EVENT}', 'Acme renewal needs pricing by Friday.', 0.96, 'eval-model');

    INSERT INTO meetings
      (id, team_id, created_by_user_id, platform, meeting_url, title, status, default_visibility, started_at, ended_at)
    VALUES
      ('${MEETING_ID}', '${TEAM_A}', '${OWNER}', 'meet', 'https://meet.example.test/acme-renewal', 'Acme renewal review', 'completed', 'team', '2026-06-02T14:00:00Z', '2026-06-02T14:30:00Z');

    INSERT INTO meeting_transcript_chunks
      (id, meeting_id, team_id, speaker, text, start_ms, end_ms, raw_event_id)
    VALUES
      ('${MEETING_CHUNK_ID}', '${MEETING_ID}', '${TEAM_A}', 'Maya', 'Acme renewal action: Sam owns migration date approval before July 6.', 12000, 18000, '${MEETING_EVENT_ID}');
  `);
}

function hit(
  eventId: string,
  score: number,
  overrides: Partial<SearchHit['payload']> = {},
): SearchHit {
  return buildSearchHit({
    teamId: TEAM_A,
    eventId,
    score,
    authorUserId: OWNER,
    visibilityOwnerUserId: OWNER,
    factId: eventId === TEAM_EVENT ? FACT_ID : null,
    source: eventId === SPECIFIC_EVENT ? 'slack' : 'web',
    overrides,
  });
}

function docHit(score: number): SearchHit {
  return buildDocumentSearchHit({
    teamId: TEAM_A,
    chunkId: DOCUMENT_CHUNK_ID,
    documentId: DOCUMENT_ID,
    documentVersionId: DOCUMENT_VERSION_ID,
    score,
    authorUserId: OWNER,
    visibilityOwnerUserId: OWNER,
  });
}

function meetingHit(score: number): SearchHit {
  return buildMeetingSearchHit({
    teamId: TEAM_A,
    eventId: MEETING_EVENT_ID,
    meetingId: MEETING_ID,
    meetingChunkId: MEETING_CHUNK_ID,
    score,
    authorUserId: OWNER,
    visibilityOwnerUserId: OWNER,
    speaker: 'Maya',
  });
}

async function runToolEval(
  db: Db,
  userId: string,
  name: AgentEvalToolName,
  input: unknown,
  hits: SearchHit[] = [],
  onQdrantSearch?: (options: SearchOpts) => void,
  onEmbed?: () => void,
) {
  return runAgentToolEval({
    db: db as never,
    teamId: TEAM_A,
    userId,
    toolName: name,
    toolInput: input,
    hits,
    ...(onEmbed
      ? {
          embed: ({ text }: { text: string }) => {
            onEmbed();
            return Promise.resolve({
              vector: text.includes('Acme') ? [0.9, 0.1, 0.1] : [0.1, 0.1, 0.1],
              model: 'eval-embed',
            });
          },
        }
      : {}),
    ...(onQdrantSearch ? { onQdrantSearch } : {}),
  });
}

describe('agent tool evals', () => {
  let pg: PGlite;
  let db: Db;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);

    await db.insert(entities).values({
      id: TASK_ID,
      teamId: TEAM_A,
      type: 'task',
      canonicalName: 'Send Acme pricing proposal',
      status: 'todo',
      dueAt: new Date('2026-06-05T17:00:00Z'),
    });
    await db.insert(entities).values({
      id: OBJECT_ID,
      teamId: TEAM_A,
      type: 'company',
      canonicalName: 'Acme',
      status: 'active',
    });
    await db.insert(entities).values({
      id: PERSON_ID,
      teamId: TEAM_A,
      type: 'person',
      canonicalName: 'Ada Lovelace',
      status: 'active',
    });
    await db.insert(calendarEvents).values({
      id: CALENDAR_ID,
      teamId: TEAM_A,
      createdByUserId: OWNER,
      title: 'Acme renewal review',
      startAt: new Date('2026-06-04T15:00:00Z'),
      endAt: new Date('2026-06-04T15:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      agentSuggested: true,
    });
    await db.insert(documents).values({
      id: DOCUMENT_ID,
      teamId: TEAM_A,
      name: 'Acme rollout notes.txt',
      ownerUserId: OWNER,
      visibility: 'team',
    });
    await db.insert(documentVersions).values({
      id: DOCUMENT_VERSION_ID,
      teamId: TEAM_A,
      documentId: DOCUMENT_ID,
      version: 1,
      objectKey: 'team-a/documents/acme-rollout-notes/v1.txt',
      byteSize: 512,
      contentType: 'text/plain',
      uploadedByUserId: OWNER,
      processingStatus: 'embedded',
    });
    await db.insert(documentChunks).values({
      id: DOCUMENT_CHUNK_ID,
      teamId: TEAM_A,
      documentId: DOCUMENT_ID,
      documentVersionId: DOCUMENT_VERSION_ID,
      chunkIndex: 0,
      representationKind: 'source_text',
      text: 'Acme rollout launch criterion: the security review must be signed off before go-live.',
      tokenCount: 14,
      summary: 'Acme rollout requires security signoff before go-live.',
    });
  }, 60_000);

  afterEach(async () => {
    await pg.close();
  });

  it('answers a timeline question with cited evidence from accessible events', async () => {
    // Product behavior: chat should ground factual timeline answers in source
    // events, not naked memory or invented claims.
    const evalRun = await runToolEval(db, OWNER, 'search_timeline', { query: 'Acme proposal' }, [
      hit(TEAM_EVENT, 0.95),
    ]);

    expect(evalRun.trace).toEqual([
      expect.objectContaining({ tool: 'search_timeline', input: { query: 'Acme proposal' } }),
    ]);
    expect(evalRun.answer).toContain('Acme renewal needs pricing by Friday.');
    expect(evalRun.answer).toContain(`[event:${TEAM_EVENT}]`);
  });

  it('bundles integration-heavy timeline answers into cited moments', async () => {
    // Product behavior: chat should not read a burst of workflow webhooks as
    // separate user-facing facts when provider metadata shows one work moment.
    const evalRun = await runToolEval(
      db,
      OWNER,
      'search_timeline_moments',
      { query: 'CI audit-ai', source: 'integration' },
      [
        hit(CI_EVENT_A, 0.95, {
          source: 'integration',
          occurred_at: '2026-06-27T18:32:00.000Z',
        }),
        hit(CI_EVENT_B, 0.89, {
          source: 'integration',
          occurred_at: '2026-06-27T18:08:00.000Z',
        }),
      ],
    );

    expect(evalRun.trace).toEqual([
      expect.objectContaining({
        tool: 'search_timeline_moments',
        input: { query: 'CI audit-ai', source: 'integration' },
      }),
    ]);
    expect(evalRun.answer).toContain('CI passed on timborovkov/audit-ai');
    expect(evalRun.answer).toContain('(2 events)');
    expect(evalRun.answer).toContain(`[event:${CI_EVENT_A}]`);
    expect(evalRun.answer).toContain(`[event:${CI_EVENT_B}]`);
  });

  it('searches provider-backed integration events with fenced snippets', async () => {
    // Product behavior: when the user asks about a third-party system, the
    // agent should use provider-scoped integration retrieval and treat synced
    // content as untrusted external data.
    const evalRun = await runToolEval(
      db,
      OWNER,
      'search_integration_events',
      { query: 'CI audit-ai', provider: 'github', limit: 5 },
      [
        hit(CI_EVENT_A, 0.95, {
          source: 'integration',
          occurred_at: '2026-06-27T18:32:00.000Z',
        }),
        hit(CI_EVENT_B, 0.89, {
          source: 'integration',
          occurred_at: '2026-06-27T18:08:00.000Z',
        }),
      ],
    );

    expect(evalRun.trace).toEqual([
      expect.objectContaining({
        tool: 'search_integration_events',
        input: { query: 'CI audit-ai', provider: 'github', limit: 5 },
      }),
    ]);
    const output = evalRun.output as {
      count: number;
      results: { event_id: string; snippet: string }[];
    };
    expect(output.count).toBe(2);
    expect(output.results.map((row) => row.event_id)).toEqual([CI_EVENT_A, CI_EVENT_B]);
    expect(output.results[0]?.snippet).toContain('<external_content source="integration"');
    expect(output.results[1]?.snippet).toContain('<external_content source="integration"');
    expect(evalRun.answer).toContain(`[event:${CI_EVENT_A}]`);
    expect(evalRun.answer).toContain(`[event:${CI_EVENT_B}]`);
  });

  it('answers monday board questions with parent items and their cited subitems', async () => {
    // Product behavior: selecting a Monday parent board must make its real items and classic
    // subitems jointly retrievable. A hidden helper board must never replace the parent board in
    // the answer, and the agent must not claim there are no open items when cited records exist.
    const evalRun = await runToolEval(
      db,
      OWNER,
      'search_integration_events',
      { query: 'open Ext-Faba board items including subitems', provider: 'monday', limit: 10 },
      [
        hit(MONDAY_ITEM_EVENT, 0.98, {
          source: 'integration',
          occurred_at: '2026-07-12T12:00:00.000Z',
        }),
        hit(MONDAY_SUBITEM_EVENT, 0.96, {
          source: 'integration',
          occurred_at: '2026-07-12T12:05:00.000Z',
        }),
        hit(MONDAY_HELPER_EVENT, 0.94, {
          source: 'integration',
          occurred_at: '2022-07-12T12:05:00.000Z',
        }),
      ],
    );

    const output = evalRun.output as {
      count: number;
      results: { event_id: string; snippet: string }[];
    };
    expect(output.count).toBe(2);
    expect(output.results.map((result) => result.event_id)).toEqual([
      MONDAY_ITEM_EVENT,
      MONDAY_SUBITEM_EVENT,
    ]);
    expect(evalRun.answer).toContain('Checkout redesign');
    expect(evalRun.answer).toContain('Verify checkout analytics');
    expect(evalRun.answer).toContain('Parent: Checkout redesign');
    expect(evalRun.answer).toContain(`[event:${MONDAY_ITEM_EVENT}]`);
    expect(evalRun.answer).toContain(`[event:${MONDAY_SUBITEM_EVENT}]`);
    expect(evalRun.answer).not.toContain('Subitems of Ext-Faba');
  });

  it('finds selected monday items when a stale helper-board hit ranks first', async () => {
    // Product behavior: provider and source-selection filtering must not consume the requested
    // result budget before valid evidence is considered. Otherwise one stale helper hit can make
    // the agent report that a selected board has no matching items.
    const evalRun = await runToolEval(
      db,
      OWNER,
      'search_integration_events',
      { query: 'Ext-Faba checkout', provider: 'monday', limit: 1 },
      [
        hit(MONDAY_HELPER_EVENT, 0.99, {
          source: 'integration',
          occurred_at: '2022-07-12T12:05:00.000Z',
        }),
        hit(MONDAY_ITEM_EVENT, 0.98, {
          source: 'integration',
          occurred_at: '2026-07-12T12:00:00.000Z',
        }),
      ],
    );

    const output = evalRun.output as {
      count: number;
      results: { event_id: string }[];
    };
    expect(output.count).toBe(1);
    expect(output.results).toEqual([expect.objectContaining({ event_id: MONDAY_ITEM_EVENT })]);
    expect(evalRun.answer).toContain('Checkout redesign');
  });

  it('enforces monday source selections when the provider filter is omitted', async () => {
    const evalRun = await runToolEval(
      db,
      OWNER,
      'search_integration_events',
      { query: 'Ext-Faba checkout', limit: 10 },
      [
        hit(MONDAY_HELPER_EVENT, 0.99, { source: 'integration' }),
        hit(MONDAY_ITEM_EVENT, 0.98, { source: 'integration' }),
      ],
    );

    const output = evalRun.output as {
      count: number;
      results: { event_id: string }[];
    };
    expect(output.count).toBe(1);
    expect(output.results).toEqual([expect.objectContaining({ event_id: MONDAY_ITEM_EVENT })]);
  });

  it('filters stale monday sources before applying the semantic result limit', async () => {
    const staleHits = Array.from({ length: 201 }, (_, index) =>
      hit(MONDAY_HELPER_EVENT, 1 - index / 1000, { source: 'integration' }),
    );
    const evalRun = await runToolEval(
      db,
      OWNER,
      'search_integration_events',
      { query: 'Ext-Faba checkout', provider: 'monday', limit: 1 },
      [...staleHits, hit(MONDAY_ITEM_EVENT, 0.79, { source: 'integration' })],
    );

    const output = evalRun.output as {
      count: number;
      results: { event_id: string }[];
    };
    expect(output.count).toBe(1);
    expect(output.results).toEqual([expect.objectContaining({ event_id: MONDAY_ITEM_EVENT })]);
  });

  it('embeds an integration query once while scanning stale semantic pages', async () => {
    const staleHits = Array.from({ length: 201 }, (_, index) =>
      hit(MONDAY_HELPER_EVENT, 1 - index / 1000, { source: 'integration' }),
    );
    let embeddings = 0;

    const evalRun = await runToolEval(
      db,
      OWNER,
      'search_integration_events',
      { query: 'Acme Ext-Faba checkout', provider: 'monday', limit: 1 },
      [...staleHits, hit(MONDAY_ITEM_EVENT, 0.79, { source: 'integration' })],
      undefined,
      () => {
        embeddings += 1;
      },
    );

    expect((evalRun.output as { count: number }).count).toBe(1);
    expect(embeddings).toBe(1);
  });

  it('stops integration retrieval after enough ranked candidates are found', async () => {
    await pg.exec(`
      INSERT INTO raw_events
        (id, team_id, author_user_id, visibility_owner_user_id, source, content_text, occurred_at, visibility, source_metadata)
      SELECT
        ('70000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
        '${TEAM_A}'::uuid,
        '${OWNER}'::uuid,
        '${OWNER}'::uuid,
        'integration',
        'Older selected Monday item ' || series::text,
        '2025-01-01T00:00:00Z'::timestamptz + series * interval '1 second',
        'team',
        '{"provider":"monday","monday_board_id":"board-faba"}'::jsonb
      FROM generate_series(1, 2001) AS series;
    `);
    let qdrantSearches = 0;

    const evalRun = await runToolEval(
      db,
      OWNER,
      'search_integration_events',
      { query: 'Ext-Faba checkout', provider: 'monday', limit: 1 },
      [hit(MONDAY_ITEM_EVENT, 0.99, { source: 'integration' })],
      () => {
        qdrantSearches += 1;
      },
    );

    const output = evalRun.output as { count: number };
    expect(output.count).toBe(1);
    expect(qdrantSearches).toBe(1);
  });

  it('answers document questions with cited chunk evidence', async () => {
    // Product behavior: uploaded docs should become cited answer evidence
    // without first being promoted into canonical workspace objects.
    const evalRun = await runToolEval(
      db,
      OWNER,
      'search_documents',
      { query: 'Acme rollout security signoff', limit: 3 },
      [docHit(0.97)],
    );

    expect(evalRun.trace).toEqual([
      expect.objectContaining({
        tool: 'search_documents',
        input: { query: 'Acme rollout security signoff', limit: 3 },
      }),
    ]);
    const output = evalRun.output as {
      count: number;
      results: {
        document_id: string;
        document_version_id: string;
        document_chunk_id: string;
        citation: string;
        snippet: string;
      }[];
    };
    expect(output.count).toBe(1);
    expect(output.results[0]).toMatchObject({
      document_id: DOCUMENT_ID,
      document_version_id: DOCUMENT_VERSION_ID,
      document_chunk_id: DOCUMENT_CHUNK_ID,
      citation: `[doc:${DOCUMENT_ID}#v1:chunk:${DOCUMENT_CHUNK_ID}]`,
    });
    expect(output.results[0]?.snippet).toContain('<external_content source="document"');
    expect(evalRun.answer).toContain('security signoff');
    expect(evalRun.answer).toContain(`[doc:${DOCUMENT_ID}#v1:chunk:${DOCUMENT_CHUNK_ID}]`);
  });

  it('answers meeting recap questions with transcript chunk evidence', async () => {
    const evalRun = await runToolEval(
      db,
      OWNER,
      'search_timeline',
      {
        query: 'What did the Acme renewal meeting decide about migration approval?',
        source: 'meeting',
      },
      [meetingHit(0.98)],
    );

    expect(evalRun.trace).toHaveLength(1);
    expect(evalRun.trace[0]?.tool).toBe('search_timeline');
    expect(evalRun.trace[0]?.input).toEqual(
      expect.objectContaining({
        source: 'meeting',
      }),
    );
    expect(evalRun.answer).toContain('Sam owns migration date approval before July 6.');
    expect(evalRun.answer).toContain(`[event:${MEETING_EVENT_ID}]`);
    const output = evalRun.output as { results: { snippet: string }[] };
    expect(output.results[0]?.snippet).toContain('Maya: Acme renewal action');
    expect(output.results[0]?.snippet).not.toContain('fallback summary');
  });

  it('surfaces accepted task and calendar state through durable workspace tools', async () => {
    // Product behavior: once a human accepts an agent suggestion, chat should
    // see canonical task/calendar rows rather than only approval metadata.
    const taskEval = await runToolEval(db, OWNER, 'list_tasks', {}, []);
    const calendarEval = await runToolEval(
      db,
      OWNER,
      'list_calendar_events',
      {
        from: '2026-06-04T00:00:00.000Z',
        to: '2026-06-05T00:00:00.000Z',
      },
      [],
    );

    expect(taskEval.output).toMatchObject({
      tasks: [expect.objectContaining({ name: 'Send Acme pricing proposal' })],
    });
    expect(calendarEval.output).toMatchObject({
      events: [expect.objectContaining({ id: CALENDAR_ID, title: 'Acme renewal review' })],
    });
  });

  it('lists active team members with ids for assignment references', async () => {
    // Product behavior: agents should not have to guess user UUIDs when a
    // teammate asks to assign work by a person's name.
    const evalRun = await runToolEval(db, OWNER, 'list_team_members', {}, []);

    expect(evalRun.output).toEqual({
      count: 2,
      members: [
        {
          user_id: OWNER,
          role: 'owner',
          name: 'Eval Owner',
          email: 'eval-owner@example.com',
        },
        {
          user_id: MEMBER,
          role: 'member',
          name: 'Eval Member',
          email: 'eval-member@example.com',
        },
      ],
    });
  });

  it('queues contact memory as identity facet approvals rather than mutating directly', async () => {
    // Product behavior: emails and phone numbers extracted from chat are
    // proposed as person identity memory, keeping contact details reviewable.
    const scope = withTeam(db as never, TEAM_A, OWNER);
    const tools = buildAgentTools(scope);
    const exec = tools.suggest_object_memory?.execute as (
      raw: unknown,
      opts: unknown,
    ) => Promise<unknown>;

    const output = await exec(
      {
        title: 'Remember Ada contact details',
        reason: 'Ada shared durable contact details in chat.',
        confidence: 'high',
        items: [
          {
            kind: 'add_identity_facet',
            entityId: PERSON_ID,
            facetKind: 'email',
            value: 'Ada@Example.com',
            normalizedValue: 'ada@example.com',
          },
          {
            kind: 'add_identity_facet',
            entityId: PERSON_ID,
            facetKind: 'phone',
            value: '+1 213 373 4253',
            normalizedValue: '+12133734253',
          },
        ],
      },
      {},
    );

    expect(output).toMatchObject({ ok: true });
    await expect(scope.objects.listIdentityFacets(PERSON_ID)).resolves.toEqual([]);
    const pendingSuggestions = await scope.suggestions.listPendingSuggestions();
    expect(pendingSuggestions).toHaveLength(1);
    expect(pendingSuggestions[0]?.source).toBe('chat');
    const suggestionItems = pendingSuggestions[0]?.items ?? [];
    const emailItem = suggestionItems.find(
      (item) => item.targetKind === 'identity_facet' && item.proposedPayload.kind === 'email',
    );
    const phoneItem = suggestionItems.find(
      (item) => item.targetKind === 'identity_facet' && item.proposedPayload.kind === 'phone',
    );
    expect(emailItem?.proposedPayload).toMatchObject({
      entityId: PERSON_ID,
      kind: 'email',
      normalizedValue: 'ada@example.com',
    });
    expect(phoneItem?.proposedPayload).toMatchObject({
      entityId: PERSON_ID,
      kind: 'phone',
      normalizedValue: '+12133734253',
    });
  });

  it('queues and accepts object relationship memory using object names as references', async () => {
    // Product behavior: relationship proposals may come from natural language
    // with object names but no UUIDs. Acceptance should resolve only clear
    // active objects, preserving review while avoiding ID-only model traps.
    const scope = withTeam(db as never, TEAM_A, OWNER);
    const tools = buildAgentTools(scope);
    const exec = tools.suggest_object_memory?.execute as (
      raw: unknown,
      opts: unknown,
    ) => Promise<unknown>;

    const output = await exec(
      {
        title: 'Remember Ada and Acme are related',
        reason: 'The conversation explicitly linked Ada with Acme.',
        confidence: 'high',
        items: [
          {
            kind: 'add_relationship',
            fromName: 'Ada Lovelace',
            toName: 'Acme',
            relationshipKind: 'related',
          },
        ],
      },
      {},
    );

    expect(output).toMatchObject({ ok: true });
    const pendingSuggestions = await scope.suggestions.listPendingSuggestions();
    const relationshipItem = pendingSuggestions
      .flatMap((suggestion) => suggestion.items)
      .find((item) => item.targetKind === 'object_relationship');
    expect(relationshipItem?.proposedPayload).toMatchObject({
      fromName: 'Ada Lovelace',
      toName: 'Acme',
      kind: 'related',
    });

    await expect(scope.suggestions.acceptSuggestionItem(relationshipItem?.id ?? '')).resolves.toBe(
      true,
    );
    const acme = await scope.objects.getObject(OBJECT_ID);
    expect(acme?.relationships).toEqual([
      expect.objectContaining({
        kind: 'related',
        otherId: PERSON_ID,
        otherName: 'Ada Lovelace',
      }),
    ]);
  });

  it('queues and accepts board item responsibility using teammate names as references', async () => {
    // Product behavior: board suggestions can assign responsibility from a
    // natural-language teammate mention without requiring the model to invent
    // or already know a user UUID.
    const scope = withTeam(db as never, TEAM_A, OWNER);
    const board = await scope.boards.createBoard({
      name: 'Acme launch board',
      templateKind: 'task_board',
      lanes: [{ name: 'Todo', kind: 'active' }],
    });
    const boardItem = await scope.boards.addBoardItem(board.id, {
      entityId: TASK_ID,
      laneId: board.lanes[0]?.id ?? null,
      actor: { kind: 'user', userId: OWNER },
    });

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Assign Acme proposal',
      dedupeKey: 'eval-board-item-responsible-name',
      items: [
        {
          operation: 'update',
          targetKind: 'board_item_update',
          targetId: boardItem.id,
          title: 'Assign Send Acme pricing proposal',
          dedupeKey: 'eval-board-item-responsible-name:item',
          proposedPayload: {
            boardItemId: boardItem.id,
            field: 'responsibleUserId',
            newValue: null,
            responsibleName: 'Eval Member',
          },
        },
      ],
    });

    const suggestionItem = bundle.items[0];
    expect(suggestionItem?.proposedPayload).toMatchObject({
      responsibleName: 'Eval Member',
      newValue: MEMBER,
    });

    await expect(scope.suggestions.acceptSuggestionItem(suggestionItem?.id ?? '')).resolves.toBe(
      true,
    );
    const updated = await scope.boards.getBoard(board.id, { itemLimit: 'all' });
    expect(updated?.items.find((item) => item.id === boardItem.id)?.responsibleUserId).toBe(MEMBER);
  });

  it('does not leak owner-private evidence to a member', async () => {
    // Product behavior: private capture is useful to its owner but must not
    // become retrievable evidence for teammates through chat.
    const evalRun = await runToolEval(db, MEMBER, 'search_timeline', { query: 'Acme private' }, [
      hit(PRIVATE_EVENT, 0.95, { visibility: 'private' }),
      hit(TEAM_EVENT, 0.8),
    ]);

    expect(evalRun.answer).not.toContain(PRIVATE_EVENT);
    expect(evalRun.answer).not.toContain('compensation');
    expect(evalRun.answer).toContain(TEAM_EVENT);
  });

  it('allows specific-user evidence only for the included teammate', async () => {
    // Product behavior: specific-user visibility should behave like an
    // allow-list even when vector search returns the same candidate hit.
    const hits = [
      hit(SPECIFIC_EVENT, 0.95, {
        visibility: 'specific_users',
        visibility_user_ids: [MEMBER],
      }),
    ];

    const ownerEval = await runToolEval(
      db,
      OWNER,
      'search_timeline',
      { query: 'Acme escalation' },
      hits,
    );
    const memberEval = await runToolEval(
      db,
      MEMBER,
      'search_timeline',
      { query: 'Acme escalation' },
      hits,
    );

    expect(ownerEval.answer).toBe("I couldn't verify that from the accessible timeline.");
    expect(memberEval.answer).toContain(SPECIFIC_EVENT);
    expect(memberEval.answer).toContain('Member-only Acme escalation');
  });

  it('drops cross-team similarly named evidence before answer synthesis', async () => {
    // Product behavior: an Acme result from another team must not become a
    // plausible-looking citation merely because names and vectors match.
    const evalRun = await runToolEval(db, OWNER, 'search_timeline', { query: 'Acme secret' }, [
      hit(OTHER_TEAM_EVENT, 0.99, { team_id: TEAM_B }),
    ]);

    expect(evalRun.answer).toBe("I couldn't verify that from the accessible timeline.");
    expect(evalRun.answer).not.toContain('Other-team Acme secret');
  });

  it('keeps tool failures honest instead of inventing a cited answer', async () => {
    // Product behavior: degraded retrieval should produce a bounded failure,
    // giving the model a safe path to say it could not verify the answer.
    const scope = withTeam(db as never, TEAM_A, OWNER, {
      embed: () => Promise.reject(new Error('embedding service down')),
    });
    const tools = buildAgentTools(scope);
    const exec = tools.search_timeline?.execute as (
      raw: unknown,
      opts: unknown,
    ) => Promise<unknown>;
    const output = await exec({ query: 'Acme proposal' }, {});

    const answer =
      'error' in (output as Record<string, unknown>)
        ? "I couldn't verify that because timeline search failed."
        : answerFromToolResult('search_timeline', output);
    expect(output).toEqual({ error: 'tool_failed' });
    expect(answer).toContain("couldn't verify");
    expect(answer).not.toContain('[event:');
  });
});
