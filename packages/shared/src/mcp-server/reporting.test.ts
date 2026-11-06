import { type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { beforeAll, beforeEach, afterAll, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import { effectiveReporting, reportingInput } from '#src/mcp-server/reporting.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const team = '11111111-1111-4111-8111-111111111111';
let fixture: ResettablePGliteTestDb;
let db: Db;
beforeAll(async () => {
  fixture = await createResettablePGliteTestDb(async (pg) => {
    await pg.exec(
      `INSERT INTO users(id,email) VALUES ('${owner}','owner@example.test'); INSERT INTO teams(id,name,slug) VALUES ('${team}','Team','team'); INSERT INTO team_members(team_id,user_id,role) VALUES ('${team}','${owner}','owner');`,
    );
  });
  db = drizzle(fixture.pg) as unknown as Db;
});
beforeEach(async () => {
  await fixture.reset();
});
afterAll(async () => {
  await fixture.close();
});
describe('coworker reporting', () => {
  it('requires a scope and resolves overrides before defaults', () => {
    expect(reportingInput.safeParse({ mode: 'handoffs', scope: '' }).success).toBe(false);
    const defaults = { mode: 'on_request' as const, scope: '', revision: '0' };
    const override = { mode: 'handoffs' as const, scope: 'Project A', revision: '1' };
    expect(effectiveReporting(defaults, null)).toEqual(defaults);
    expect(effectiveReporting(defaults, override)).toEqual(override);
  });
  it('returns only the authenticated connection and rejects other teams and members editing defaults', async () => {
    const scope = withTeam(db, team, owner);
    const key = await scope.mcpOutbound.createKey({ name: 'Agent', allowCapture: false });
    const actor = '00000000-0000-0000-0000-000000000000';
    const principal = {
      authType: 'api_key' as const,
      teamId: team,
      userId: actor,
      keyId: key.id,
      clientId: key.prefix,
      scopes: ['read'],
    };
    const connected = withTeam(db, team, actor, { skipMembershipCheck: true });
    expect(await connected.agentReporting.current(principal)).toMatchObject({
      team: { id: team },
      scopes: ['read'],
      reporting: { mode: 'on_request' },
    });
    await expect(
      connected.agentReporting.current({
        ...principal,
        teamId: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toThrow('principal mismatch');
    await fixture.pg.exec("update team_members set role='member'");
    await expect(
      withTeam(db, team, owner).agentReporting.update(
        { type: 'workspace' },
        { mode: 'on_request' },
      ),
    ).rejects.toThrow();
  });
  it('inherits defaults and stores an override without expanding capture scopes', async () => {
    const scope = withTeam(db, team, owner);
    const key = await scope.mcpOutbound.createKey({ name: 'Read only', allowCapture: false });
    await scope.agentReporting.update(
      { type: 'workspace' },
      { mode: 'handoffs', scope: 'Project A' },
    );
    expect((await scope.agentReporting.list()).defaults.mode).toBe('handoffs');
    await scope.agentReporting.update(
      { type: 'api_key', id: key.id },
      { mode: 'on_request', scope: '' },
    );
    expect((await scope.agentReporting.list()).connections[0]?.preference?.mode).toBe('on_request');
    expect((await scope.mcpOutbound.listKeys())[0]?.scopes).toEqual(['read']);
    await scope.agentReporting.update({ type: 'api_key', id: key.id }, null);
    expect((await scope.agentReporting.list()).connections[0]?.preference).toBeNull();
    await expect(
      scope.agentReporting.update(
        { type: 'api_key', id: '22222222-2222-4222-8222-222222222222' },
        { mode: 'on_request' },
      ),
    ).rejects.toThrow('Connection unavailable');
  });
});
