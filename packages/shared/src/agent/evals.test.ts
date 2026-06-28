import { PGlite } from '@electric-sql/pglite';
import { calendarEvents, entities } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import type { EmbedResult } from '#src/llm/embed.js';
import type { SearchHit } from '#src/qdrant/client.js';

import { buildAgentTools } from '#src/agent/tools.js';
import { withTeam } from '#src/team-scope.js';
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
const FACT_ID = '10000000-0000-0000-0000-000000000401';
const TASK_ID = '20000000-0000-0000-0000-000000000401';
const OBJECT_ID = '20000000-0000-0000-0000-000000000402';
const PERSON_ID = '20000000-0000-0000-0000-000000000403';
const CALENDAR_ID = '30000000-0000-0000-0000-000000000401';

type Db = ReturnType<typeof drizzle>;
type ToolName =
  | 'search_timeline'
  | 'search_timeline_moments'
  | 'list_tasks'
  | 'list_objects'
  | 'list_calendar_events'
  | 'list_team_members';

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
      ('${CI_EVENT_B}', '${TEAM_A}', '${OWNER}', '${OWNER}', 'integration', 'GitHub workflow "CI" #1602 on timborovkov/audit-ai success', '2026-06-27T18:08:00Z', 'team', NULL, '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb);

    INSERT INTO facts (id, team_id, raw_event_id, statement, confidence, model_version)
    VALUES ('${FACT_ID}', '${TEAM_A}', '${TEAM_EVENT}', 'Acme renewal needs pricing by Friday.', 0.96, 'eval-model');
  `);
}

function hit(
  eventId: string,
  score: number,
  overrides: Partial<SearchHit['payload']> = {},
): SearchHit {
  return {
    id: eventId,
    score,
    payload: {
      team_id: TEAM_A,
      source_kind: 'raw_event',
      event_id: eventId,
      fact_id: eventId === TEAM_EVENT ? FACT_ID : null,
      object_id: null,
      note_id: null,
      change_id: null,
      entity_id: null,
      entity_ids: [],
      source: eventId === SPECIFIC_EVENT ? 'slack' : 'web',
      occurred_at: '2026-06-01T09:00:00.000Z',
      author_user_id: OWNER,
      visibility: 'team',
      visibility_user_ids: null,
      visibility_owner_user_id: OWNER,
      embedding_model: 'eval-embedding-model',
      source_scope: 'event',
      source_id: eventId,
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

function answerFromTimeline(result: unknown): string {
  const rows = (result as { results?: { eventId: string; snippet: string }[] }).results ?? [];
  if (rows.length === 0) return "I couldn't verify that from the accessible timeline.";
  return rows.map((row) => `${row.snippet} [event:${row.eventId}]`).join('\n');
}

function answerFromMoments(result: unknown): string {
  const rows =
    (
      result as {
        moments?: { title: string; raw_event_ids: string[]; evidence_count: number }[];
      }
    ).moments ?? [];
  if (rows.length === 0) return "I couldn't verify that from accessible timeline moments.";
  return rows
    .map(
      (row) =>
        `${row.title} (${String(row.evidence_count)} events) ${row.raw_event_ids
          .map((id) => `[event:${id}]`)
          .join(' ')}`,
    )
    .join('\n');
}

async function runToolEval(
  db: Db,
  userId: string,
  name: ToolName,
  input: unknown,
  hits: SearchHit[],
) {
  const trace: { tool: ToolName; input: unknown; output: unknown }[] = [];
  const scope = withTeam(db as never, TEAM_A, userId, {
    embed: ({ text }): Promise<EmbedResult> =>
      Promise.resolve({
        vector: text.includes('Acme') ? [0.9, 0.1, 0.1] : [0.1, 0.1, 0.1],
        model: 'eval-embed',
      }),
    qdrantSearch: () => Promise.resolve(hits),
  });
  const tools = buildAgentTools(scope);
  const exec = tools[name]?.execute as (raw: unknown, opts: unknown) => Promise<unknown>;
  const output = await exec(input, {});
  trace.push({ tool: name, input, output });
  return {
    output,
    trace,
    answer:
      name === 'search_timeline'
        ? answerFromTimeline(output)
        : name === 'search_timeline_moments'
          ? answerFromMoments(output)
          : '',
  };
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
      sourceEventId: TEAM_EVENT,
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
  }, 60_000);

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
        : answerFromTimeline(output);
    expect(output).toEqual({ error: 'tool_failed' });
    expect(answer).toContain("couldn't verify");
    expect(answer).not.toContain('[event:');
  });
});
