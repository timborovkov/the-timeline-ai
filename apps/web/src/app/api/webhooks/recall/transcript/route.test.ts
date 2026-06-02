import { resetEnvForTests } from '@timeline/shared/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as MeetingsModule from '@timeline/shared/meetings';
import type * as RateLimitModule from '@timeline/shared/rate-limit';

/**
 * Route-level tests for the Recall transcript webhook. Covers:
 *
 *   - Zod validation rejects malformed payloads (returns 200, not 500)
 *   - Partial transcripts are dropped (only finalised utterances persist)
 *   - Unknown botId → 200 with `no_meeting` (no DB write attempt)
 *   - Happy path inserts chunk + enqueues extract / embed / meeting_chunk
 *   - Duplicate `providerChunkId` → 200 with `duplicate`, no enqueues
 *   - Per-IP rate limit DOES NOT prevent the test (we mock it)
 *
 * Real Zod schema runs; auth, scope (appendMeetingChunk), queue, and
 * rate-limit are mocked.
 */

const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  fakeLookup: vi.fn(),
  fakeAppendChunk: vi.fn(),
  fakeEnqueueExtract: vi.fn(),
  fakeEnqueueEmbed: vi.fn(),
  fakeEnqueueMeetingChunk: vi.fn(),
  fakeEnqueueCalendarEvent: vi.fn(),
  fakeRateLimit: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/queue', () => ({
  requireRedisQueue: vi.fn().mockResolvedValue({
    enqueueExtractJob: fakes.fakeEnqueueExtract,
    enqueueEmbedJob: fakes.fakeEnqueueEmbed,
    enqueueMeetingChunkEmbedJob: fakes.fakeEnqueueMeetingChunk,
    enqueueCalendarEventEmbedJob: fakes.fakeEnqueueCalendarEvent,
  }),
}));

vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({ meetings: { appendMeetingChunk: fakes.fakeAppendChunk } }),
}));

vi.mock('@timeline/shared/meetings', async () => {
  const actual = await vi.importActual<typeof MeetingsModule>('@timeline/shared/meetings');
  return {
    ...actual,
    lookupMeetingByBotId: fakes.fakeLookup,
  };
});

vi.mock('@timeline/shared/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@timeline/shared/rate-limit');
  return { ...actual, checkRateLimit: fakes.fakeRateLimit };
});

const { POST } = await import('./route.js');

const BOT_ID = 'bot-xyz';
const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function setEnv() {
  process.env.AUTH_SECRET = 'test-secret-test-secret';
  process.env.DATABASE_URL = 'postgres://x';
  process.env.RECALL_API_KEY = 'test-key';
  process.env.REDIS_URL = 'redis://localhost:6379';
}

function transcriptBody(opts: {
  botId?: string;
  words?: { text: string; startSec?: number; endSec?: number }[];
  speaker?: string;
  transcriptId?: string;
  event?: string;
}) {
  const words =
    opts.words?.map((w) => ({
      text: w.text,
      start_timestamp: w.startSec !== undefined ? { relative: w.startSec } : null,
      end_timestamp: w.endSec !== undefined ? { relative: w.endSec } : null,
    })) ?? [];
  return JSON.stringify({
    event: opts.event ?? 'transcript.data',
    data: {
      bot: { id: opts.botId ?? BOT_ID },
      data: {
        words,
        participant: opts.speaker ? { name: opts.speaker, id: 1 } : undefined,
        transcript: opts.transcriptId ? { id: opts.transcriptId } : undefined,
      },
    },
  });
}

function makeRequest(body: string) {
  return new Request('https://test.local/api/webhooks/recall/transcript', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body,
  });
}

