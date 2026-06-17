import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAudioEventAction,
  createTextEventAction,
  requestAudioUploadAction,
} from '@/app/actions/events';

/**
 * Server-action tests for event capture. The shared timeline scope owns the
 * real DB behavior; these tests pin the action contract around auth, schema
 * validation, upload-key ownership, queue degradation, cache invalidation, and
 * warnings returned to the UI.
 */

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeRequireMembership: vi.fn(),
  fakeCreateEvent: vi.fn(),
  fakeSafeMarkOnboardingStep: vi.fn(),
  fakeDeleteCacheKey: vi.fn(),
  fakeGetSignedPutObjectUrl: vi.fn(),
  fakeRevalidatePath: vi.fn(),
  fakeEnqueueExtractJob: vi.fn(),
  fakeEnqueueEmbedJob: vi.fn(),
  fakeEnqueueSuggestionJob: vi.fn(),
  fakeEnqueueTranscribeJob: vi.fn(),
  fakeDbUpdate: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/onboarding', () => ({ safeMarkOnboardingStep: fakes.fakeSafeMarkOnboardingStep }));
vi.mock('@/lib/queue', () => ({
  requireRedisQueue: vi.fn().mockResolvedValue({
    enqueueExtractJob: fakes.fakeEnqueueExtractJob,
    enqueueEmbedJob: fakes.fakeEnqueueEmbedJob,
    enqueueSuggestionJob: fakes.fakeEnqueueSuggestionJob,
    enqueueTranscribeJob: fakes.fakeEnqueueTranscribeJob,
  }),
}));
vi.mock('@/lib/db', () => ({ db: { update: fakes.fakeDbUpdate } }));
vi.mock('next/cache', () => ({ revalidatePath: fakes.fakeRevalidatePath }));
vi.mock('@timeline/shared/cache', () => ({
  cacheKey: (parts: string[]) => parts.join(':'),
  deleteCacheKey: fakes.fakeDeleteCacheKey,
}));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));
vi.mock('@timeline/shared/s3', () => ({
  getAudioBucket: () => 'audio-test',
  getS3PresignClient: () => ({}),
  getSignedPutObjectUrl: fakes.fakeGetSignedPutObjectUrl,
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.fakeRequireMembership,
    timeline: {
      createEvent: fakes.fakeCreateEvent,
      removeConversationalMessage: vi.fn(),
    },
  }),
}));

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const RAW_EVENT_ID = '33333333-3333-3333-3333-333333333333';

function form(values: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) fd.append(key, item);
  }
  return fd;
}

function mockDbUpdateSuccess(): void {
  fakes.fakeDbUpdate.mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.fakeResolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.fakeRequireMembership.mockResolvedValue('member');
  fakes.fakeCreateEvent.mockResolvedValue({ id: RAW_EVENT_ID, teamId: TEAM_ID });
  fakes.fakeGetSignedPutObjectUrl.mockResolvedValue('https://rustfs.test/signed-audio');
  fakes.fakeEnqueueExtractJob.mockResolvedValue(undefined);
  fakes.fakeEnqueueEmbedJob.mockResolvedValue(undefined);
  fakes.fakeEnqueueSuggestionJob.mockResolvedValue(undefined);
  fakes.fakeEnqueueTranscribeJob.mockResolvedValue(undefined);
  fakes.fakeDeleteCacheKey.mockResolvedValue(undefined);
  fakes.fakeSafeMarkOnboardingStep.mockResolvedValue(undefined);
  mockDbUpdateSuccess();
});

