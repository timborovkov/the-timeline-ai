import { createHmac } from 'node:crypto';

import { resetEnvForTests } from '@timeline/shared/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as MeetingsModule from '@timeline/shared/meetings';

/**
 * Route-level tests for the Recall status webhook. These cover the
 * state-machine logic that the unit tests can't reach:
 *
 *   - Svix signature verification accepts good payloads and rejects bad ones
 *   - Terminal-state guard (completed/failed) short-circuits with 200
 *   - Backwards-transition guard on bot.status_change
 *   - bot.call_ended flips processing + enqueues finalize
 *   - Redis-down precheck returns 503 BEFORE any DB write (so Recall's
 *     retry re-enters the branch cleanly with the prior status intact)
 *   - bot.fatal / bot.failed always wins (overrides processing)
 *
 * The real Svix verifier and zod schemas run; only the DB lookup, scope
 * mutations, and the queue enqueue are mocked.
 */

const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  fakeLookup: vi.fn(),
  fakeEnqueueFinalize: vi.fn(),
  fakeUpdateStatus: vi.fn(),
  fakeWithTeam: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/queue', () => ({
  requireRedisQueue: vi.fn().mockResolvedValue({
    enqueueMeetingFinalizeJob: fakes.fakeEnqueueFinalize,
  }),
}));

vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: (...args: unknown[]) => {
    fakes.fakeWithTeam(...args);
    return { meetings: { updateMeetingStatus: fakes.fakeUpdateStatus } };
  },
}));

vi.mock('@timeline/shared/meetings', async () => {
  const actual = await vi.importActual<typeof MeetingsModule>('@timeline/shared/meetings');
  return {
    ...actual,
    lookupMeetingByBotId: fakes.fakeLookup,
  };
});

const { POST } = await import('./route.js');

const SECRET_RAW = 'supersecret-test-key';
const SECRET = `whsec_${Buffer.from(SECRET_RAW).toString('base64')}`;
const BOT_ID = 'bot-test-123';
const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function setEnv(over: Partial<NodeJS.ProcessEnv> = {}) {
  process.env.AUTH_SECRET = 'test-secret-test-secret';
  process.env.DATABASE_URL = 'postgres://x';
  process.env.RECALL_STATUS_WEBHOOK_SECRET = SECRET;
  process.env.RECALL_API_KEY = 'test-key';
  process.env.REDIS_URL = 'redis://localhost:6379';
  Object.assign(process.env, over);
}

function signedRequest(body: string, override: Partial<Record<string, string>> = {}) {
  const id = override['svix-id'] ?? `msg_${Date.now()}`;
  const ts = override['svix-timestamp'] ?? String(Math.floor(Date.now() / 1000));
  const sigBase = `${id}.${ts}.${body}`;
  const sig = createHmac('sha256', Buffer.from(SECRET_RAW, 'utf8'))
    .update(sigBase)
    .digest('base64');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'svix-id': id,
    'svix-timestamp': ts,
    'svix-signature': override['svix-signature'] ?? `v1,${sig}`,
  };
  return new Request('https://test.local/api/webhooks/recall/status', {
    method: 'POST',
    headers,
    body,
  });
}

function statusBody(event: string, code: string | undefined) {
  return JSON.stringify({
    event,
    data: { bot: { id: BOT_ID, status: code ? { code } : undefined } },
  });
}

function recallStatusBody(event: string, code: string | undefined, updatedAt?: string) {
  return JSON.stringify({
    event,
    data: {
      data: code
        ? {
            code,
            updated_at: updatedAt ?? '2026-06-02T12:00:00.000000+00:00',
            sub_code: null,
          }
        : undefined,
      bot: { id: BOT_ID, metadata: {} },
    },
  });
}

