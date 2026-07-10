import { Buffer } from 'node:buffer';

import { PGlite } from '@electric-sql/pglite';
import {
  rawEvents,
  slackUsers,
  slackUserTeams,
  slackWorkspaces,
  slackWorkspaceTeams,
  telegramChatBindings,
} from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentTurnObservability } from '#src/agent/observability.js';
import type { TelegramApi } from '#src/telegram/api.js';

import { encryptJson, resetSecretsKeyCacheForTests } from '#src/crypto/secrets.js';
import { resetEnvForTests } from '#src/env.js';
import { handleSlackSlashCommand } from '#src/slack/dispatcher.js';
import { handleUpdate } from '#src/telegram/dispatcher.js';
import { buildSearchHit, makeAskAgentToolRoundModel } from '#src/test/agent-eval-harness.js';
import { applyDbMigrations } from '#src/test/pglite.js';

vi.mock('#src/http/external-fetch.js', () => ({
  externalFetch: (input: string | URL, init?: RequestInit) => fetch(input, init),
}));

// Surface evals keep Slack and Telegram `/ask` wired to the real non-browser
// agent path. Success means a dispatcher can route identity/team context into
// askAgent, run a tool-backed answer, deliver plain bot text, and expose the
// same tool observability used by chat diagnostics.

const ENV_BACKUP = { ...process.env };
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RAW_EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const SLACK_USER_ROW_ID = '44444444-4444-4444-8444-444444444444';
const TG_CHAT_ID = -201;
const TG_USER_ID = 7503673734;

type Db = ReturnType<typeof drizzle>;

function makeAgentDeps(observability: AgentTurnObservability[]) {
  return {
    includeMcpTools: false,
    model: makeAskAgentToolRoundModel({
      toolName: 'search_timeline',
      toolInput: { query: 'Acme renewal' },
      answer: `**Acme** renewal pricing is due Friday [ev:${RAW_EVENT_ID}].`,
    }),
    teamScopeDeps: {
      embed: () =>
        Promise.resolve({
          vector: [0.9, 0.1, 0.1],
          model: 'surface-eval-embed',
        }),
      qdrantSearch: () =>
        Promise.resolve([
          buildSearchHit({
            teamId: TEAM_ID,
            eventId: RAW_EVENT_ID,
            score: 0.94,
            authorUserId: USER_ID,
            visibilityOwnerUserId: USER_ID,
          }),
        ]),
    },
    onTurnObservability: (turn: AgentTurnObservability) => {
      observability.push(turn);
    },
  };
}

async function seedBase(pg: PGlite, db: Db): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'surface-evals', 'Surface Evals');
    INSERT INTO users (id, email, name)
    VALUES ('${USER_ID}', 'surface@example.com', 'Surface Tester');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
  await db.insert(rawEvents).values({
    id: RAW_EVENT_ID,
    teamId: TEAM_ID,
    authorUserId: USER_ID,
    source: 'web',
    contentText: 'Acme renewal pricing is due Friday.',
    occurredAt: new Date('2026-06-01T09:00:00.000Z'),
    visibility: 'team',
    sourceMetadata: {},
  });
}

async function seedSlack(db: Db): Promise<void> {
  const token = encryptJson({ accessToken: 'xoxb-surface-eval' });
  await db.insert(slackWorkspaces).values({
    id: WORKSPACE_ID,
    slackTeamId: 'T_SURFACE',
    name: 'Surface Slack',
    botUserId: 'U_BOT',
    tokenCiphertext: token.ciphertext,
    tokenIv: token.iv,
    tokenTag: token.tag,
    installedByUserId: USER_ID,
  });
  await db.insert(slackWorkspaceTeams).values({
    workspaceId: WORKSPACE_ID,
    teamId: TEAM_ID,
    installedByUserId: USER_ID,
    enabled: true,
  });
  await db.insert(slackUsers).values({
    id: SLACK_USER_ROW_ID,
    workspaceId: WORKSPACE_ID,
    slackUserId: 'U_SURFACE',
    realName: 'Surface Slack',
  });
  await db.insert(slackUserTeams).values({
    slackUserId: SLACK_USER_ROW_ID,
    teamId: TEAM_ID,
    userId: USER_ID,
    linkedByUserId: USER_ID,
    isActive: true,
  });
}

