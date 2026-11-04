import { type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import { resolveMcpBearer } from '#src/mcp-server/oauth.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RESOURCE = 'https://thetimeline.cc/api/mcp/server';

let testDb: ResettablePGliteTestDb;
let db: Db;

beforeAll(async () => {
  testDb = await createResettablePGliteTestDb(async (pg) => {
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${TEAM_ID}', 'outbound-team', 'Outbound Team');
      INSERT INTO users (id, email, name)
      VALUES ('${USER_ID}', 'owner@example.test', 'Owner');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
    `);
  });
  db = drizzle(testDb.pg) as unknown as Db;
});

beforeEach(async () => {
  await testDb.reset();
});

afterAll(async () => {
  await testDb.close();
});

describe('mcp outbound keys', () => {
  it('mints, lists, and revokes team keys through withTeam', async () => {
    const scope = withTeam(db, TEAM_ID, USER_ID).mcpOutbound;
    const created = await scope.createKey({ name: 'Cursor' });
    expect(created.plaintext.startsWith('tla_')).toBe(true);
    expect(created.scopes).toEqual(['read', 'capture']);
    expect(await scope.listKeys()).toEqual([
      expect.objectContaining({ id: created.id, name: 'Cursor', prefix: created.prefix }),
    ]);

    expect(await resolveMcpBearer(db, created.plaintext, RESOURCE)).toMatchObject({
      teamId: TEAM_ID,
      authType: 'api_key',
    });
    expect(await scope.revokeKey(created.id)).toEqual({ found: true, revokedNow: true });
    expect(await resolveMcpBearer(db, created.plaintext, RESOURCE)).toBeNull();
    expect(await scope.listKeys()).toEqual([]);
  });

  it('opts capture off and agent:ask on through mcpStaticKeyScopes', async () => {
    const scope = withTeam(db, TEAM_ID, USER_ID).mcpOutbound;
    const readonly = await scope.createKey({ name: 'Readonly', allowCapture: false });
    expect(readonly.scopes).toEqual(['read']);
    const operator = await scope.createKey({ name: 'Operator', allowAgent: true });
    expect(operator.scopes).toEqual(['read', 'capture', 'agent:ask']);
  });
});