describe('createTextEventAction', () => {
  it('requires a signed-in user and active team before touching scope', async () => {
    fakes.fakeAuth.mockResolvedValue(null);

    await expect(createTextEventAction({}, form({ text: 'hello' }))).resolves.toEqual({
      error: 'Not signed in',
    });
    expect(fakes.fakeCreateEvent).not.toHaveBeenCalled();

    fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });
    await expect(createTextEventAction({}, form({ text: 'hello' }))).resolves.toEqual({
      error: 'No active team',
    });
    expect(fakes.fakeCreateEvent).not.toHaveBeenCalled();
  });

  it('takes the last visibility form value so the checkbox can override the hidden default', async () => {
    const result = await createTextEventAction(
      {},
      form({ text: 'Private note', visibility: ['team', 'private'] }),
    );

    expect(result.ok).toBe(true);
    expect(fakes.fakeCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        contentText: 'Private note',
        visibility: 'private',
        visibilityOwnerUserId: USER_ID,
      }),
    );
    expect(fakes.fakeEnqueueExtractJob).toHaveBeenCalledWith({
      rawEventId: RAW_EVENT_ID,
      teamId: TEAM_ID,
    });
    expect(fakes.fakeEnqueueEmbedJob).toHaveBeenCalledWith({
      rawEventId: RAW_EVENT_ID,
      teamId: TEAM_ID,
    });
    expect(fakes.fakeEnqueueSuggestionJob).toHaveBeenCalledWith({
      rawEventId: RAW_EVENT_ID,
      teamId: TEAM_ID,
    });
    expect(fakes.fakeSafeMarkOnboardingStep).toHaveBeenCalledWith(expect.anything(), 'first_note');
    expect(fakes.fakeDeleteCacheKey).toHaveBeenCalledWith(`onboarding:${TEAM_ID}:${USER_ID}`);
  });

  it('returns ok with a durable warning when queue handoff fails after the row commits', async () => {
    fakes.fakeEnqueueExtractJob.mockRejectedValue(new Error('redis down'));
    fakes.fakeEnqueueEmbedJob.mockRejectedValue(new Error('redis down'));
    fakes.fakeEnqueueSuggestionJob.mockRejectedValue(new Error('redis down'));

    const result = await createTextEventAction({}, form({ text: 'Still save this' }));

    expect(result.ok).toBe(true);
    expect(result.warning).toContain(
      'structured extraction and semantic search need attention before structured facts and search are fully available.',
    );
    expect(result.warning).toContain(
      'Approval suggestions need attention before approvals can be proposed.',
    );
    expect(result.warning).not.toContain(
      'approval suggestions need attention before this is fully searchable',
    );
    expect(fakes.fakeDbUpdate).toHaveBeenCalledTimes(3);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/timeline');
  });
});

describe('audio event actions', () => {
  it('requestAudioUploadAction validates MIME type before signing and returns a user-scoped key', async () => {
    await expect(requestAudioUploadAction('text/plain')).resolves.toEqual({
      ok: false,
      error: 'Invalid audio type',
    });
    expect(fakes.fakeGetSignedPutObjectUrl).not.toHaveBeenCalled();

    const result = await requestAudioUploadAction('audio/webm');

    expect(result).toMatchObject({
      ok: true,
      url: 'https://rustfs.test/signed-audio',
      contentType: 'audio/webm',
    });
    expect(result.key).toMatch(new RegExp(`^teams/${TEAM_ID}/web/${USER_ID}/.+\\.webm$`));
    expect(fakes.fakeGetSignedPutObjectUrl).toHaveBeenCalledWith(
      expect.anything(),
      'audio-test',
      result.key,
      'audio/webm',
    );
  });

  it('createAudioEventAction rejects upload keys outside the signed user prefix', async () => {
    const result = await createAudioEventAction({
      key: `teams/${TEAM_ID}/web/not-${USER_ID}/audio.webm`,
      mimeType: 'audio/webm',
      visibility: 'team',
    });

    expect(result).toEqual({ ok: false, error: 'Invalid upload key' });
    expect(fakes.fakeCreateEvent).not.toHaveBeenCalled();
  });

  it('createAudioEventAction saves the row and warns when transcription enqueue fails', async () => {
    fakes.fakeEnqueueTranscribeJob.mockRejectedValue(new Error('redis down'));
    const key = `teams/${TEAM_ID}/web/${USER_ID}/audio.webm`;

    const result = await createAudioEventAction({
      key,
      mimeType: 'audio/webm',
      durationSec: 12,
      visibility: 'private',
    });

    expect(result.ok).toBe(true);
    expect(result.warning).toContain('Transcription queue is unreachable');
    expect(fakes.fakeCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        contentAudioUrl: key,
        visibility: 'private',
        sourceMetadata: { audio_mime_type: 'audio/webm', audio_duration_sec: 12 },
      }),
    );
    expect(fakes.fakeDbUpdate).toHaveBeenCalledOnce();
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/timeline');
  });

  it('createAudioEventAction stores typed note context on the audio row', async () => {
    const key = `teams/${TEAM_ID}/web/${USER_ID}/audio.webm`;

    const result = await createAudioEventAction({
      key,
      mimeType: 'audio/webm',
      noteText: "Today's Nexia meetings voice recording",
      durationSec: 12,
      visibility: 'team',
    });

    expect(result).toEqual({ ok: true });
    expect(fakes.fakeCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        contentText: "Today's Nexia meetings voice recording",
        contentAudioUrl: key,
        sourceMetadata: {
          audio_mime_type: 'audio/webm',
          audio_note_text: "Today's Nexia meetings voice recording",
          audio_duration_sec: 12,
        },
      }),
    );
    expect(fakes.fakeEnqueueTranscribeJob).toHaveBeenCalledWith({
      rawEventId: RAW_EVENT_ID,
      teamId: TEAM_ID,
      audioKey: key,
    });
  });
});