beforeEach(() => {
  setEnv();
  resetEnvForTests();
  vi.clearAllMocks();
  fakes.fakeLookup.mockResolvedValue({
    id: 'meeting-1',
    teamId: TEAM_ID,
    createdByUserId: USER_ID,
    status: 'active',
    platform: 'meet',
    provider: 'recall',
  });
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('POST /api/webhooks/recall/status — config + auth', () => {
  it('returns 503 when secret is unset', async () => {
    delete process.env.RECALL_STATUS_WEBHOOK_SECRET;
    resetEnvForTests();
    const r = await POST(signedRequest(statusBody('bot.call_ended', 'call_ended')));
    expect(r.status).toBe(503);
  });

  it('returns 401 on bad signature', async () => {
    const r = await POST(
      signedRequest(statusBody('bot.call_ended', 'call_ended'), {
        'svix-signature': 'v1,AAAA',
      }),
    );
    expect(r.status).toBe(401);
    expect(fakes.fakeLookup).not.toHaveBeenCalled();
  });

  it('returns 200 with no_bot_id when payload lacks bot.id', async () => {
    const body = JSON.stringify({ event: 'bot.status_change', data: {} });
    const r = await POST(signedRequest(body));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { reason?: string };
    expect(json.reason).toBe('no_bot_id');
  });

  it('returns 200 with meeting_not_found when lookup returns null', async () => {
    fakes.fakeLookup.mockResolvedValueOnce(null);
    const r = await POST(signedRequest(statusBody('bot.call_ended', 'call_ended')));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { reason?: string };
    expect(json.reason).toBe('meeting_not_found');
  });
});

describe('POST /api/webhooks/recall/status — terminal-state guard', () => {
  it('short-circuits with 200 when meeting is already completed', async () => {
    fakes.fakeLookup.mockResolvedValueOnce({
      id: 'meeting-1',
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      status: 'completed',
      platform: 'meet',
      provider: 'recall',
    });
    const r = await POST(signedRequest(statusBody('bot.status_change', 'done')));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { reason?: string };
    expect(json.reason).toBe('terminal_status');
    expect(fakes.fakeUpdateStatus).not.toHaveBeenCalled();
    expect(fakes.fakeEnqueueFinalize).not.toHaveBeenCalled();
  });

  it('short-circuits with 200 when meeting is already failed (user cancelled)', async () => {
    fakes.fakeLookup.mockResolvedValueOnce({
      id: 'meeting-1',
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      status: 'failed',
      platform: 'meet',
      provider: 'recall',
    });
    const r = await POST(signedRequest(statusBody('bot.call_ended', 'call_ended')));
    expect(r.status).toBe(200);
    expect(fakes.fakeUpdateStatus).not.toHaveBeenCalled();
    expect(fakes.fakeEnqueueFinalize).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/recall/status — state transitions', () => {
  it('handles documented bot.in_call_recording events as active', async () => {
    fakes.fakeLookup.mockResolvedValueOnce({
      id: 'meeting-1',
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      status: 'joining',
      platform: 'meet',
      provider: 'recall',
    });
    const r = await POST(
      signedRequest(recallStatusBody('bot.in_call_recording', 'in_call_recording')),
    );
    expect(r.status).toBe(200);
    expect(fakes.fakeUpdateStatus).toHaveBeenCalledWith(
      'meeting-1',
      'active',
      expect.objectContaining({ startedAt: expect.any(Date) as Date }),
    );
    expect(fakes.fakeEnqueueFinalize).not.toHaveBeenCalled();
  });

  it('bot.call_ended flips processing + enqueues finalize', async () => {
    const r = await POST(signedRequest(statusBody('bot.call_ended', 'call_ended')));
    expect(r.status).toBe(200);
    expect(fakes.fakeUpdateStatus).toHaveBeenCalledWith(
      'meeting-1',
      'processing',
      expect.objectContaining({ endedAt: expect.any(Date) as Date }),
    );
    expect(fakes.fakeEnqueueFinalize).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      teamId: TEAM_ID,
    });
  });

  it('documented bot.call_ended events flip processing + enqueue finalize', async () => {
    const r = await POST(signedRequest(recallStatusBody('bot.call_ended', 'call_ended')));
    expect(r.status).toBe(200);
    expect(fakes.fakeUpdateStatus).toHaveBeenCalledWith(
      'meeting-1',
      'processing',
      expect.objectContaining({ endedAt: expect.any(Date) as Date }),
    );
    expect(fakes.fakeEnqueueFinalize).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      teamId: TEAM_ID,
    });
  });

  it('caps status_change at processing — never sets completed', async () => {
    const r = await POST(signedRequest(statusBody('bot.status_change', 'done')));
    expect(r.status).toBe(200);
    // status_change with code=done would map to 'completed' but we cap.
    expect(fakes.fakeUpdateStatus).toHaveBeenCalledWith(
      'meeting-1',
      'processing',
      expect.any(Object),
    );
    expect(fakes.fakeEnqueueFinalize).toHaveBeenCalled();
  });

  it('documented bot.done events enqueue finalize without directly completing', async () => {
    const r = await POST(signedRequest(recallStatusBody('bot.done', 'done')));
    expect(r.status).toBe(200);
    expect(fakes.fakeUpdateStatus).toHaveBeenCalledWith(
      'meeting-1',
      'processing',
      expect.any(Object),
    );
    expect(fakes.fakeEnqueueFinalize).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      teamId: TEAM_ID,
    });
  });

  it('failed lifecycle codes do not enqueue finalize even on completion-shaped events', async () => {
    const r = await POST(
      signedRequest(recallStatusBody('bot.done', 'recording_permission_denied')),
    );
    expect(r.status).toBe(200);
    expect(fakes.fakeUpdateStatus).toHaveBeenCalledWith('meeting-1', 'failed', expect.any(Object));
    expect(fakes.fakeEnqueueFinalize).not.toHaveBeenCalled();
  });

  it('ignores backwards transition (active arriving after processing)', async () => {
    fakes.fakeLookup.mockResolvedValueOnce({
      id: 'meeting-1',
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      status: 'processing',
      platform: 'meet',
      provider: 'recall',
    });
    const r = await POST(signedRequest(statusBody('bot.status_change', 'in_call_recording')));
    expect(r.status).toBe(200);
    expect(fakes.fakeUpdateStatus).not.toHaveBeenCalled();
  });

  it('bot.fatal flips failed even from processing (terminal guard does not block IN)', async () => {
    fakes.fakeLookup.mockResolvedValueOnce({
      id: 'meeting-1',
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      status: 'processing',
      platform: 'meet',
      provider: 'recall',
    });
    const r = await POST(signedRequest(statusBody('bot.fatal', 'fatal')));
    expect(r.status).toBe(200);
    expect(fakes.fakeUpdateStatus).toHaveBeenCalledWith('meeting-1', 'failed', expect.any(Object));
  });
});

