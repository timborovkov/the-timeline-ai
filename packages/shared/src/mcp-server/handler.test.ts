import { PGlite } from '@electric-sql/pglite';
import { agentSuggestions, mcpOutboundKeys, rawEvents } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAgentTools } from '#src/agent/tools.js';
import { handleMcpRequest } from '#src/mcp-server/handler.js';
import { hashKey } from '#src/mcp-server/keys.js';
import { TASK_CATEGORIES } from '#src/task-categories/types.js';
import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TOKEN = 'tla_test_outbound_mcp_key_for_handler_tests';
const AGENT_TOKEN = 'tla_test_agent_enabled_key_for_handler_tests';
const WORKFLOW_EVENT_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const WORKFLOW_EVENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const WORKFLOW_PRIVATE_EVENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const PR_EVENT_A = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const PR_EVENT_B = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const PR_PRIVATE_EVENT = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';

interface ToolDescriptor {
  name: string;
  inputSchema: {
    properties?: {
      source?: {
        enum?: string[];
      };
      category?: {
        enum?: string[];
        oneOf?: {
          enum?: string[];
          items?: { enum?: string[] };
        }[];
      };
    };
  };
}

interface ToolsListResult {
  tools: ToolDescriptor[];
}

function toolsListResult(response: Awaited<ReturnType<typeof handleMcpRequest>>): ToolsListResult {
  if (!response || !('result' in response) || typeof response.result !== 'object') {
    throw new Error('expected tools/list result');
  }
  return response.result as ToolsListResult;
}

async function seed(pg: PGlite, db: ReturnType<typeof drizzle>): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'mcp-team', 'MCP Team');
    INSERT INTO users (id, email)
    VALUES ('${USER_ID}', 'mcp-owner@example.com');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);

  await db.insert(mcpOutboundKeys).values([
    {
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      name: 'E2E handler key',
      keyHash: hashKey(TOKEN),
      keyPrefix: TOKEN.slice(0, 12),
      scopes: ['read'],
    },
    {
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      name: 'Agent-enabled handler key',
      keyHash: hashKey(AGENT_TOKEN),
      keyPrefix: AGENT_TOKEN.slice(0, 12),
      scopes: ['read', 'agent:ask'],
    },
  ]);
}

async function callTool(
  db: ReturnType<typeof drizzle>,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await handleMcpRequest(
    { db: db as never, bearer: TOKEN },
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    },
  );
  if (!response || !('result' in response)) return response;
  const content = response.result as { content: { text: string }[] };
  return JSON.parse(content.content[0]?.text ?? '{}');
}

