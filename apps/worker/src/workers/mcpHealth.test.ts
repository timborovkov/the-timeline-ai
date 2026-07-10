import { PGlite } from '@electric-sql/pglite';
import { type Db, mcpServers } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyDbMigrations } from '#src/test/pglite.js';
import { pingMcpServer, processMcpHealthTick } from '#src/workers/mcpHealth.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_SERVER_ID = '33333333-3333-4333-8333-333333333333';
const PERSONAL_SERVER_ID = '44444444-4444-4444-8444-444444444444';
const DISABLED_SERVER_ID = '55555555-5555-4555-8555-555555555555';
const UNSAFE_SERVER_ID = '66666666-6666-4666-8666-666666666666';

type TestDb = ReturnType<typeof drizzle>;

function fakeManager() {
  return {
    discoverTools: vi.fn().mockResolvedValue([{ name: 'search_docs' }]),
    invalidate: vi.fn(),
  };
}

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'mcp-health-worker', 'MCP Health Worker');

    INSERT INTO users (id, email)
    VALUES ('${USER_ID}', 'mcp-health@example.com');

    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
}

async function insertServer(
  db: TestDb,
  input: {
    id: string;
    url?: string;
    enabled?: boolean;
    userId?: string | null;
    lastError?: string | null;
  },
) {
  await db.insert(mcpServers).values({
    id: input.id,
    teamId: TEAM_ID,
    userId: input.userId ?? null,
    addedByUserId: USER_ID,
    name: `Server ${input.id.slice(0, 4)}`,
    url: input.url ?? `https://mcp-${input.id.slice(0, 4)}.example.com/mcp`,
    authType: 'none',
    enabled: input.enabled ?? true,
    lastError: input.lastError ?? null,
  });
}

async function loadServer(db: TestDb, id: string) {
  const rows = await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`missing server ${id}`);
  return row;
}

describe('MCP health worker', () => {
  let pg: PGlite;
  let db: TestDb;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  }, 60_000);

  afterEach(async () => {
    await pg.close();
  });

  it('checks enabled servers, persists healthy state, and invalidates team and personal caches', async () => {
    await insertServer(db, { id: TEAM_SERVER_ID, lastError: 'stale error' });
    await insertServer(db, { id: PERSONAL_SERVER_ID, userId: USER_ID });
    await insertServer(db, { id: DISABLED_SERVER_ID, enabled: false });
    const manager = fakeManager();

    await expect(processMcpHealthTick({ db: db as never as Db, manager })).resolves.toMatchObject({
      checked: 2,
      healthy: 2,
      failed: 0,
    });

    expect(manager.discoverTools).toHaveBeenCalledTimes(2);
    expect(manager.invalidate).toHaveBeenCalledWith(TEAM_ID);
    expect(manager.invalidate).toHaveBeenCalledWith(`${TEAM_ID}:${USER_ID}`);
    const teamServer = await loadServer(db, TEAM_SERVER_ID);
    expect(teamServer.lastConnectedAt).toBeInstanceOf(Date);
    expect(teamServer.lastError).toBeNull();
    const disabledServer = await loadServer(db, DISABLED_SERVER_ID);
    expect(disabledServer.lastConnectedAt).toBeNull();
  });

  it('persists failed discovery errors without aborting the tick', async () => {
    await insertServer(db, { id: TEAM_SERVER_ID });
    await insertServer(db, { id: PERSONAL_SERVER_ID, userId: USER_ID });
    const manager = fakeManager();
    manager.discoverTools.mockRejectedValueOnce(new Error('tools/list exploded'));

    await expect(processMcpHealthTick({ db: db as never as Db, manager })).resolves.toMatchObject({
      checked: 2,
      healthy: 1,
      failed: 1,
    });

    const failed = await loadServer(db, TEAM_SERVER_ID);
    expect(failed.lastConnectedAt).toBeNull();
    expect(failed.lastError).toBe('tools/list exploded');
    const healthy = await loadServer(db, PERSONAL_SERVER_ID);
    expect(healthy.lastConnectedAt).toBeInstanceOf(Date);
    expect(healthy.lastError).toBeNull();
  });

  it('fails legacy unsafe URLs before discovery reaches the network', async () => {
    await insertServer(db, { id: UNSAFE_SERVER_ID, url: 'http://127.0.0.1:31337/mcp' });
    const manager = fakeManager();
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    let result: Awaited<ReturnType<typeof pingMcpServer>> | null = null;
    try {
      result = await pingMcpServer(db as never as Db, UNSAFE_SERVER_ID, manager);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }

    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/loopback|private|http/i);
    expect(manager.discoverTools).not.toHaveBeenCalled();
    const unsafe = await loadServer(db, UNSAFE_SERVER_ID);
    expect(unsafe.lastConnectedAt).toBeNull();
    expect(unsafe.lastError).toMatch(/loopback|private|http/i);
  });
});