function recordingTelegram(payloads: Parameters<TelegramApi['sendMessage']>[0][]): TelegramApi {
  return {
    sendMessage: (input) => {
      payloads.push(input);
      return Promise.resolve();
    },
    getChatAdministrators: () => Promise.resolve([]),
    answerCallbackQuery: () => Promise.resolve(),
    editMessageText: () => Promise.resolve(),
    getFile: () => Promise.reject(new Error('not used')),
    downloadFile: () => Promise.reject(new Error('not used')),
    setMessageReaction: () => Promise.resolve(),
    sendChatAction: () => Promise.resolve(),
  };
}

describe('agent ask surface evals', () => {
  let pg: PGlite;
  let db: Db;

  beforeEach(async () => {
    process.env = {
      ...ENV_BACKUP,
      AUTH_SECRET: 'surface-eval-auth-secret',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/timeline_surface_eval',
      OPENROUTER_API_KEY: 'sk-surface-eval',
      QDRANT_URL: 'http://qdrant.surface-eval.test:6333',
      SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    };
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await seedBase(pg, db);
  }, 60_000);

  afterEach(async () => {
    vi.unstubAllGlobals();
    await pg.close();
    process.env = { ...ENV_BACKUP };
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
  });

  it('answers Slack /ask through the real askAgent pipeline with tool observability', async () => {
    const observability: AgentTurnObservability[] = [];
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(Response.json({ ok: true })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await seedSlack(db);

    await handleSlackSlashCommand(
      { db: db as never, agentDeps: makeAgentDeps(observability) },
      {
        command: '/ask',
        text: 'What is due for Acme?',
        user_id: 'U_SURFACE',
        team_id: 'T_SURFACE',
        channel_id: 'C_SURFACE',
        response_url: 'https://hooks.slack.test/surface',
        trigger_id: 'surface-slack-ask',
      },
    );

    const responseCall = fetchMock.mock.calls.find(
      (call) => call[0] === 'https://hooks.slack.test/surface',
    );
    const responseInit = responseCall?.[1];
    const responseBody = responseInit?.body;
    expect(responseInit?.method).toBe('POST');
    expect(typeof responseBody).toBe('string');
    expect(JSON.parse(responseBody as string)).toMatchObject({
      text: 'Acme renewal pricing is due Friday.',
      mrkdwn: false,
    });
    expect(observability).toEqual([
      expect.objectContaining({
        totalResultCount: 1,
        toolObservations: [
          expect.objectContaining({
            tool: 'search_timeline',
            group: 'timeline',
            ok: true,
            resultCount: 1,
          }),
        ],
      }),
    ]);
  });

  it('answers Telegram group /ask through the real askAgent pipeline with tool observability', async () => {
    const observability: AgentTurnObservability[] = [];
    const payloads: Parameters<TelegramApi['sendMessage']>[0][] = [];
    await db.insert(telegramChatBindings).values({
      tgChatId: TG_CHAT_ID,
      teamId: TEAM_ID,
      boundByUserId: USER_ID,
      title: 'Surface Telegram',
    });

    await handleUpdate(
      {
        db: db as never,
        tg: recordingTelegram(payloads),
        agentDeps: makeAgentDeps(observability),
      },
      {
        update_id: 501,
        message: {
          message_id: 77,
          date: 1_700_000_005,
          chat: { id: TG_CHAT_ID, type: 'supergroup', title: 'Surface Telegram' },
          from: {
            id: TG_USER_ID,
            first_name: 'Surface',
            last_name: 'Sender',
            username: 'surface',
          },
          text: '/ask What is due for Acme?',
        },
      },
    );

    expect(payloads).toContainEqual({
      chat_id: TG_CHAT_ID,
      text: 'Acme renewal pricing is due Friday.',
    });
    expect(observability).toEqual([
      expect.objectContaining({
        totalResultCount: 1,
        toolObservations: [
          expect.objectContaining({
            tool: 'search_timeline',
            group: 'timeline',
            ok: true,
            resultCount: 1,
          }),
        ],
      }),
    ]);
  });
});