describe('handleMcpRequest', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await seed(pg, db);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('allows initialize without bearer auth', async () => {
    const response = await handleMcpRequest(
      { db: db as never, bearer: null },
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
    );

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'the-timeline' },
      },
    });
  });

  it('does not expose tombstoned integration history through the outbound MCP resource tool', async () => {
    await db.insert(rawEvents).values([
      {
        id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
        teamId: TEAM_ID,
        source: 'integration',
        contentText: 'Visible Monday update',
        occurredAt: new Date('2026-06-20T10:00:00Z'),
        sourceMetadata: {
          provider: 'monday',
          integration_id: 'integration-1',
          external_object_id: 'item-1',
          event_type: 'update.created',
        },
      },
      {
        id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
        teamId: TEAM_ID,
        source: 'integration',
        contentText: 'Tombstoned Monday update',
        occurredAt: new Date('2026-06-20T10:01:00Z'),
        sourceMetadata: {
          provider: 'monday',
          integration_id: 'integration-1',
          external_object_id: 'item-1',
          event_type: 'update.created',
          deleted: true,
        },
      },
    ]);

    const result = await callTool(db, 'timeline.get_integration_resource', {
      provider: 'monday',
      externalObjectId: 'item-1',
    });

    expect(result).toMatchObject({
      found: true,
      history: [
        expect.objectContaining({
          event_id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain('dddddddd-dddd-4ddd-8ddd-ddddddddddd2');
  });

  it('rejects missing and invalid bearers for authenticated methods', async () => {
    await expect(
      handleMcpRequest(
        { db: db as never, bearer: null },
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      ),
    ).resolves.toMatchObject({ error: { message: 'Unauthorized: missing bearer token' } });

    await expect(
      handleMcpRequest(
        { db: db as never, bearer: 'tla_bad' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ),
    ).resolves.toMatchObject({
      error: { message: 'Unauthorized: invalid or revoked bearer token' },
    });
  });

  it('resolves a valid bearer and lists tools with current event sources', async () => {
    const response = await handleMcpRequest(
      { db: db as never, bearer: TOKEN },
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    );

    const tools = toolsListResult(response).tools;
    expect(tools.find((tool) => tool.name === 'timeline.ask_agent')).toBeUndefined();
    const listEvents = tools.find((tool) => tool.name === 'timeline.list_events');
    expect(listEvents).toBeDefined();
    expect(listEvents?.inputSchema.properties?.source?.enum).toEqual(
      expect.arrayContaining(['calendar', 'slack', 'ingest_webhook']),
    );
    const categories = [...TASK_CATEGORIES];
    const searchObjects = tools.find((tool) => tool.name === 'timeline.search_objects');
    const searchCategorySchemas = searchObjects?.inputSchema.properties?.category?.oneOf ?? [];
    expect(searchCategorySchemas[0]?.enum).toEqual(categories);
    expect(searchCategorySchemas[1]?.items?.enum).toEqual(categories);
    for (const toolName of ['timeline.list_objects', 'timeline.list_tasks']) {
      const tool = tools.find((candidate) => candidate.name === toolName);
      expect(tool?.inputSchema.properties?.category?.enum).toEqual(categories);
    }
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'timeline.retrieve_workspace_context',
        'timeline.search_moments',
        'timeline.list_moments',
        'timeline.get_moment',
        'timeline.get_object',
        'timeline.search_objects',
        'timeline.list_objects',
        'timeline.list_tasks',
        'timeline.search_boards',
        'timeline.search_documents_structured',
        'timeline.get_document',
        'timeline.get_document_chunk',
        'timeline.list_recent_document_changes',
        'timeline.list_calendar_events',
        'timeline.get_calendar_event',
        'timeline.resolve_time_context',
        'timeline.list_integrations',
        'timeline.search_integration_events',
        'timeline.get_integration_resource',
      ]),
    );
  });

  it('filters ask_agent from read-only keys and independently rejects direct calls', async () => {
    const response = await handleMcpRequest(
      { db: db as never, bearer: TOKEN },
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'timeline.ask_agent', arguments: { question: 'What changed?' } },
      },
    );

    expect(response).toMatchObject({
      result: {
        isError: true,
        content: [{ text: JSON.stringify({ ok: false, error: 'forbidden' }) }],
      },
    });
  });

  it('runs ask_agent as the proposal-only team actor and returns structured references', async () => {
    const proposalId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const eventId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const askAgent = vi.fn(
      (
        _input: Record<string, unknown>,
        deps: { onTurnObservability?: (value: unknown) => void },
      ) => {
        deps.onTurnObservability?.({
          toolObservations: [],
          selection: null,
          totalResultCount: 0,
          topArtifactRefs: [],
          proposalIds: [proposalId],
          warningCodes: [],
        });
        return Promise.resolve({
          ok: true as const,
          answer: `Launch is ready [ev:${eventId}].`,
          truncated: false,
          profile: 'mcp_agent' as const,
        });
      },
    );
    const checkRateLimit = vi.fn().mockResolvedValue({ ok: true, remaining: 9, retryAfterMs: 0 });

    const response = await handleMcpRequest(
      { db: db as never, bearer: AGENT_TOKEN, agentDelegationDepth: 1 },
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'timeline.ask_agent', arguments: { question: '  What changed?  ' } },
      },
      { askAgent: askAgent as never, checkRateLimit: checkRateLimit as never },
    );

    if (!response || !('result' in response)) throw new Error('expected tool result');
    const result = response.result as {
      content: { text: string }[];
      isError: boolean;
    };
    expect(result).toMatchObject({ isError: false });
    const text = result.content[0]?.text;
    expect(JSON.parse(text ?? '{}')).toEqual({
      ok: true,
      answer: `Launch is ready [ev:${eventId}].`,
      citations: [{ kind: 'timeline_event', id: eventId }],
      proposal_ids: [proposalId],
      truncated: false,
    });
    const [askInput, askDeps] = askAgent.mock.calls[0] as unknown as [
      Record<string, unknown> & {
        proposalOrigin: Record<string, unknown>;
      },
      { abortSignal: AbortSignal; includeMcpTools: boolean },
    ];
    expect(askInput).toMatchObject({
      teamId: TEAM_ID,
      userId: '00000000-0000-0000-0000-000000000000',
      deliverySurface: 'mcp',
      trustedTeamActor: true,
      toolMode: 'proposal_only',
      question: 'What changed?',
    });
    expect(askInput.proposalOrigin).toMatchObject({
      surface: 'mcp',
      actorKind: 'team_agent',
    });
    expect(typeof askInput.proposalOrigin.mcpOutboundKeyId).toBe('string');
    expect(askDeps.includeMcpTools).toBe(true);
    expect(askDeps.abortSignal).toBeInstanceOf(AbortSignal);
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ capacity: 10, refillPerSec: 10 / 60 }),
    );
  });

  it('persists synthetic-agent proposals as team-visible approval work', async () => {
    const scope = withTeam(db as never, TEAM_ID, '00000000-0000-0000-0000-000000000000', {
      skipMembershipCheck: true,
    });
    const tools = buildAgentTools(scope, {
      toolMode: 'proposal_only',
      proposalOrigin: {
        surface: 'mcp',
        actorKind: 'team_agent',
        mcpOutboundKeyId: '99999999-9999-4999-8999-999999999999',
      },
    });
    const suggestTask = tools.suggest_task?.execute as (
      input: unknown,
      options: unknown,
    ) => Promise<unknown>;

    const suggestionResult = (await suggestTask({ title: 'Send the launch note' }, {})) as {
      id: string;
      ok: boolean;
    };
    expect(suggestionResult.ok).toBe(true);
    expect(typeof suggestionResult.id).toBe('string');

    const rows = await db.select().from(agentSuggestions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      visibility: 'team',
      visibilityOwnerUserId: null,
    });
    expect(rows[0]?.metadata).toMatchObject({
      origin_surface: 'mcp',
      origin_actor_kind: 'team_agent',
      mcp_outbound_key_id: '99999999-9999-4999-8999-999999999999',
    });
  });

  it('advertises ask_agent only to agent-enabled keys', async () => {
    const response = await handleMcpRequest(
      { db: db as never, bearer: AGENT_TOKEN },
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    );

    const askTool = toolsListResult(response).tools.find(
      (tool) => tool.name === 'timeline.ask_agent',
    );
    expect(askTool?.inputSchema.properties).toHaveProperty('question');
  });

  it('returns stable delegation, throttling, availability, and validation failures', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'tools/call',
      params: { name: 'timeline.ask_agent', arguments: { question: 'What changed?' } },
    };
    const output = async (
      context: Parameters<typeof handleMcpRequest>[0],
      deps: Parameters<typeof handleMcpRequest>[2],
      raw: unknown = request,
    ) => {
      const response = await handleMcpRequest(context, raw, deps);
      if (!response || !('result' in response)) throw new Error('expected tool result');
      const result = response.result as { content: { text: string }[]; isError: boolean };
      const parsed = JSON.parse(result.content[0]?.text ?? '{}') as unknown;
      if (!parsed || typeof parsed !== 'object') throw new Error('expected object tool output');
      return { ...parsed, isError: result.isError };
    };

    await expect(
      output({ db: db as never, bearer: AGENT_TOKEN, agentDelegationDepth: 2 }, {}),
    ).resolves.toMatchObject({ error: 'delegation_limit', isError: true });
    await expect(
      output(
        { db: db as never, bearer: AGENT_TOKEN },
        {
          checkRateLimit: vi.fn().mockResolvedValue({ ok: false, retryAfterMs: 2_000 }) as never,
        },
      ),
    ).resolves.toMatchObject({
      error: 'rate_limited',
      retry_after_seconds: 2,
      isError: true,
    });
    await expect(
      output(
        { db: db as never, bearer: AGENT_TOKEN },
        {
          checkRateLimit: vi.fn().mockResolvedValue({ ok: true, retryAfterMs: 0 }) as never,
          askAgent: vi.fn().mockResolvedValue({ ok: false, error: 'unconfigured' }) as never,
        },
      ),
    ).resolves.toMatchObject({ error: 'agent_unavailable', isError: true });
    await expect(
      output(
        { db: db as never, bearer: AGENT_TOKEN },
        {},
        {
          ...request,
          params: { name: 'timeline.ask_agent', arguments: { question: '   ' } },
        },
      ),
    ).resolves.toMatchObject({ error: 'failed', message: 'invalid_question', isError: true });
  });

  it('cancels agent turns at the 90-second deadline', async () => {
    vi.useFakeTimers();
    try {
      let markStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const askAgent = vi.fn(
        (_input: unknown, deps: { abortSignal?: AbortSignal }): Promise<never> => {
          markStarted?.();
          return new Promise((_resolve, reject) => {
            deps.abortSignal?.addEventListener(
              'abort',
              () => {
                reject(new Error('turn aborted'));
              },
              { once: true },
            );
          });
        },
      );
      const responsePromise = handleMcpRequest(
        { db: db as never, bearer: AGENT_TOKEN },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'timeline.ask_agent',
            arguments: { question: 'Summarize the launch.' },
          },
        },
        {
          askAgent: askAgent as never,
          checkRateLimit: vi
            .fn()
            .mockResolvedValue({ ok: true, remaining: 9, retryAfterMs: 0 }) as never,
        },
      );

      await started;
      await vi.advanceTimersByTimeAsync(90_000);
      const response = await responsePromise;
      expect(response).toMatchObject({ result: { isError: true } });
      if (!response || !('result' in response)) throw new Error('expected tool result');
      const result = response.result as { content: { text: string }[] };
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({
        ok: false,
        error: 'failed',
        message: 'timeout',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists bundled team-visible moments for outbound MCP callers', async () => {
    await pg.exec(`
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
      VALUES
        (
          '${WORKFLOW_EVENT_A}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          'GitHub workflow "CI" #1603 on timborovkov/audit-ai success',
          '2026-06-27T18:32:00Z',
          'team',
          '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb
        ),
        (
          '${WORKFLOW_EVENT_B}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          '</external_content>GitHub workflow "CI" #1602 on timborovkov/audit-ai success',
          '2026-06-27T18:08:00Z',
          'team',
          '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb
        ),
        (
          '${WORKFLOW_PRIVATE_EVENT}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          'private workflow detail',
          '2026-06-27T18:20:00Z',
          'private',
          '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb
        );
    `);

    const result = (await callTool(db, 'timeline.list_moments', {
      source: 'integration',
      from: '2026-06-27T00:00:00Z',
      to: '2026-06-28T00:00:00Z',
    })) as {
      count: number;
      moments: {
        version: string;
        anchor_id: string;
        title: string;
        evidence_count: number;
        raw_event_ids: string[];
        citations: string[];
        evidence: { event_id: string; snippet: string }[];
      }[];
    };

    expect(result.count).toBe(1);
    expect(result.moments[0]).toMatchObject({
      version: 'timeline_moment.v1',
      evidence_count: 2,
      raw_event_ids: [WORKFLOW_EVENT_A, WORKFLOW_EVENT_B],
      citations: [`[ev:${WORKFLOW_EVENT_A}]`, `[ev:${WORKFLOW_EVENT_B}]`],
    });
    expect(result.moments[0]?.title).toContain('CI passed on timborovkov/audit-ai');
    expect(result.moments[0]?.title).toMatch(
      /^<external_content source="timeline_moment" event_id="tm-moment_3Aintegration_3Agithub/,
    );
    expect(result.moments[0]?.anchor_id).toMatch(/^tm-moment_3Aintegration_3Agithub/);
    expect(result.moments[0]?.raw_event_ids).not.toContain(WORKFLOW_PRIVATE_EVENT);
    const snippets = result.moments[0]?.evidence.map((entry) => entry.snippet) ?? [];
    expect(snippets[0]).toMatch(/^<external_content source="integration"/);
    expect(snippets.join('\n')).toContain('[fence-removed]');
    expect(snippets.join('\n')).not.toContain('</external_content>GitHub');
  });

  it('scans past large raw-event groups when listing outbound MCP moments', async () => {
    const workflowRows = Array.from({ length: 50 }, (_, index) => {
      const id = `dddddddd-dddd-4ddd-8ddd-${String(index + 1).padStart(12, '0')}`;
      const occurredAt = new Date(Date.UTC(2026, 5, 27, 18, 59 - index, 0)).toISOString();
      return `(
        '${id}',
        '${TEAM_ID}',
        '${USER_ID}',
        'integration',
        'GitHub workflow "CI" #${1700 - index} on timborovkov/audit-ai success',
        '${occurredAt}',
        'team',
        '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb
      )`;
    });
    await pg.exec(`
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
      VALUES
        ${workflowRows.join(',')},
        (
          '${PR_EVENT_A}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          'GitHub PR timborovkov/audit-ai#292 — Fix scoping tie-out extraction and timeline grouping',
          '2026-06-26T18:00:00Z',
          'team',
          '{"provider":"github","event_type":"pr.updated","github":{"type":"pull_request","repo":"timborovkov/audit-ai","number":292}}'::jsonb
        );
    `);

    const result = (await callTool(db, 'timeline.list_moments', {
      source: 'integration',
      limit: 2,
    })) as {
      count: number;
      moments: { title: string; evidence_count: number; raw_event_ids: string[] }[];
    };

    expect(result.count).toBe(2);
    expect(result.moments[0]?.evidence_count).toBe(50);
    expect(result.moments[1]?.raw_event_ids).toEqual([PR_EVENT_A]);
  });

  it('expands only visible raw evidence for outbound MCP moments', async () => {
    await pg.exec(`
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
      VALUES
        (
          '${WORKFLOW_EVENT_A}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          'GitHub workflow "CI" #1603 on timborovkov/audit-ai success',
          '2026-06-27T18:32:00Z',
          'team',
          '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb
        ),
        (
          '${WORKFLOW_EVENT_B}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          'GitHub workflow "CI" #1602 on timborovkov/audit-ai success',
          '2026-06-27T18:08:00Z',
          'team',
          '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb
        ),
        (
          '${WORKFLOW_PRIVATE_EVENT}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          'private workflow detail',
          '2026-06-27T18:20:00Z',
          'private',
          '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb
        );
    `);

    const result = (await callTool(db, 'timeline.get_moment', {
      rawEventIds: [WORKFLOW_EVENT_A, WORKFLOW_PRIVATE_EVENT, WORKFLOW_EVENT_B],
    })) as {
      found: boolean;
      moment: {
        version: string;
        anchor_id: string;
        evidence_count: number;
        raw_event_ids: string[];
        evidence: { event_id: string; snippet: string }[];
      };
    };

    expect(result).toMatchObject({
      found: true,
      moment: {
        version: 'timeline_moment.v1',
        evidence_count: 2,
        raw_event_ids: [WORKFLOW_EVENT_A, WORKFLOW_EVENT_B],
      },
    });
    expect(result.moment.anchor_id).toMatch(/^tm-moment_3Aintegration_3Agithub/);
    expect(result.moment.raw_event_ids).not.toContain(WORKFLOW_PRIVATE_EVENT);
    expect(
      result.moment.evidence.every((entry) => entry.snippet.startsWith('<external_content')),
    ).toBe(true);
  });

  it('expands partial raw-event ids into the complete visible outbound MCP moment', async () => {
    await pg.exec(`
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
      VALUES
        (
          '${WORKFLOW_EVENT_A}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          'GitHub workflow "CI" #1603 on timborovkov/audit-ai success',
          '2026-06-27T18:32:00Z',
          'team',
          '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb
        ),
        (
          '${WORKFLOW_EVENT_B}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          'GitHub workflow "CI" #1602 on timborovkov/audit-ai success',
          '2026-06-27T18:08:00Z',
          'team',
          '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb
        );
    `);

    const result = (await callTool(db, 'timeline.get_moment', {
      rawEventIds: [WORKFLOW_EVENT_A],
    })) as {
      found: boolean;
      moment: { evidence_count: number; raw_event_ids: string[] };
    };

    expect(result).toMatchObject({
      found: true,
      moment: {
        evidence_count: 2,
        raw_event_ids: [WORKFLOW_EVENT_A, WORKFLOW_EVENT_B],
      },
    });
  });

  it('expands supported moment ids through bounded team-visible lookup for outbound MCP callers', async () => {
    await pg.exec(`
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
      VALUES
        (
          '${WORKFLOW_EVENT_A}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          'GitHub workflow "CI" #1603 on timborovkov/audit-ai success',
          '2026-06-27T18:32:00Z',
          'team',
          '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb
        ),
        (
          '${WORKFLOW_EVENT_B}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          'GitHub workflow "CI" #1602 on timborovkov/audit-ai success',
          '2026-06-27T18:08:00Z',
          'team',
          '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb
        ),
        (
          '${WORKFLOW_PRIVATE_EVENT}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          'private workflow detail',
          '2026-06-27T18:20:00Z',
          'private',
          '{"provider":"github","event_type":"workflow_run.success","github":{"type":"workflow_run","repo":"timborovkov/audit-ai","head_branch":"main"}}'::jsonb
        );
    `);

    const result = (await callTool(db, 'timeline.get_moment', {
      momentId: 'moment:integration:github:workflow_run:timborovkov/audit-ai:CI:main:2026-06-27',
    })) as {
      found: boolean;
      moment: {
        title: string;
        raw_event_ids: string[];
      };
    };

    expect(result).toMatchObject({
      found: true,
      moment: {
        raw_event_ids: [WORKFLOW_EVENT_A, WORKFLOW_EVENT_B],
      },
    });
    expect(result.moment.title).toContain('CI passed on timborovkov/audit-ai');
    expect(result.moment.title).toMatch(/^<external_content source="timeline_moment"/);
    expect(result.moment.raw_event_ids).not.toContain(WORKFLOW_PRIVATE_EVENT);
  });

  it('expands exact GitHub PR moment ids through team-visible metadata lookup', async () => {
    await pg.exec(`
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
      VALUES
        (
          '${PR_EVENT_A}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          'GitHub PR timborovkov/audit-ai#292 — Fix scoping tie-out extraction and timeline grouping',
          '2026-06-27T18:26:00Z',
          'team',
          '{"provider":"github","event_type":"pr.updated","github":{"type":"pull_request","repo":"timborovkov/audit-ai","number":292}}'::jsonb
        ),
        (
          '${PR_EVENT_B}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          'GitHub PR timborovkov/audit-ai#292 review (COMMENTED)',
          '2026-06-27T18:25:00Z',
          'team',
          '{"provider":"github","event_type":"pr.review.commented","github":{"type":"review","repo":"timborovkov/audit-ai","pr_number":292,"state":"commented"}}'::jsonb
        ),
        (
          '${PR_PRIVATE_EVENT}',
          '${TEAM_ID}',
          '${USER_ID}',
          'integration',
          'private PR detail',
          '2026-06-27T18:24:00Z',
          'private',
          '{"provider":"github","event_type":"pr.review.commented","github":{"type":"review","repo":"timborovkov/audit-ai","pr_number":292,"state":"commented"}}'::jsonb
        );
    `);

    const result = (await callTool(db, 'timeline.get_moment', {
      momentId: 'moment:integration:github:pr:timborovkov/audit-ai:292',
    })) as {
      found: boolean;
      moment: {
        title: string;
        raw_event_ids: string[];
      };
    };

    expect(result).toMatchObject({
      found: true,
      moment: {
        raw_event_ids: [PR_EVENT_A, PR_EVENT_B],
      },
    });
    expect(result.moment.title).toContain(
      'PR #292 updated: Fix scoping tie-out extraction and timeline grouping',
    );
    expect(result.moment.title).toMatch(/^<external_content source="timeline_moment"/);
    expect(result.moment.raw_event_ids).not.toContain(PR_PRIVATE_EVENT);
  });

  it('exposes team-level object and task retrieval through bearer auth', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Faba redesign',
      actor: { kind: 'user', userId: USER_ID },
    });
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Ship expanded outbound MCP',
      status: 'doing',
      parentObjectId: project.id,
      actor: { kind: 'user', userId: USER_ID },
    });
    await scope.objects.setTaskCategory(task.id, 'engineering', {
      kind: 'user',
      userId: USER_ID,
    });
    await scope.objects.archiveObject(project.id, { kind: 'user', userId: USER_ID });
    await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Acme Corp',
      status: 'active',
      actor: { kind: 'user', userId: USER_ID },
    });

    await expect(callTool(db, 'timeline.list_tasks', {})).resolves.toMatchObject({
      count: 1,
      tasks: [
        expect.objectContaining({
          id: task.id,
          citation: `[task:${task.id}]`,
          name: 'Ship expanded outbound MCP',
          task_category: 'engineering',
          task_category_mode: 'manual',
          task_category_status: 'ready',
          archived: false,
          primary_project: {
            id: project.id,
            name: 'Faba redesign',
            archived: true,
          },
        }),
      ],
    });
    const objectResult = await callTool(db, 'timeline.get_object', { idOrName: 'Acme Corp' });
    expect(objectResult).toMatchObject({
      found: true,
      name: 'Acme Corp',
      type: 'company',
    });
    expect(objectResult).not.toHaveProperty('agent_suggested');
  });

  it('exposes team-level calendar retrieval through bearer auth', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const event = await scope.calendar.createCalendarEvent({
      title: 'Outbound MCP review',
      description: 'Review expanded retrieval tools',
      startAt: new Date('2026-06-22T10:00:00Z'),
      endAt: new Date('2026-06-22T10:30:00Z'),
      timezone: 'UTC',
      allDay: false,
      location: null,
      showAs: 'busy',
      rrule: null,
      visibility: 'team',
      visibilityUserIds: null,
      reminderMinutes: null,
    });

    await expect(
      callTool(db, 'timeline.list_calendar_events', {
        from: '2026-06-22T00:00:00Z',
        to: '2026-06-23T00:00:00Z',
      }),
    ).resolves.toMatchObject({
      count: 1,
      events: [expect.objectContaining({ id: event.id, title: 'Outbound MCP review' })],
    });
    await expect(
      callTool(db, 'timeline.get_calendar_event', { id: event.id }),
    ).resolves.toMatchObject({
      found: true,
      title: 'Outbound MCP review',
    });
  });

  it('pushes supported source filters into list_events', async () => {
    await pg.exec(`
      INSERT INTO raw_events (team_id, source, content_text, occurred_at, source_metadata)
      VALUES
        ('${TEAM_ID}', 'web', 'web note', '2026-05-01T10:00:00Z', '{}'),
        ('${TEAM_ID}', 'calendar', 'calendar note', '2026-05-02T10:00:00Z', '{}'),
        ('${TEAM_ID}', 'slack', 'slack note', '2026-05-03T10:00:00Z', '{}'),
        ('${TEAM_ID}', 'ingest_webhook', 'webhook note', '2026-05-04T10:00:00Z', '{}');
    `);

    await expect(
      callTool(db, 'timeline.list_events', { source: 'calendar' }),
    ).resolves.toMatchObject({
      count: 1,
      events: [expect.objectContaining({ source: 'calendar', content_text: 'calendar note' })],
    });
    await expect(callTool(db, 'timeline.list_events', { source: 'slack' })).resolves.toMatchObject({
      count: 1,
      events: [expect.objectContaining({ source: 'slack', content_text: 'slack note' })],
    });
    await expect(
      callTool(db, 'timeline.list_events', { source: 'ingest_webhook' }),
    ).resolves.toMatchObject({
      count: 1,
      events: [expect.objectContaining({ source: 'ingest_webhook', content_text: 'webhook note' })],
    });
  });

  it('excludes private and specific-user events for the zero-UUID MCP actor', async () => {
    await pg.exec(`
      INSERT INTO raw_events (
        team_id,
        author_user_id,
        source,
        content_text,
        occurred_at,
        visibility,
        visibility_user_ids,
        source_metadata
      )
      VALUES
        ('${TEAM_ID}', '${USER_ID}', 'web', 'team visible', '2026-05-01T10:00:00Z', 'team', NULL, '{}'),
        ('${TEAM_ID}', '${USER_ID}', 'web', 'private secret', '2026-05-02T10:00:00Z', 'private', NULL, '{}'),
        (
          '${TEAM_ID}',
          '${USER_ID}',
          'web',
          'specific secret',
          '2026-05-03T10:00:00Z',
          'specific_users',
          ARRAY['${USER_ID}']::uuid[],
          '{}'
        );
    `);

    await expect(callTool(db, 'timeline.list_events', {})).resolves.toMatchObject({
      count: 1,
      events: [expect.objectContaining({ content_text: 'team visible' })],
    });
  });
});