describe('POST /api/webhooks/recall/status — Redis-down retry path', () => {
  it('returns 503 BEFORE any DB write when Redis is unset and finalize needed', async () => {
    delete process.env.REDIS_URL;
    resetEnvForTests();
    const r = await POST(signedRequest(statusBody('bot.call_ended', 'call_ended')));
    expect(r.status).toBe(503);
    // Critical: status was NOT flipped to processing. Recall's retry will
    // re-enter the branch cleanly with status still 'active'.
    expect(fakes.fakeUpdateStatus).not.toHaveBeenCalled();
    expect(fakes.fakeEnqueueFinalize).not.toHaveBeenCalled();
  });

  it('non-finalize events still process when Redis is unset', async () => {
    delete process.env.REDIS_URL;
    resetEnvForTests();
    // Meeting at 'pending' so 'joining' is a forward transition.
    fakes.fakeLookup.mockResolvedValueOnce({
      id: 'meeting-1',
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      status: 'pending',
      platform: 'meet',
      provider: 'recall',
    });
    // A bot.status_change with code=joining_call doesn't trigger finalize.
    const r = await POST(signedRequest(statusBody('bot.status_change', 'joining_call')));
    expect(r.status).toBe(200);
    expect(fakes.fakeUpdateStatus).toHaveBeenCalledWith('meeting-1', 'joining', expect.any(Object));
  });
});
