import { loadEnvFile } from 'node:process';

import { PGlite } from '@electric-sql/pglite';
import { rawEvents, reconciliationEvidence, teamMembers, teams, users } from '@timeline/db';
import { resetEnvForTests } from '@timeline/shared/env';
import {
  buildSpeechTranscriptionCanaryMp3,
  isExpectedSpeechTranscriptionCanaryText,
} from '@timeline/shared/integrations';
import { transcribeAudio } from '@timeline/shared/llm';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyDbMigrations } from '#src/test/pglite.js';
import { processTranscribeJobForTests, type TranscribeWorkerIO } from '#src/workers/transcribe.js';

if (process.env.TRANSCRIBE_LIVE_ENV_FILE) {
  loadEnvFile(process.env.TRANSCRIBE_LIVE_ENV_FILE);
  resetEnvForTests();
}

const maybeDescribe = process.env.TRANSCRIBE_LIVE_EVAL === '1' ? describe : describe.skip;

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RAW_EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const AUDIO_KEY = `teams/${TEAM_ID}/telegram/live-transcribe-canary.mp3`;

type Db = ReturnType<typeof drizzle>;

maybeDescribe('live transcribe worker evals', () => {
  let pg: PGlite;
  let db: Db;

  beforeEach(async () => {
    requireLiveEnv();
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await seedLiveTranscribeEval(db);
  }, 60_000);

  afterEach(async () => {
    await pg.close();
  });

  it('finalizes a raw audio event through the real transcription model', async () => {
    const audio = buildSpeechTranscriptionCanaryMp3();
    const enqueueExtract = vi.fn().mockResolvedValue(undefined);
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const enqueueSuggestion = vi.fn().mockResolvedValue(undefined);
    const io: TranscribeWorkerIO = {
      headObject: vi.fn().mockResolvedValue({ contentLength: audio.byteLength }),
      getObjectBuffer: vi.fn().mockResolvedValue({ body: audio }),
      transcribeAudio,
      splitAudio: vi.fn().mockResolvedValue([audio]),
      enqueueExtract,
      enqueueEmbed,
      enqueueSuggestion,
    };

    const result = await processTranscribeJobForTests(
      { db: db as never },
      { rawEventId: RAW_EVENT_ID, teamId: TEAM_ID, audioKey: AUDIO_KEY },
      io,
    );

    expect(result.model).toBe('openai/gpt-4o-transcribe');
    const [event] = await db.select().from(rawEvents).where(eq(rawEvents.id, RAW_EVENT_ID));
    expect(event?.contentText).toEqual(expect.any(String));
    expect(isExpectedSpeechTranscriptionCanaryText(event?.contentText ?? '')).toBe(true);
    expect(event?.sourceMetadata).toMatchObject({
      transcription_model: 'openai/gpt-4o-transcribe',
      source_payload_ref: `s3://timeline-audio/${AUDIO_KEY}`,
      source_snapshot_kind: 'transcribed_audio_event',
      source_snapshot_version: 'transcribe-source-snapshot-2026-06',
      source_snapshot: {
        audio_key: AUDIO_KEY,
        transcription_model: 'openai/gpt-4o-transcribe',
        transcription_language: 'en',
        transcript_text: event?.contentText,
      },
    });
    expect(event?.sourceMetadata).toHaveProperty('payload_digest');
    expect(event?.sourceMetadata).not.toHaveProperty('source_payload_digest');
    expect(event?.sourceMetadata).toHaveProperty('transcribed_at');
    expect(event?.sourceMetadata).not.toHaveProperty('transcription_failed_at');
    expect(event?.sourceMetadata).not.toHaveProperty('transcription_error');

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
    expect(enqueueExtract).toHaveBeenCalledWith({ rawEventId: RAW_EVENT_ID, teamId: TEAM_ID });
    expect(enqueueEmbed).toHaveBeenCalledWith({ rawEventId: RAW_EVENT_ID, teamId: TEAM_ID });
    expect(enqueueSuggestion).toHaveBeenCalledWith({ rawEventId: RAW_EVENT_ID, teamId: TEAM_ID });
  }, 240_000);
});

async function seedLiveTranscribeEval(db: Db): Promise<void> {
  await db.insert(teams).values({
    id: TEAM_ID,
    slug: 'live-transcribe-eval',
    name: 'Live Transcribe Eval',
  });
  await db.insert(users).values({
    id: USER_ID,
    email: 'live-transcribe-owner@example.test',
    name: 'Live Transcribe Owner',
  });
  await db.insert(teamMembers).values({
    teamId: TEAM_ID,
    userId: USER_ID,
    role: 'owner',
  });
  await db.insert(rawEvents).values({
    id: RAW_EVENT_ID,
    teamId: TEAM_ID,
    authorUserId: USER_ID,
    source: 'telegram',
    contentText: null,
    contentAudioUrl: AUDIO_KEY,
    visibility: 'team',
    occurredAt: new Date('2026-07-02T12:00:00.000Z'),
    sourceMetadata: {
      tg_attachment_kind: 'voice',
      tg_chat_id: 42,
      tg_message_id: 99,
      tg_file_id: 'live-transcribe-canary',
      transcription_language: 'en',
    },
  });
}

function requireLiveEnv(): void {
  resetEnvForTests();
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error(
      'TRANSCRIBE_LIVE_EVAL=1 requires OPENROUTER_API_KEY or TRANSCRIBE_LIVE_ENV_FILE',
    );
  }
}
