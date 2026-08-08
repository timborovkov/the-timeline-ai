import { PGlite } from '@electric-sql/pglite';
import { conversationReviews, rawEvents, reconciliationEvidence, type Db } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { handleUpdate, type TelegramApi } from '@timeline/shared/telegram';
import { UnrecoverableError } from 'bullmq';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyDbMigrations } from '#src/test/pglite.js';
import { processSuggestionJobForTests } from '#src/workers/suggestions.js';
import {
  markTranscribeFailureForTests,
  processTranscribeJobForTests,
  transcribeWorkerInternals,
  type TranscribeWorkerIO,
} from '#src/workers/transcribe.js';

/**
 * Transcribe worker tests protect the media-to-agent handoff: audio bytes become
 * durable transcript text, then extraction, embedding, and approval suggestion
 * jobs are enqueued without needing Redis, S3, or OpenRouter in the test.
 */

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TG_USER_ROW_ID = '33333333-3333-3333-3333-333333333333';
const TG_USER_ID = 7;
const RAW_EVENT_ID = '10000000-0000-0000-0000-000000000001';
const AUDIO_KEY = `teams/${TEAM_ID}/telegram/42/10-voice-file.ogg`;

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'transcribe', 'Transcribe');
    INSERT INTO users (id, email) VALUES ('${USER_ID}', 'owner@example.test');
    INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
    INSERT INTO telegram_users (id, tg_user_id, username, user_id)
    VALUES ('${TG_USER_ROW_ID}', ${TG_USER_ID}, 'alice', '${USER_ID}');
    INSERT INTO telegram_user_teams (telegram_user_id, team_id, linked_by_user_id, is_active)
    VALUES ('${TG_USER_ROW_ID}', '${TEAM_ID}', '${USER_ID}', true);
  `);
}

async function seedAudioEvent(
  db: Db,
  id = RAW_EVENT_ID,
  sourceMetadata: Record<string, unknown> = {
    tg_attachment_kind: 'voice',
    transcription_failed_at: '2026-05-27T10:01:00.000Z',
    transcription_error: 'old failure',
  },
): Promise<void> {
  await db.insert(rawEvents).values({
    id,
    teamId: TEAM_ID,
    authorUserId: USER_ID,
    source: 'telegram',
    contentText: null,
    contentAudioUrl: AUDIO_KEY,
    visibility: 'team',
    occurredAt: new Date('2026-05-27T10:00:00.000Z'),
    sourceMetadata,
  });
}

function makeIO(overrides: Partial<TranscribeWorkerIO> = {}): TranscribeWorkerIO {
  return {
    headObject: vi.fn().mockResolvedValue({ contentLength: 11 }),
    getObjectBuffer: vi.fn().mockResolvedValue({ body: Buffer.from('audio-bytes') }),
    transcribeAudio: vi.fn().mockResolvedValue({
      text: "I'll schedule the lead meeting next Monday",
      model: 'test-whisper',
    }),
    splitAudio: vi.fn().mockResolvedValue([Buffer.from('audio-bytes')]),
    enqueueExtract: vi.fn().mockResolvedValue(undefined),
    enqueueEmbed: vi.fn().mockResolvedValue(undefined),
    enqueueSuggestion: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const fakeTg: TelegramApi = {
  sendMessage: () => Promise.resolve(),
  getChatAdministrators: () => Promise.resolve([]),
  answerCallbackQuery: () => Promise.resolve(),
  editMessageText: () => Promise.resolve(),
  getFile: () => Promise.resolve({ file_id: 'voice-file', file_path: 'voice.ogg' }),
  downloadFile: () => Promise.resolve(Buffer.from('telegram-voice')),
  setMessageReaction: () => Promise.resolve(),
  sendChatAction: () => Promise.resolve(),
};

describe('processTranscribeJobForTests', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
  }, 240_000);

  beforeEach(async () => {
    await pg.exec('TRUNCATE TABLE teams, users CASCADE;');
    await seed(pg);
  });

  afterAll(async () => {
    await pg.close();
  });

  it('writes transcript text, clears stale failure metadata, and enqueues downstream work', async () => {
    await seedAudioEvent(db as never);
    const getObjectBuffer = vi.fn().mockResolvedValue({ body: Buffer.from('audio-bytes') });
    const enqueueExtract = vi.fn().mockResolvedValue(undefined);
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const enqueueSuggestion = vi.fn().mockResolvedValue(undefined);
    const io = makeIO({ getObjectBuffer, enqueueExtract, enqueueEmbed, enqueueSuggestion });

    const result = await processTranscribeJobForTests(
      { db: db as never },
      { rawEventId: RAW_EVENT_ID, teamId: TEAM_ID, audioKey: AUDIO_KEY },
      io,
    );

    expect(result).toEqual({ rawEventId: RAW_EVENT_ID, model: 'test-whisper' });
    expect(getObjectBuffer).toHaveBeenCalledWith({
      audioKey: AUDIO_KEY,
      maxBytes: 200 * 1024 * 1024,
    });
    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, RAW_EVENT_ID)))[0];
    expect(row?.contentText).toBe("I'll schedule the lead meeting next Monday");
    const metadata = row?.sourceMetadata as Record<string, unknown> | undefined;
    expect(metadata).toMatchObject({
      transcription_model: 'test-whisper',
      source_payload_ref: `s3://timeline-audio/${AUDIO_KEY}`,
      source_snapshot_kind: 'transcribed_audio_event',
      source_snapshot_version: 'transcribe-source-snapshot-2026-06',
      source_snapshot: {
        audio_key: AUDIO_KEY,
        transcription_model: 'test-whisper',
        transcript_text: "I'll schedule the lead meeting next Monday",
        note_text: null,
      },
    });
    expect(metadata).toHaveProperty('payload_digest');
    expect(String(metadata?.payload_digest)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(metadata).not.toHaveProperty('source_payload_digest');
    expect(metadata).toHaveProperty('transcribed_at');
    expect(metadata).not.toHaveProperty('transcription_failed_at');
    expect(metadata).not.toHaveProperty('transcription_error');
    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, RAW_EVENT_ID));
    expect(evidence).toMatchObject({
      teamId: TEAM_ID,
      rawEventId: RAW_EVENT_ID,
      source: 'telegram',
      provider: 'telegram',
      eventType: 'telegram.voice',
      replayState: 'full',
      sourcePayloadRef: `s3://timeline-audio/${AUDIO_KEY}`,
      visibility: 'team',
    });
    expect(evidence?.payloadDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(enqueueExtract).toHaveBeenCalledWith({
      rawEventId: RAW_EVENT_ID,
      teamId: TEAM_ID,
    });
    expect(enqueueEmbed).toHaveBeenCalledWith({
      rawEventId: RAW_EVENT_ID,
      teamId: TEAM_ID,
    });
    expect(enqueueSuggestion).toHaveBeenCalledWith({
      rawEventId: RAW_EVENT_ID,
      teamId: TEAM_ID,
    });
  });

  it('preserves typed audio-note context when transcription backfills the row', async () => {
    await seedAudioEvent(db as never, RAW_EVENT_ID, {
      audio_note_text: "Today's Nexia meetings voice recording",
    });

    await processTranscribeJobForTests(
      { db: db as never },
      { rawEventId: RAW_EVENT_ID, teamId: TEAM_ID, audioKey: AUDIO_KEY },
      makeIO(),
    );

    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, RAW_EVENT_ID)))[0];
    expect(row?.contentText).toBe(
      "Today's Nexia meetings voice recording\n\nI'll schedule the lead meeting next Monday",
    );
    expect(row?.sourceMetadata).toMatchObject({
      audio_note_text: "Today's Nexia meetings voice recording",
      transcription_model: 'test-whisper',
    });
  });

  it('preserves existing camelCase source payload refs when transcription backfills the row', async () => {
    await seedAudioEvent(db as never, RAW_EVENT_ID, {
      sourcePayloadRef: 's3://timeline-audio/existing/camel-case-ref.ogg',
    });

    await processTranscribeJobForTests(
      { db: db as never },
      { rawEventId: RAW_EVENT_ID, teamId: TEAM_ID, audioKey: AUDIO_KEY },
      makeIO(),
    );

    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, RAW_EVENT_ID)))[0];
    expect(row?.sourceMetadata).toMatchObject({
      source_payload_ref: 's3://timeline-audio/existing/camel-case-ref.ogg',
    });
    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, RAW_EVENT_ID));
    expect(evidence?.sourcePayloadRef).toBe('s3://timeline-audio/existing/camel-case-ref.ogg');
  });

  it('passes a valid source metadata language hint to transcription', async () => {
    await seedAudioEvent(db as never, RAW_EVENT_ID, {
      transcription_language: 'EN',
    });
    const transcribeAudio = vi.fn<TranscribeWorkerIO['transcribeAudio']>().mockResolvedValue({
      text: 'Timeline Canary task',
      model: 'test-whisper',
    });

    await processTranscribeJobForTests(
      { db: db as never },
      { rawEventId: RAW_EVENT_ID, teamId: TEAM_ID, audioKey: AUDIO_KEY },
      makeIO({ transcribeAudio }),
    );

    expect(transcribeAudio).toHaveBeenCalledWith({
      audio: Buffer.from('audio-bytes'),
      format: 'ogg',
      language: 'en',
    });
    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, RAW_EVENT_ID)))[0];
    expect(row?.sourceMetadata).toMatchObject({
      source_snapshot: {
        transcription_language: 'en',
      },
    });
  });

  it('completes a missing row without enqueueing downstream work', async () => {
    const enqueueExtract = vi.fn().mockResolvedValue(undefined);
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const enqueueSuggestion = vi.fn().mockResolvedValue(undefined);
    const io = makeIO({ enqueueExtract, enqueueEmbed, enqueueSuggestion });

    const result = await processTranscribeJobForTests(
      { db: db as never },
      { rawEventId: RAW_EVENT_ID, teamId: TEAM_ID, audioKey: AUDIO_KEY },
      io,
    );

    expect(result).toEqual({ rawEventId: RAW_EVENT_ID, model: 'test-whisper' });
    expect(enqueueExtract).not.toHaveBeenCalled();
    expect(enqueueEmbed).not.toHaveBeenCalled();
    expect(enqueueSuggestion).not.toHaveBeenCalled();
  });

  it('splits large source audio before transcribing provider-sized chunks', async () => {
    await seedAudioEvent(db as never);
    const splitAudio = vi
      .fn<TranscribeWorkerIO['splitAudio']>()
      .mockResolvedValue([Buffer.from('chunk-one'), Buffer.from('chunk-two')]);
    const transcribeAudio = vi
      .fn()
      .mockResolvedValueOnce({ text: 'First part.', model: 'test-whisper' })
      .mockResolvedValueOnce({ text: 'Second part.', model: 'test-whisper' });
    const io = makeIO({
      headObject: vi.fn().mockResolvedValue({ contentLength: 30_462_530 }),
      getObjectBuffer: vi.fn().mockResolvedValue({ body: Buffer.alloc(30_462_530) }),
      splitAudio,
      transcribeAudio,
    });

    const result = await processTranscribeJobForTests(
      { db: db as never },
      { rawEventId: RAW_EVENT_ID, teamId: TEAM_ID, audioKey: AUDIO_KEY },
      io,
    );

    expect(result).toEqual({ rawEventId: RAW_EVENT_ID, model: 'test-whisper' });
    const splitInput = splitAudio.mock.calls[0]?.[0];
    expect(splitInput?.audioKey).toBe(AUDIO_KEY);
    expect(splitInput?.audio).toBeInstanceOf(Buffer);
    expect(transcribeAudio).toHaveBeenNthCalledWith(1, {
      audio: Buffer.from('chunk-one'),
      format: 'mp3',
    });
    expect(transcribeAudio).toHaveBeenNthCalledWith(2, {
      audio: Buffer.from('chunk-two'),
      format: 'mp3',
    });
    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, RAW_EVENT_ID)))[0];
    expect(row?.contentText).toBe('First part.\n\nSecond part.');
  });

  it('treats missing content length and truly oversize source audio as unrecoverable', async () => {
    await seedAudioEvent(db as never);
    await expect(
      processTranscribeJobForTests(
        { db: db as never },
        { rawEventId: RAW_EVENT_ID, teamId: TEAM_ID, audioKey: AUDIO_KEY },
        makeIO({ headObject: vi.fn().mockResolvedValue({}) }),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    await expect(
      processTranscribeJobForTests(
        { db: db as never },
        { rawEventId: RAW_EVENT_ID, teamId: TEAM_ID, audioKey: AUDIO_KEY },
        makeIO({
          headObject: vi.fn().mockResolvedValue({ contentLength: 200 * 1024 * 1024 + 1 }),
        }),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('marks downstream enqueue failures while keeping the transcript durable', async () => {
    await seedAudioEvent(db as never);
    const io = makeIO({
      enqueueExtract: vi.fn().mockRejectedValue(new Error('redis extract down')),
      enqueueEmbed: vi.fn().mockRejectedValue(new Error('redis embed down')),
      enqueueSuggestion: vi.fn().mockRejectedValue(new Error('redis suggestions down')),
    });

    await processTranscribeJobForTests(
      { db: db as never },
      { rawEventId: RAW_EVENT_ID, teamId: TEAM_ID, audioKey: AUDIO_KEY },
      io,
    );

    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, RAW_EVENT_ID)))[0];
    expect(row?.contentText).toBe("I'll schedule the lead meeting next Monday");
    expect(row?.sourceMetadata).toMatchObject({
      extraction_error: 'enqueue failed: redis extract down',
      embedding_error: 'enqueue failed: redis embed down',
      suggestions_error: 'enqueue failed: redis suggestions down',
    });
    expect(row?.sourceMetadata).toHaveProperty('extraction_failed_at');
    expect(row?.sourceMetadata).toHaveProperty('embedding_failed_at');
    expect(row?.sourceMetadata).toHaveProperty('suggestions_failed_at');
  });

  it('marks permanent transcription failures with bounded metadata', async () => {
    await seedAudioEvent(db as never);

    await markTranscribeFailureForTests(
      { db: db as never },
      { rawEventId: RAW_EVENT_ID },
      new Error(`provider failed ${'x'.repeat(700)}`),
    );

    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, RAW_EVENT_ID)))[0];
    expect(row?.contentText).toBeNull();
    const meta = row?.sourceMetadata as Record<string, unknown>;
    expect(meta.transcription_failed_at).toEqual(expect.any(String));
    expect(String(meta.transcription_error)).toHaveLength(500);
  });

  it('marks transcription failures only after retry exhaustion or unrecoverable errors', () => {
    expect(
      transcribeWorkerInternals.shouldMarkPermanentTranscribeFailure({
        err: new Error('OpenRouter 503 temporarily unavailable'),
        attemptsMade: 1,
        maxAttempts: 3,
      }),
    ).toBe(false);
    expect(
      transcribeWorkerInternals.shouldMarkPermanentTranscribeFailure({
        err: new Error('OpenRouter 503 temporarily unavailable'),
        attemptsMade: 3,
        maxAttempts: 3,
      }),
    ).toBe(true);
    expect(
      transcribeWorkerInternals.shouldMarkPermanentTranscribeFailure({
        err: new UnrecoverableError('audio object is too large'),
        attemptsMade: 1,
        maxAttempts: 3,
      }),
    ).toBe(true);
  });

  it('turns a Telegram voice memo into a transcript-backed approval suggestion', async () => {
    const uploaded = new Map<string, Buffer>();
    const transcribeJobs: { rawEventId: string; teamId: string; audioKey: string }[] = [];

    await handleUpdate(
      {
        db: db as never,
        tg: fakeTg,
        audio: {
          upload: (input) => {
            uploaded.set(input.key, Buffer.from(input.body));
            return Promise.resolve();
          },
          enqueueTranscribe: (input) => {
            transcribeJobs.push(input);
            return Promise.resolve();
          },
          buildAudioKey: ({ teamId, chatId, messageId, fileId, extension }) =>
            `teams/${teamId}/telegram/${chatId}/${messageId}-${fileId}.${extension}`,
        },
      },
      {
        update_id: 500,
        message: {
          message_id: 50,
          date: 1770000000,
          chat: { id: 42, type: 'private' },
          from: { id: TG_USER_ID, username: 'alice' },
          caption: 'lead follow-up',
          voice: { file_id: 'voice-file', duration: 5, mime_type: 'audio/ogg', file_size: 14 },
        },
      },
    );

    expect(transcribeJobs).toHaveLength(1);
    const job = transcribeJobs[0];
    if (!job) throw new Error('expected transcribe job');
    expect(job.teamId).toBe(TEAM_ID);
    expect(job.audioKey).toContain('voice-file.ogg');
    expect(uploaded.get(job.audioKey)).toEqual(Buffer.from('telegram-voice'));

    const initial = (await db.select().from(rawEvents).where(eq(rawEvents.id, job.rawEventId)))[0];
    expect(initial).toMatchObject({
      source: 'telegram',
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      contentText: null,
      contentAudioUrl: job.audioKey,
    });
    expect(initial?.sourceMetadata).toMatchObject({
      tg_caption: 'lead follow-up',
      tg_file_id: 'voice-file',
    });

    const enqueueExtract = vi.fn().mockResolvedValue(undefined);
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const enqueueSuggestion = vi.fn().mockResolvedValue(undefined);
    await processTranscribeJobForTests(
      { db: db as never },
      job,
      makeIO({
        headObject: vi.fn().mockResolvedValue({ contentLength: 14 }),
        getObjectBuffer: vi.fn().mockResolvedValue({ body: uploaded.get(job.audioKey) }),
        transcribeAudio: vi.fn().mockResolvedValue({
          text: "I'll schedule the lead meeting next Monday",
          model: 'test-whisper',
        }),
        enqueueExtract,
        enqueueEmbed,
        enqueueSuggestion,
      }),
    );

    const transcribed = (
      await db.select().from(rawEvents).where(eq(rawEvents.id, job.rawEventId))
    )[0];
    expect(transcribed?.contentText).toBe("I'll schedule the lead meeting next Monday");
    expect(transcribed?.sourceMetadata).toMatchObject({ transcription_model: 'test-whisper' });
    expect(enqueueExtract).toHaveBeenCalledWith({ rawEventId: job.rawEventId, teamId: TEAM_ID });
    expect(enqueueEmbed).toHaveBeenCalledWith({ rawEventId: job.rawEventId, teamId: TEAM_ID });
    expect(enqueueSuggestion).toHaveBeenCalledWith({
      rawEventId: job.rawEventId,
      teamId: TEAM_ID,
    });

    const enqueueConversationReview = vi.fn().mockResolvedValue(undefined);
    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: job.rawEventId, teamId: TEAM_ID },
      {
        getEnv: () => ({ OPENROUTER_API_KEY: 'test-key' }) as never,
        chatStructured: vi.fn().mockResolvedValue({ object: { bundles: [] }, model: 'e2e' }),
        modelId: 'telegram-media-test',
        enqueueSuggestionJob: enqueueConversationReview,
      },
    );
    const [review] = await db.select().from(conversationReviews);
    expect(review?.lastRawEventId).toBe(job.rawEventId);
    const reviewId = review?.id;
    if (!reviewId) throw new Error('expected conversation review');
    await db
      .update(conversationReviews)
      .set({ quietUntil: new Date('2026-05-27T09:00:00.000Z') })
      .where(eq(conversationReviews.id, reviewId));

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      {
        getEnv: () => ({ OPENROUTER_API_KEY: 'test-key' }) as never,
        chatStructured: vi.fn().mockResolvedValue({
          object: {
            bundles: [
              {
                title: 'Schedule lead meeting',
                summary: 'The voice memo commits to scheduling the lead meeting.',
                reason: 'The conversation evidence contains an explicit commitment.',
                confidence: 'medium',
                quote: "I'll schedule the lead meeting next Monday",
                items: [
                  {
                    operation: 'create',
                    targetKind: 'task',
                    title: 'Schedule lead meeting',
                    proposedPayload: {
                      canonicalName: 'Schedule lead meeting',
                      dueAt: '2026-06-01T00:00:00.000Z',
                    },
                  },
                  {
                    operation: 'create',
                    targetKind: 'calendar_event',
                    title: 'Schedule lead meeting',
                    proposedPayload: {
                      title: 'Schedule lead meeting',
                      startAt: '2026-06-01T00:00:00.000Z',
                      endAt: '2026-06-02T00:00:00.000Z',
                      startDate: '2026-06-01',
                      endDate: '2026-06-02',
                      timezone: 'UTC',
                      allDay: true,
                      visibility: 'team',
                    },
                  },
                ],
              },
            ],
          },
          model: 'e2e',
        }),
        modelId: 'telegram-media-test',
      },
    );

    const bundles = await withTeam(
      db as never,
      TEAM_ID,
      USER_ID,
    ).suggestions.listPendingSuggestions();
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.evidence[0]).toMatchObject({
      rawEventId: job.rawEventId,
      quote: "I'll schedule the lead meeting next Monday",
    });
    expect(bundles[0]?.items.map((item) => item.targetKind).sort()).toEqual([
      'calendar_event',
      'task',
    ]);
  });
});
