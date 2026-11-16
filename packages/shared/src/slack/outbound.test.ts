import { PGlite } from '@electric-sql/pglite';
import { type Db, teams, slackWorkspaces, slackWorkspaceTeams } from '@timeline/db';
import { vi, expect } from '@timeline/test-support';
import { afterAll, afterEach, beforeAll, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { encryptJson, resetSecretsKeyCacheForTests } from '#src/crypto/secrets.js';
import { resetEnvForTests } from '#src/env.js';
import { SlackApi } from '#src/slack/api.js';
import { sendTeamSlackMessage, sendTeamSlackDirectMessage } from '#src/slack/outbound.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const pg = new PGlite();
const db = drizzle(pg) as unknown as Db;
const teamId = '11111111-1111-4111-8111-111111111111';
const otherTeamId = '22222222-2222-4222-8222-222222222222';
const workspaceId = '33333333-3333-4333-8333-333333333333';
const priorKey = process.env.SECRETS_ENCRYPTION_KEY;
beforeAll(async () => {
  process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  resetEnvForTests();
  resetSecretsKeyCacheForTests();
  await applyDbMigrations(pg);
  await db.insert(teams).values([
    { id: teamId, slug: 'outbound-a', name: 'A' },
    { id: otherTeamId, slug: 'outbound-b', name: 'B' },
  ]);
  const token = encryptJson({ accessToken: 'synthetic-slack-token' });
  await db.insert(slackWorkspaces).values({
    id: workspaceId,
    slackTeamId: 'T_SYNTHETIC',
    tokenCiphertext: token.ciphertext,
    tokenIv: token.iv,
    tokenTag: token.tag,
  });
  await db.insert(slackWorkspaceTeams).values({ workspaceId, teamId });
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  if (priorKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = priorKey;
  resetEnvForTests();
  resetSecretsKeyCacheForTests();
  await pg.close();
});

describe('team Slack outbound delivery', () => {
  it('sends only through the receiving team enabled install', async () => {
    const post = vi.spyOn(SlackApi.prototype, 'postMessage').mockResolvedValue(undefined);
    await sendTeamSlackMessage({ db, teamId, channelId: 'C_TEST', text: 'message' });
    expect(post).toHaveBeenCalledWith({ channel: 'C_TEST', text: 'message' });
    await expect(
      sendTeamSlackMessage({ db, teamId: otherTeamId, channelId: 'C_TEST', text: 'message' }),
    ).rejects.toThrow('no longer enabled');
    await db
      .update(slackWorkspaceTeams)
      .set({ enabled: false })
      .where(eq(slackWorkspaceTeams.teamId, teamId));
    await expect(
      sendTeamSlackMessage({ db, teamId, channelId: 'C_TEST', text: 'message' }),
    ).rejects.toThrow('no longer enabled');
    expect(post).toHaveBeenCalledTimes(1);
    await db
      .update(slackWorkspaceTeams)
      .set({ enabled: true })
      .where(eq(slackWorkspaceTeams.teamId, teamId));
  });
  it('opens a DM after direct user-id posting fails', async () => {
    const post = vi
      .spyOn(SlackApi.prototype, 'postMessage')
      .mockRejectedValueOnce(new Error('channel_not_found'))
      .mockResolvedValueOnce(undefined);
    const open = vi
      .spyOn(SlackApi.prototype, 'conversationsOpen')
      .mockResolvedValue({ id: 'D_TEST' });
    await sendTeamSlackDirectMessage({ db, teamId, slackUserId: 'U_TEST', text: 'message' });
    expect(open).toHaveBeenCalledWith('U_TEST');
    expect(post.mock.calls).toEqual([
      [{ channel: 'U_TEST', text: 'message' }],
      [{ channel: 'D_TEST', text: 'message' }],
    ]);
  });
});
