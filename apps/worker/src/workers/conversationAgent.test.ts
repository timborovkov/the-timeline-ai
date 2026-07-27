// The direct-conversation worker must persist paid answers before delivery,
// retry provider delivery from cache, and abort long-running agent work.
import { PGlite } from '@electric-sql/pglite';
import { chatMessages, chatSurfaceTurns, type Db } from '@timeline/db';
import { conversationSurfaces, withTeam, type agent } from '@timeline/shared';
import { applyDbMigrations } from '@timeline/shared/test/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { processConversationAgentJob } from '#src/workers/conversationAgent.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

let pg: PGlite;
let db: Db;

beforeAll(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg) as unknown as Db;
}, 240_000);

beforeEach(async () => {
  await pg.exec(`
    TRUNCATE TABLE chat_surface_turns, chat_surface_session_links, chat_messages,
      chat_sessions, team_members, teams, users CASCADE;
    INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'team', 'Team');
    INSERT INTO users (id, email, name) VALUES ('${USER_ID}', 'owner@example.com', 'Owner');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
});

afterAll(async () => {
  await pg.close();
});

async function createTurn(eventId: string): Promise<string> {
  const created = await withTeam(db, TEAM_ID, USER_ID).conversations.createTurn({
    surface: 'telegram',
    externalEventId: eventId,
    externalMessageId: '42',
    externalConversationKey: 'dm:7',
    externalUserKey: '7',
    teamId: TEAM_ID,
    userId: USER_ID,
    userName: 'Owner',
    question: 'What changed?',
  });
  if (created.status !== 'accepted') throw new Error('expected accepted turn');
  return created.turn.id;
}

function adapter(overrides: Partial<conversationSurfaces.ConversationDeliveryAdapter> = {}) {
  return {
    acknowledgeAgentRequest: vi.fn().mockResolvedValue(undefined),
    acknowledgeCapture: vi.fn().mockResolvedValue(undefined),
    startProgress: vi.fn().mockResolvedValue(vi.fn()),
    deliverAnswer: vi.fn().mockResolvedValue(undefined),
    deliverFailure: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } satisfies conversationSurfaces.ConversationDeliveryAdapter;
}

describe('conversation agent worker', () => {
  it('stores transcript and model attribution before delivering the answer', async () => {
    const turnId = await createTurn('event-1');
    const stopProgress = vi.fn();
    const delivery = adapter({
      startProgress: vi.fn().mockResolvedValue(stopProgress),
    });
    const askAgent = vi.fn().mockResolvedValue({
      ok: true,
      answer: 'The durable answer',
      truncated: false,
      requestedModelId: 'requested',
      responseModelId: 'response',
    }) as typeof agent.askAgent;

    await expect(
      processConversationAgentJob(
        {
          db,
          askAgent,
          createDeliveryAdapter: () => Promise.resolve(delivery),
        },
        { turnId },
      ),
    ).resolves.toEqual({ turnId, status: 'delivered' });

    expect(delivery.deliverAnswer).toHaveBeenCalledWith('The durable answer');
    const turns = await db.select().from(chatSurfaceTurns).where(eq(chatSurfaceTurns.id, turnId));
    expect(turns[0]).toMatchObject({
      status: 'delivered',
      answerText: 'The durable answer',
      requestedModelId: 'requested',
      responseModelId: 'response',
    });
    expect(turns[0]?.answeredAt).toBeInstanceOf(Date);
    expect(turns[0]?.deliveredAt).toBeInstanceOf(Date);
    expect(await db.select().from(chatMessages)).toHaveLength(2);
    expect(delivery.startProgress).toHaveBeenCalledOnce();
    expect(stopProgress).toHaveBeenCalledOnce();
  });

  it('retries delivery from the cached answer without rerunning the model', async () => {
    const turnId = await createTurn('event-2');
    const deliverAnswer = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValue(undefined);
    const delivery = adapter({ deliverAnswer });
    const askAgent = vi.fn().mockResolvedValue({
      ok: true,
      answer: 'Paid once',
      truncated: false,
    }) as typeof agent.askAgent;
    const deps = {
      db,
      askAgent,
      createDeliveryAdapter: () => Promise.resolve(delivery),
    };

    await expect(processConversationAgentJob(deps, { turnId })).rejects.toThrow(
      'provider unavailable',
    );
    await expect(processConversationAgentJob(deps, { turnId })).resolves.toEqual({
      turnId,
      status: 'delivered_cached',
    });

    expect(askAgent).toHaveBeenCalledOnce();
    expect(deliverAnswer).toHaveBeenCalledTimes(2);
  });

  it('does not deliver a cached answer after the provider session is reset', async () => {
    const turnId = await createTurn('event-reset-after-answer');
    const deliverAnswer = vi.fn().mockRejectedValueOnce(new Error('provider unavailable'));
    const delivery = adapter({ deliverAnswer });
    const askAgent = vi.fn().mockResolvedValue({
      ok: true,
      answer: 'Do not deliver after reset',
      truncated: false,
    }) as typeof agent.askAgent;
    const deps = {
      db,
      askAgent,
      createDeliveryAdapter: () => Promise.resolve(delivery),
    };

    await expect(processConversationAgentJob(deps, { turnId })).rejects.toThrow(
      'provider unavailable',
    );
    await withTeam(db, TEAM_ID, USER_ID).conversations.resetSession({
      surface: 'telegram',
      externalConversationKey: 'dm:7',
      externalUserKey: '7',
      teamId: TEAM_ID,
      userId: USER_ID,
      userName: 'Owner',
    });
    await expect(processConversationAgentJob(deps, { turnId })).resolves.toEqual({
      turnId,
      status: 'cancelled',
    });

    expect(askAgent).toHaveBeenCalledOnce();
    expect(deliverAnswer).toHaveBeenCalledOnce();
  });

  it('aborts at the deadline, caches the timeout response, and stops progress', async () => {
    const turnId = await createTurn('event-3');
    const stopProgress = vi.fn();
    const delivery = adapter({
      startProgress: vi.fn().mockResolvedValue(stopProgress),
    });
    let agentSignal: AbortSignal | undefined;
    const askAgent = vi.fn((_input: agent.AskAgentInput, deps: agent.AskAgentDeps) => {
      agentSignal = deps.abortSignal;
      return new Promise<agent.AskAgentResult>(() => undefined);
    }) as typeof agent.askAgent;

    await expect(
      processConversationAgentJob(
        {
          db,
          askAgent,
          timeoutMs: 5,
          createDeliveryAdapter: () => Promise.resolve(delivery),
        },
        { turnId },
      ),
    ).resolves.toEqual({ turnId, status: 'timed_out' });

    expect(delivery.deliverFailure).toHaveBeenCalledWith(
      conversationSurfaces.CONVERSATION_AGENT_TIMEOUT_MESSAGE,
    );
    expect(agentSignal?.aborted).toBe(true);
    expect(stopProgress).toHaveBeenCalledOnce();
    const turns = await db.select().from(chatSurfaceTurns).where(eq(chatSurfaceTurns.id, turnId));
    expect(turns[0]).toMatchObject({
      status: 'timed_out',
      errorCode: 'agent_timeout',
      answerText: conversationSurfaces.CONVERSATION_AGENT_TIMEOUT_MESSAGE,
    });
  });

  it('times out when provider progress startup never resolves', async () => {
    const turnId = await createTurn('event-progress-timeout');
    const delivery = adapter({
      startProgress: vi.fn(() => new Promise<() => void>(() => undefined)),
    });
    const askAgent = vi.fn() as unknown as typeof agent.askAgent;

    await expect(
      processConversationAgentJob(
        {
          db,
          askAgent,
          timeoutMs: 5,
          createDeliveryAdapter: () => Promise.resolve(delivery),
        },
        { turnId },
      ),
    ).resolves.toEqual({ turnId, status: 'timed_out' });

    expect(askAgent).not.toHaveBeenCalled();
    expect(delivery.deliverFailure).toHaveBeenCalledWith(
      conversationSurfaces.CONVERSATION_AGENT_TIMEOUT_MESSAGE,
    );
  });

  it('fails a stale processing turn closed without another model call', async () => {
    const turnId = await createTurn('event-4');
    await withTeam(db, TEAM_ID, USER_ID).conversations.claimTurn(turnId);
    const delivery = adapter();
    const askAgent = vi.fn() as unknown as typeof agent.askAgent;

    await expect(
      processConversationAgentJob(
        {
          db,
          askAgent,
          createDeliveryAdapter: () => Promise.resolve(delivery),
        },
        { turnId },
      ),
    ).resolves.toEqual({ turnId, status: 'stale_processing' });

    expect(askAgent).not.toHaveBeenCalled();
    expect(delivery.deliverFailure).toHaveBeenCalledWith(
      conversationSurfaces.CONVERSATION_AGENT_FAILURE_MESSAGE,
    );
    const turns = await db.select().from(chatSurfaceTurns).where(eq(chatSurfaceTurns.id, turnId));
    expect(turns[0]).toMatchObject({
      status: 'failed',
      errorCode: 'stale_processing',
    });
    expect(turns[0]?.deliveredAt).toBeInstanceOf(Date);
  });

  it('caches a provider-adapter failure before retrying delivery', async () => {
    const turnId = await createTurn('event-5');
    const delivery = adapter();
    const askAgent = vi.fn() as unknown as typeof agent.askAgent;
    const createDeliveryAdapter = vi
      .fn()
      .mockRejectedValueOnce(new Error('workspace token unavailable'))
      .mockResolvedValue(delivery);
    const deps = { db, askAgent, createDeliveryAdapter };

    await expect(processConversationAgentJob(deps, { turnId })).rejects.toThrow(
      'workspace token unavailable',
    );
    await expect(processConversationAgentJob(deps, { turnId })).resolves.toEqual({
      turnId,
      status: 'delivered_cached',
    });

    expect(askAgent).not.toHaveBeenCalled();
    expect(delivery.deliverFailure).toHaveBeenCalledWith(
      conversationSurfaces.CONVERSATION_AGENT_FAILURE_MESSAGE,
    );
    const turns = await db.select().from(chatSurfaceTurns).where(eq(chatSurfaceTurns.id, turnId));
    expect(turns[0]).toMatchObject({
      status: 'failed',
      errorCode: 'delivery_adapter_unavailable',
    });
    expect(turns[0]?.deliveredAt).toBeInstanceOf(Date);
  });
});
