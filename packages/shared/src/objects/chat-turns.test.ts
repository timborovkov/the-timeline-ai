import { expect } from '@timeline/test-support';
import { beforeAll, beforeEach, afterAll, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

import type { PGlite } from '@electric-sql/pglite';
import type { Db } from '@timeline/db';
import type { UIMessage } from 'ai';

// Persisted chat preserves completed/pending tools and admits each approval only once.
const TEAM_A = '11111111-1111-1111-1111-111111111111';
const TEAM_B = '22222222-2222-2222-2222-222222222222';
const USER_OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_MEMBER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_OTHER_TEAM = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

let pg: PGlite;
let db: Db;
let testDb: ResettablePGliteTestDb;

async function seedWorkspace(target: PGlite): Promise<void> {
  await target.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES
      ('${TEAM_A}', 'team-a', 'Team A'),
      ('${TEAM_B}', 'team-b', 'Team B');

    INSERT INTO users (id, email)
    VALUES
      ('${USER_OWNER}', 'owner@test.local'),
      ('${USER_MEMBER}', 'member@test.local'),
      ('${USER_OTHER_TEAM}', 'other@test.local');

    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_A}', '${USER_OWNER}', 'owner'),
      ('${TEAM_A}', '${USER_MEMBER}', 'member'),
      ('${TEAM_B}', '${USER_OTHER_TEAM}', 'owner');
  `);
}

beforeAll(async () => {
  testDb = await createResettablePGliteTestDb(seedWorkspace);
  pg = testDb.pg;
  db = drizzle(pg) as unknown as Db;
}, 60_000);
beforeEach(async () => {
  await testDb.reset();
});
afterAll(async () => {
  await testDb.close();
});
const user: UIMessage = {
  id: 'user-turn',
  role: 'user',
  parts: [{ type: 'text', text: 'Create a CRM board' }],
};
const pending: UIMessage = {
  id: 'assistant-turn',
  role: 'assistant',
  parts: [
    { type: 'text', text: 'Ready to create it.' },
    {
      type: 'tool-execute_board_create',
      toolCallId: 'call-1',
      input: { name: 'CRM' },
      state: 'approval-requested',
      approval: { id: 'approval-1' },
    },
  ],
};
function decision(approved = true): UIMessage {
  const message = structuredClone(pending);
  Object.assign(required(message.parts[1]), {
    state: 'approval-responded',
    approval: { id: 'approval-1', approved },
  });
  return message;
}
describe('chat turn persistence and approval claims', () => {
  it('deduplicates users and replaces continued assistant messages without losing tool results', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const session = await scope.createChatSession();
    await scope.persistChatTurn(session.id, { userMessage: user, assistantMessage: pending });
    const approved = await scope.claimChatApprovals(session.id, decision());
    expect(approved.parts[1]).toMatchObject({
      state: 'approval-responded',
      approval: { approved: true },
    });
    const completed = structuredClone(approved);
    Object.assign(required(completed.parts[1]), {
      state: 'output-available',
      output: { ok: true, board_id: 'created' },
    });
    completed.parts.push({ type: 'text', text: 'Created CRM.' });
    await scope.persistChatTurn(session.id, {
      userMessage: user,
      assistantMessage: completed,
      metadata: { usage: { totalTokens: 10 } },
    });
    const loaded = await scope.getChatSession(session.id);
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.messages[1]?.content).toMatchObject({
      version: 2,
      ui_message: completed,
      usage: { totalTokens: 10 },
    });
    expect(await scope.hasCompletedChatAnswer()).toBe(true);
    await expect(scope.claimChatApprovals(session.id, decision())).rejects.toThrow(
      'Approval no longer available',
    );
  });
  it('rejects forged inputs, IDs and decisions from other users or teams', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const session = await scope.createChatSession();
    await scope.persistChatTurn(session.id, { userMessage: user, assistantMessage: pending });
    const forged = decision();
    Object.assign(required(forged.parts[1]), { input: { name: 'Another board' } });
    await expect(scope.claimChatApprovals(session.id, forged)).rejects.toThrow('does not match');
    const wrongId = decision();
    Object.assign(required(wrongId.parts[1]), { approval: { id: 'invented', approved: true } });
    await expect(scope.claimChatApprovals(session.id, wrongId)).rejects.toThrow('does not match');
    for (const denied of [
      withTeam(db, TEAM_A, USER_MEMBER).objects,
      withTeam(db, TEAM_B, USER_OTHER_TEAM).objects,
    ]) {
      await expect(denied.claimChatApprovals(session.id, decision())).rejects.toThrow(
        'Session not found',
      );
      await expect(
        denied.persistChatTurn(session.id, { assistantMessage: pending }),
      ).rejects.toThrow('Session not found');
    }
    expect((await scope.claimChatApprovals(session.id, decision(false))).parts[1]).toMatchObject({
      approval: { approved: false },
    });
  });
  it('rejects approvals superseded by a newer turn', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const session = await scope.createChatSession();
    await scope.persistChatTurn(session.id, { assistantMessage: pending });
    await scope.persistChatTurn(session.id, {
      userMessage: {
        id: 'new-user',
        role: 'user',
        parts: [{ type: 'text', text: 'Do not create it.' }],
      },
      assistantMessage: {
        id: 'new-assistant',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Understood.' }],
      },
    });
    await expect(scope.claimChatApprovals(session.id, decision())).rejects.toThrow(
      'Approval no longer available',
    );
  });
  it('allows only one concurrent claim and keeps interrupted execution claimed', async () => {
    const scope = withTeam(db, TEAM_A, USER_OWNER).objects;
    const session = await scope.createChatSession();
    await scope.persistChatTurn(session.id, { assistantMessage: pending });
    const results = await Promise.allSettled([
      scope.claimChatApprovals(session.id, decision()),
      scope.claimChatApprovals(session.id, decision()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await expect(scope.claimChatApprovals(session.id, decision())).rejects.toThrow();
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Required test fixture missing');
  return value;
}
