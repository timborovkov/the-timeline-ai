import { PGlite } from '@electric-sql/pglite';
import { mcpOutboundKeys } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { handleMcpRequest } from '#src/mcp-server/handler.js';
import { hashKey } from '#src/mcp-server/keys.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TOKEN = 'tla_test_outbound_mcp_key_for_handler_tests';

interface ToolDescriptor {
  name: string;
  inputSchema: {
    properties?: {
      source?: {
        enum?: string[];
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

  await db.insert(mcpOutboundKeys).values({
    teamId: TEAM_ID,
    createdByUserId: USER_ID,
    name: 'E2E handler key',
    keyHash: hashKey(TOKEN),
    keyPrefix: TOKEN.slice(0, 12),
    scopes: ['read'],
  });
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

  it('resolves a valid bearer and lists tools with calendar and Slack event sources', async () => {
    const response = await handleMcpRequest(
      { db: db as never, bearer: TOKEN },
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    );

    const tools = toolsListResult(response).tools;
    const listEvents = tools.find((tool) => tool.name === 'timeline.list_events');
    expect(listEvents).toBeDefined();
    expect(listEvents?.inputSchema.properties?.source?.enum).toEqual(
      expect.arrayContaining(['calendar', 'slack']),
    );
  });

  it('pushes calendar and Slack source filters into list_events', async () => {
    await pg.exec(`
      INSERT INTO raw_events (team_id, source, content_text, occurred_at, source_metadata)
      VALUES
        ('${TEAM_ID}', 'web', 'web note', '2026-05-01T10:00:00Z', '{}'),
        ('${TEAM_ID}', 'calendar', 'calendar note', '2026-05-02T10:00:00Z', '{}'),
        ('${TEAM_ID}', 'slack', 'slack note', '2026-05-03T10:00:00Z', '{}');
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
