import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import {
  rawEvents,
  slackConversationBindings,
  slackUsers,
  slackUserTeams,
  slackWorkspaces,
  slackWorkspaceTeams,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptJson, resetSecretsKeyCacheForTests } from '../crypto/secrets.js';
import { resetEnvForTests } from '../env.js';

const askAgentMock = vi.hoisted(() => vi.fn());

vi.mock('../agent/ask.js', () => ({
  askAgent: askAgentMock,
}));

import {
  handleSlackEnvelope,
  handleSlackSlashCommand,
  linkSlackUserFromOAuth,
} from './dispatcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../db/drizzle');

const TEAM_A = '11111111-1111-1111-1111-111111111111';
const TEAM_B = '22222222-2222-2222-2222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WORKSPACE_ID = '33333333-3333-3333-3333-333333333333';
const SLACK_USER_ROW_ID = '44444444-4444-4444-4444-444444444444';

async function applyMigrations(pg: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'SELECT 1;');
    for (const stmt of statements) await pg.exec(stmt);
  }
}

async function seedTeams(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_A}', 'team-a', 'Team A'), ('${TEAM_B}', 'team-b', 'Team B');
    INSERT INTO users (id, email, name)
    VALUES
      ('${USER_A}', 'a@example.com', 'Alice'),
      ('${USER_B}', 'b@example.com', 'Bob');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_A}', '${USER_A}', 'owner'),
      ('${TEAM_B}', '${USER_B}', 'owner');
  `);
}

async function seedWorkspace(db: ReturnType<typeof drizzle>, teamId = TEAM_A): Promise<void> {
  const token = encryptJson({ accessToken: 'xoxb-test' });
  await db.insert(slackWorkspaces).values({
    id: WORKSPACE_ID,
    slackTeamId: 'T_SLACK',
    name: 'Acme Slack',
    botUserId: 'U_BOT',
    tokenCiphertext: token.ciphertext,
    tokenIv: token.iv,
    tokenTag: token.tag,
    installedByUserId: teamId === TEAM_A ? USER_A : USER_B,
  });
  await db.insert(slackWorkspaceTeams).values({
    workspaceId: WORKSPACE_ID,
    teamId,
    installedByUserId: teamId === TEAM_A ? USER_A : USER_B,
    enabled: true,
  });
}

function slackEnvelope(eventId: string, event: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'event_callback',
    team_id: 'T_SLACK',
    event_id: eventId,
    event_time: 1_700_000_000,
    event,
  };
}

function installFetchMock(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string | URL | Request, _init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    if (href.includes('users.info')) {
      return Promise.resolve(
        Response.json({
          ok: true,
          user: {
            id: 'U_SLACK',
            name: 'alice',
            real_name: 'Alice Slack',
            profile: { display_name: 'Alice Slack', real_name: 'Alice Slack' },
          },
        }),
      );
    }
    if (href.includes('reactions.add') || href.includes('chat.postMessage')) {
      return Promise.resolve(Response.json({ ok: true }));
    }
    if (href.includes('files.example')) {
      return Promise.resolve(
        new Response(Buffer.from('%PDF-1.7'), {
          headers: { 'content-type': 'application/pdf' },
        }),
      );
    }
    return Promise.resolve(Response.json({ ok: true }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function seedBoundSlackUser(
  db: ReturnType<typeof drizzle>,
  channelId = 'C_DOCS',
): Promise<void> {
  await seedWorkspace(db, TEAM_A);
  await db.insert(slackConversationBindings).values({
    workspaceId: WORKSPACE_ID,
    teamId: TEAM_A,
    slackConversationId: channelId,
    conversationType: 'channel',
    title: 'docs',
    boundByUserId: USER_A,
    enabled: true,
  });
  await db.insert(slackUsers).values({
    id: SLACK_USER_ROW_ID,
    workspaceId: WORKSPACE_ID,
    slackUserId: 'U_SLACK',
    realName: 'Alice Slack',
  });
  await db.insert(slackUserTeams).values({
    slackUserId: SLACK_USER_ROW_ID,
    teamId: TEAM_A,
    userId: USER_A,
    linkedByUserId: USER_A,
    isActive: true,
  });
}

function fetchBodyContaining(fetchMock: ReturnType<typeof vi.fn>, needle: string): string | null {
  for (const [, init] of fetchMock.mock.calls as [unknown, RequestInit | undefined][]) {
    const body = init?.body;
    const text =
      typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : null;
    if (text?.includes(needle)) return text;
  }
  return null;
}

describe('Slack dispatcher routing', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    process.env.AUTH_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test';
    process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
    askAgentMock.mockReset();
    askAgentMock.mockResolvedValue({ ok: true, answer: 'answer' });
    pg = new PGlite();
    await applyMigrations(pg);
    await seedTeams(pg);
    db = drizzle(pg);
    installFetchMock();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await pg.close();
  });

  it('rejects user linking when the receiving team did not install that Slack workspace', async () => {
    await seedWorkspace(db, TEAM_A);

    await expect(
      linkSlackUserFromOAuth({
        db: db as never,
        teamId: TEAM_B,
        userId: USER_B,
        oauth: { ok: true, team: { id: 'T_SLACK' }, authed_user: { id: 'U_SLACK' } },
      }),
    ).rejects.toThrow('slack_workspace_not_installed');
  });

  it('does not answer app mentions in unbound Slack channels', async () => {
    const fetchMock = installFetchMock();
    await seedWorkspace(db, TEAM_A);

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvMention', {
        type: 'app_mention',
        channel: 'C_PUBLIC',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: '<@U_BOT> what happened?',
        ts: '1700000000.000100',
      }),
    );

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('chat.postMessage'),
      expect.anything(),
    );
  });

  it('rejects event callbacks without a Slack team_id', async () => {
    const result = await handleSlackEnvelope(
      { db: db as never },
      {
        type: 'event_callback',
        event_id: 'EvMissingTeam',
        event_time: 1_700_000_000,
        event: {
          type: 'message',
          channel: 'C_DOCS',
          channel_type: 'channel',
          user: 'U_SLACK',
          text: 'hello',
          ts: '1700000000.000100',
        },
      },
    );

    expect(result).toEqual({ ok: false });
  });

  it('does not call the agent for a bare app mention', async () => {
    const fetchMock = installFetchMock();
    await seedBoundSlackUser(db, 'C_MENTIONS');

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvMentionBare', {
        type: 'app_mention',
        channel: 'C_MENTIONS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: '<@U_BOT>',
        ts: '1700000000.000200',
      }),
    );

    expect(askAgentMock).not.toHaveBeenCalled();
    expect(
      fetchBodyContaining(fetchMock, 'Ask+a+question+after+mentioning+Timeline'),
    ).not.toBeNull();
  });

  it('posts an app mention failure follow-up when the agent throws', async () => {
    const fetchMock = installFetchMock();
    askAgentMock.mockRejectedValueOnce(new Error('model offline'));
    await seedBoundSlackUser(db, 'C_MENTIONS');

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvMentionFailure', {
        type: 'app_mention',
        channel: 'C_MENTIONS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: '<@U_BOT> what changed?',
        ts: '1700000000.000300',
      }),
    );

    expect(
      fetchBodyContaining(fetchMock, 'Timeline+could+not+answer+that+right+now.'),
    ).not.toBeNull();
  });

  it('preserves cached Slack profile fields when users.info returns no user', async () => {
    const fetchMock = vi.fn((url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (href.includes('users.info')) return Promise.resolve(Response.json({ ok: true }));
      if (href.includes('reactions.add') || href.includes('chat.postMessage')) {
        return Promise.resolve(Response.json({ ok: true }));
      }
      return Promise.resolve(Response.json({ ok: true }));
    });
    vi.stubGlobal('fetch', fetchMock);
    await seedBoundSlackUser(db, 'C_DOCS');

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvNullProfile', {
        type: 'message',
        channel: 'C_DOCS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'hello',
        ts: '1700000000.000300',
      }),
    );

    const rows = await db
      .select({ name: slackUsers.name, realName: slackUsers.realName })
      .from(slackUsers)
      .where(eq(slackUsers.id, SLACK_USER_ROW_ID));
    expect(rows[0]).toMatchObject({ name: null, realName: 'Alice Slack' });
  });

  it('captures Slack file_share messages and enqueues document extraction', async () => {
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackConversationBindings).values({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_A,
      slackConversationId: 'C_DOCS',
      conversationType: 'channel',
      title: 'docs',
      boundByUserId: USER_A,
      enabled: true,
    });
    await db.insert(slackUsers).values({
      id: SLACK_USER_ROW_ID,
      workspaceId: WORKSPACE_ID,
      slackUserId: 'U_SLACK',
      realName: 'Alice Slack',
    });
    await db.insert(slackUserTeams).values({
      slackUserId: SLACK_USER_ROW_ID,
      teamId: TEAM_A,
      userId: USER_A,
      linkedByUserId: USER_A,
      isActive: true,
    });
    const upload = vi.fn().mockResolvedValue(undefined);
    const enqueueExtract = vi.fn().mockResolvedValue(undefined);

    await handleSlackEnvelope(
      {
        db: db as never,
        documents: { upload, enqueueExtract },
      },
      slackEnvelope('EvFile', {
        type: 'message',
        subtype: 'file_share',
        channel: 'C_DOCS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: '',
        ts: '1700000001.000100',
        files: [
          {
            id: 'F1',
            name: 'plan.pdf',
            mimetype: 'application/pdf',
            size: 8,
            url_private_download: 'https://files.example/plan.pdf',
          },
        ],
      }),
    );

    expect(upload).toHaveBeenCalledOnce();
    expect(enqueueExtract).toHaveBeenCalledOnce();
  });

  it('does not duplicate Slack attachments when a message with files is edited', async () => {
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackConversationBindings).values({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_A,
      slackConversationId: 'C_DOCS',
      conversationType: 'channel',
      title: 'docs',
      boundByUserId: USER_A,
      enabled: true,
    });
    await db.insert(slackUsers).values({
      id: SLACK_USER_ROW_ID,
      workspaceId: WORKSPACE_ID,
      slackUserId: 'U_SLACK',
      realName: 'Alice Slack',
    });
    await db.insert(slackUserTeams).values({
      slackUserId: SLACK_USER_ROW_ID,
      teamId: TEAM_A,
      userId: USER_A,
      linkedByUserId: USER_A,
      isActive: true,
    });
    const upload = vi.fn().mockResolvedValue(undefined);
    const enqueueExtract = vi.fn().mockResolvedValue(undefined);
    const file = {
      id: 'F_EDIT',
      name: 'edited-plan.pdf',
      mimetype: 'application/pdf',
      size: 8,
      url_private_download: 'https://files.example/edited-plan.pdf',
    };

    await handleSlackEnvelope(
      { db: db as never, documents: { upload, enqueueExtract } },
      slackEnvelope('EvOriginalFile', {
        type: 'message',
        subtype: 'file_share',
        channel: 'C_DOCS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'original',
        ts: '1700000003.000100',
        files: [file],
      }),
    );
    await handleSlackEnvelope(
      { db: db as never, documents: { upload, enqueueExtract } },
      slackEnvelope('EvEditedFile', {
        type: 'message',
        subtype: 'message_changed',
        channel: 'C_DOCS',
        channel_type: 'channel',
        ts: '1700000010.000100',
        message: {
          user: 'U_SLACK',
          text: 'edited',
          ts: '1700000003.000100',
          files: [file],
        },
        previous_message: {
          user: 'U_SLACK',
          text: 'original',
          ts: '1700000003.000100',
        },
      }),
    );

    const docs = await pg.query<{ count: string }>('SELECT count(*)::text AS count FROM documents');
    expect(docs.rows[0]?.count).toBe('1');
    expect(upload).toHaveBeenCalledOnce();
    expect(enqueueExtract).toHaveBeenCalledOnce();
    const editRows = await pg.query<{
      occurred_at: Date;
      source_metadata: Record<string, unknown>;
    }>(
      `SELECT occurred_at, source_metadata
       FROM raw_events
       WHERE source_metadata->>'slack_event_id' = 'EvEditedFile'`,
    );
    expect(editRows.rows[0]?.occurred_at.toISOString()).toBe('2023-11-14T22:13:30.000Z');
    expect(editRows.rows[0]?.source_metadata).toMatchObject({
      slack_event_ts: '1700000010.000100',
    });
  });

  it('processes files newly added by a Slack message edit', async () => {
    await seedBoundSlackUser(db);
    const upload = vi.fn().mockResolvedValue(undefined);
    const enqueueExtract = vi.fn().mockResolvedValue(undefined);
    const originalFile = {
      id: 'F_ORIGINAL',
      name: 'original-plan.pdf',
      mimetype: 'application/pdf',
      size: 8,
      url_private_download: 'https://files.example/original-plan.pdf',
    };
    const addedFile = {
      id: 'F_ADDED',
      name: 'added-plan.pdf',
      mimetype: 'application/pdf',
      size: 8,
      url_private_download: 'https://files.example/added-plan.pdf',
    };

    await handleSlackEnvelope(
      { db: db as never, documents: { upload, enqueueExtract } },
      slackEnvelope('EvOriginalFiles', {
        type: 'message',
        subtype: 'file_share',
        channel: 'C_DOCS',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'original',
        ts: '1700000004.000100',
        files: [originalFile],
      }),
    );
    await handleSlackEnvelope(
      { db: db as never, documents: { upload, enqueueExtract } },
      slackEnvelope('EvEditedAddedFile', {
        type: 'message',
        subtype: 'message_changed',
        channel: 'C_DOCS',
        channel_type: 'channel',
        ts: '1700000011.000100',
        message: {
          user: 'U_SLACK',
          text: 'edited',
          ts: '1700000004.000100',
          files: [originalFile, addedFile],
        },
        previous_message: {
          user: 'U_SLACK',
          text: 'original',
          ts: '1700000004.000100',
        },
      }),
    );

    const docs = await pg.query<{ count: string }>('SELECT count(*)::text AS count FROM documents');
    expect(docs.rows[0]?.count).toBe('2');
    expect(upload).toHaveBeenCalledTimes(2);
    expect(enqueueExtract).toHaveBeenCalledTimes(2);
  });

  it('posts a slash command failure follow-up when the agent throws', async () => {
    const fetchMock = installFetchMock();
    askAgentMock.mockRejectedValueOnce(new Error('model offline'));
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackUsers).values({
      id: SLACK_USER_ROW_ID,
      workspaceId: WORKSPACE_ID,
      slackUserId: 'U_SLACK',
      realName: 'Alice Slack',
    });
    await db.insert(slackUserTeams).values({
      slackUserId: SLACK_USER_ROW_ID,
      teamId: TEAM_A,
      userId: USER_A,
      linkedByUserId: USER_A,
      isActive: true,
    });

    await handleSlackSlashCommand(
      { db: db as never },
      {
        command: '/ask',
        text: 'what changed?',
        user_id: 'U_SLACK',
        team_id: 'T_SLACK',
        channel_id: 'C_DM',
        response_url: 'https://hooks.slack.test/response',
        trigger_id: 'trigger-failure',
      },
    );

    const responseCall = fetchMock.mock.calls.find(
      (call): call is [string, RequestInit] => call[0] === 'https://hooks.slack.test/response',
    );
    expect(responseCall?.[1].method).toBe('POST');
    const body = responseCall?.[1].body;
    expect(typeof body === 'string' ? body : '').toContain(
      'Timeline could not answer that right now.',
    );
  });

  it('attributes bound channel messages to the sender linked in that Timeline team', async () => {
    await seedWorkspace(db, TEAM_A);
    await db.insert(slackWorkspaceTeams).values({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_B,
      installedByUserId: USER_B,
      enabled: true,
    });
    await db.insert(slackConversationBindings).values({
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_B,
      slackConversationId: 'C_TEAM_B',
      conversationType: 'channel',
      title: 'team-b',
      boundByUserId: USER_B,
      enabled: true,
    });
    await db.insert(slackUsers).values({
      id: SLACK_USER_ROW_ID,
      workspaceId: WORKSPACE_ID,
      slackUserId: 'U_SLACK',
      realName: 'Slack Sender',
    });
    await db.insert(slackUserTeams).values([
      {
        slackUserId: SLACK_USER_ROW_ID,
        teamId: TEAM_A,
        userId: USER_A,
        linkedByUserId: USER_A,
        isActive: true,
      },
      {
        slackUserId: SLACK_USER_ROW_ID,
        teamId: TEAM_B,
        userId: USER_B,
        linkedByUserId: USER_B,
        isActive: false,
      },
    ]);

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvChannel', {
        type: 'message',
        channel: 'C_TEAM_B',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'team b update',
        ts: '1700000002.000100',
      }),
    );

    const rows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'slack'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ teamId: TEAM_B, authorUserId: USER_B });
  });

  it('keeps cached Slack profile data when users.info fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | Request) => {
        const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (href.includes('users.info')) {
          return Promise.resolve(Response.json({ ok: false, error: 'ratelimited' }));
        }
        return Promise.resolve(Response.json({ ok: true }));
      }),
    );
    await seedBoundSlackUser(db, 'C_PROFILE');
    await db
      .update(slackUsers)
      .set({
        name: 'cached-name',
        realName: 'Cached Real',
        email: 'cached@example.com',
        avatarUrl: 'https://cdn.example/avatar.png',
        metadata: { cached: true },
      })
      .where(eq(slackUsers.id, SLACK_USER_ROW_ID));

    await handleSlackEnvelope(
      { db: db as never },
      slackEnvelope('EvProfileCache', {
        type: 'message',
        channel: 'C_PROFILE',
        channel_type: 'channel',
        user: 'U_SLACK',
        text: 'cached profile survives',
        ts: '1700000004.000100',
      }),
    );

    const users = await db
      .select({
        name: slackUsers.name,
        realName: slackUsers.realName,
        email: slackUsers.email,
        avatarUrl: slackUsers.avatarUrl,
        metadata: slackUsers.metadata,
      })
      .from(slackUsers)
      .where(eq(slackUsers.id, SLACK_USER_ROW_ID));
    expect(users[0]).toMatchObject({
      name: 'cached-name',
      realName: 'Cached Real',
      email: 'cached@example.com',
      avatarUrl: 'https://cdn.example/avatar.png',
      metadata: { cached: true },
    });

    const rows = await db
      .select({ metadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.source, 'slack'));
    expect(rows[0]?.metadata).toMatchObject({ slack_sender_name: 'Cached Real' });
  });
});