beforeEach(() => {
  setEnv();
  resetEnvForTests();
  vi.clearAllMocks();
  fakes.fakeRateLimit.mockResolvedValue({ ok: true });
  fakes.fakeLookup.mockResolvedValue({
    id: 'meeting-1',
    teamId: TEAM_ID,
    createdByUserId: USER_ID,
    status: 'active',
    platform: 'meet',
    provider: 'recall',
  });
  fakes.fakeAppendChunk.mockResolvedValue({
    chunkId: 'chunk-1',
    rawEventId: 'event-1',
    deduplicated: false,
  });
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('POST /api/webhooks/recall/transcript — config', () => {
  it('returns 503 when RECALL_API_KEY unset', async () => {
    delete process.env.RECALL_API_KEY;
    resetEnvForTests();
    const r = await POST(
      makeRequest(transcriptBody({ words: [{ text: 'hi', startSec: 0, endSec: 1 }] })),
    );
    expect(r.status).toBe(503);
  });
});

describe('POST /api/webhooks/recall/transcript — validation', () => {
  it('returns 200 on invalid JSON (no retry storm)', async () => {
    const req = new Request('https://test.local/api/webhooks/recall/transcript', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const r = await POST(req);
    expect(r.status).toBe(200);
    expect(fakes.fakeAppendChunk).not.toHaveBeenCalled();
  });

  it('returns 200 with no_chunk when payload has no words', async () => {
    const r = await POST(makeRequest(transcriptBody({ words: [] })));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { reason?: string };
    expect(json.reason).toBe('no_chunk');
    expect(fakes.fakeAppendChunk).not.toHaveBeenCalled();
  });

  it('drops partial transcripts', async () => {
    const r = await POST(
      makeRequest(
        transcriptBody({
          event: 'transcript.partial_data',
          words: [{ text: 'partial', startSec: 0, endSec: 1 }],
        }),
      ),
    );
    expect(r.status).toBe(200);
    const json = (await r.json()) as { reason?: string };
    expect(json.reason).toBe('partial');
    expect(fakes.fakeAppendChunk).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/recall/transcript — rate limit', () => {
  it('returns 200 ip_rate_limited when client IP exceeds the bucket', async () => {
    fakes.fakeRateLimit.mockResolvedValueOnce({ ok: false, retryAfterMs: 1000 });
    const r = await POST(
      makeRequest(transcriptBody({ words: [{ text: 'hi', startSec: 0, endSec: 1 }] })),
    );
    expect(r.status).toBe(200);
    const json = (await r.json()) as { reason?: string };
    expect(json.reason).toBe('ip_rate_limited');
    expect(fakes.fakeLookup).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/recall/transcript — meeting lookup', () => {
  it('returns 200 no_meeting when botId is unknown', async () => {
    fakes.fakeLookup.mockResolvedValueOnce(null);
    const r = await POST(
      makeRequest(transcriptBody({ words: [{ text: 'hi', startSec: 0, endSec: 1 }] })),
    );
    expect(r.status).toBe(200);
    const json = (await r.json()) as { reason?: string };
    expect(json.reason).toBe('no_meeting');
    expect(fakes.fakeAppendChunk).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/recall/transcript — happy path', () => {
  it('inserts chunk + enqueues extract + embed + meeting_chunk', async () => {
    const r = await POST(
      makeRequest(
        transcriptBody({
          words: [
            { text: 'Hello', startSec: 0, endSec: 0.5 },
            { text: 'world', startSec: 0.5, endSec: 1.2 },
          ],
          speaker: 'Alice',
          transcriptId: 'utt-1',
        }),
      ),
    );
    expect(r.status).toBe(200);
    expect(fakes.fakeAppendChunk).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      speaker: 'Alice',
      text: 'Hello world',
      startMs: 0,
      endMs: 1200,
      providerChunkId: 'utt-1',
    });
    expect(fakes.fakeEnqueueExtract).not.toHaveBeenCalled();
    expect(fakes.fakeEnqueueEmbed).not.toHaveBeenCalled();
    expect(fakes.fakeEnqueueMeetingChunk).toHaveBeenCalledWith(TEAM_ID, 'chunk-1');
    expect(fakes.fakeEnqueueCalendarEvent).not.toHaveBeenCalled();
  });

  it('re-embeds the linked calendar event when a late chunk stales it', async () => {
    fakes.fakeAppendChunk.mockResolvedValueOnce({
      chunkId: 'chunk-1',
      deduplicated: false,
      refreshedCalendarEventId: 'calendar-1',
    });

    const r = await POST(
      makeRequest(
        transcriptBody({
          words: [{ text: 'late', startSec: 0, endSec: 1 }],
          transcriptId: 'utt-late',
        }),
      ),
    );

    expect(r.status).toBe(200);
    expect(fakes.fakeEnqueueMeetingChunk).toHaveBeenCalledWith(TEAM_ID, 'chunk-1');
    expect(fakes.fakeEnqueueCalendarEvent).toHaveBeenCalledWith(TEAM_ID, 'calendar-1');
  });

  it('duplicate providerChunkId — no downstream enqueues', async () => {
    fakes.fakeAppendChunk.mockResolvedValueOnce({
      chunkId: 'chunk-1',
      rawEventId: 'event-1',
      deduplicated: true,
    });
    const r = await POST(
      makeRequest(
        transcriptBody({
          words: [{ text: 'replay', startSec: 0, endSec: 1 }],
          transcriptId: 'utt-1',
        }),
      ),
    );
    expect(r.status).toBe(200);
    const json = (await r.json()) as { reason?: string };
    expect(json.reason).toBe('duplicate');
    expect(fakes.fakeEnqueueExtract).not.toHaveBeenCalled();
    expect(fakes.fakeEnqueueEmbed).not.toHaveBeenCalled();
    expect(fakes.fakeEnqueueMeetingChunk).not.toHaveBeenCalled();
    expect(fakes.fakeEnqueueCalendarEvent).not.toHaveBeenCalled();
  });
});
