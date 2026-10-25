import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RateLimitModule from '@timeline/shared/rate-limit';

import {
  cancelMeetingBotAction,
  scheduleMeetingBotAction,
  updateSavedMeetingAction,
} from '@/app/actions/meetings';

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeMeetings: {
    getMeetingSettings: vi.fn(),
    getCurrentMonthMinutes: vi.fn(),
    getMeeting: vi.fn(),
    cancelMeetingCapture: vi.fn(),
    confirmMeetingProviderLeave: vi.fn(),
    createMeeting: vi.fn(),
    claimMeetingForJoin: vi.fn(),
    findActiveMeetingForUrl: vi.fn(),
    updateMeetingStatus: vi.fn(),
    updateSavedMeeting: vi.fn(),
    listChunks: vi.fn(),
  },
  fakeCheckRateLimit: vi.fn(),
  fakeJoinMeeting: vi.fn(),
  fakeLeaveMeeting: vi.fn(),
  fakeRequireRedisQueue: vi.fn(),
  fakeClaimMeetingJoinUnderRecallCap: vi.fn(),
  fakeSettleElapsedRecall: vi.fn(),
  fakeReleaseRecall: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/queue', () => ({ requireRedisQueue: fakes.fakeRequireRedisQueue }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    meetings: fakes.fakeMeetings,
    timeline: { team: vi.fn(() => Promise.resolve({ name: 'Acme' })) },
    billing: {},
  }),
}));
vi.mock('@timeline/shared/meeting-bots', () => ({
  isMeetingBotConfigured: vi.fn(() => true),
  resolveTranscriptWebhookUrl: vi.fn(() => 'https://timeline.test/api/webhooks/recall/transcript'),
  meetingBotDisplayName: vi.fn((teamName: string | null | undefined) =>
    teamName ? `${teamName}'s thetimeline.cc bot` : 'Timeline',
  ),
  meetingBotErrorCode: vi.fn(() => 'provider_request_failed'),
  getMeetingBotProvider: vi.fn(() => ({
    joinMeeting: fakes.fakeJoinMeeting,
    leaveMeeting: fakes.fakeLeaveMeeting,
  })),
}));
vi.mock('@timeline/shared/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@timeline/shared/rate-limit');
  return { ...actual, checkRateLimit: fakes.fakeCheckRateLimit };
});
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock('@timeline/shared/billing', () => ({
  assertTeamConcurrentRecallCapacity: vi.fn().mockResolvedValue(undefined),
  claimMeetingJoinUnderRecallCap: fakes.fakeClaimMeetingJoinUnderRecallCap,
  isBillingAdmissionError: () => false,
  recallBillingUserMessage: (code: string) => code,
  abortRecallJoinAfterProviderAccept: vi.fn().mockResolvedValue(undefined),
  reserveRecallMeetingMinutes: vi.fn().mockResolvedValue({
    ok: true,
    operationId: 'recall:test',
    reservedMinutes: 60,
  }),
  settleElapsedRecallMeetingMinutes: fakes.fakeSettleElapsedRecall,
  releaseRecallMeetingMinutes: fakes.fakeReleaseRecall,
}));

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const MEMBER_ID = '33333333-3333-3333-3333-333333333333';
const MEETING_ID = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.fakeResolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.fakeCheckRateLimit.mockResolvedValue({ ok: true, remaining: 10 });
  fakes.fakeMeetings.getMeetingSettings.mockResolvedValue({
    requireHostConsent: true,
    meetingMinutesCap: null,
    meetingMinutesAdminOverride: false,
  });
  fakes.fakeMeetings.createMeeting.mockResolvedValue({ id: MEETING_ID });
  fakes.fakeMeetings.claimMeetingForJoin.mockResolvedValue({
    id: MEETING_ID,
    provider: 'recall',
    platform: 'meet',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
  });
  fakes.fakeMeetings.findActiveMeetingForUrl.mockResolvedValue(null);
  fakes.fakeMeetings.getMeeting.mockResolvedValue(null);
  fakes.fakeMeetings.cancelMeetingCapture.mockResolvedValue({ outcome: 'cancelled' });
  fakes.fakeMeetings.confirmMeetingProviderLeave.mockResolvedValue(true);
  fakes.fakeMeetings.updateMeetingStatus.mockResolvedValue(undefined);
  fakes.fakeMeetings.updateSavedMeeting.mockResolvedValue({ id: MEETING_ID });
  fakes.fakeJoinMeeting.mockResolvedValue({ botId: 'bot-1' });
  fakes.fakeLeaveMeeting.mockResolvedValue(undefined);
  fakes.fakeRequireRedisQueue.mockResolvedValue({
    enqueueMeetingFinalizeJob: vi.fn(),
    enqueueMeetingSchedulerTick: vi.fn(),
  });
  fakes.fakeClaimMeetingJoinUnderRecallCap.mockResolvedValue({
    id: MEETING_ID,
    provider: 'recall',
    platform: 'meet',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
  });
  fakes.fakeSettleElapsedRecall.mockResolvedValue(undefined);
  fakes.fakeReleaseRecall.mockResolvedValue(undefined);
});

describe('scheduleMeetingBotAction', () => {
  it('forwards specific_users visibility user ids to the meetings scope', async () => {
    const result = await scheduleMeetingBotAction({
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      title: 'Restricted sync',
      visibility: 'specific_users',
      visibilityUserIds: [MEMBER_ID],
      consentGiven: true,
    });

    expect(result).toEqual({ ok: true, meetingId: MEETING_ID });
    expect(fakes.fakeMeetings.createMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultVisibility: 'specific_users',
        visibilityUserIds: [MEMBER_ID],
      }),
    );
    expect(fakes.fakeMeetings.updateMeetingStatus).toHaveBeenCalledWith(MEETING_ID, 'joining', {
      providerBotId: 'bot-1',
      metadata: {
        billing_operation_id: 'recall:test',
        reserved_recall_minutes: 60,
        reserved_recall_started_at: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
        ) as string,
      },
    });
  });
});

describe('cancelMeetingBotAction', () => {
  it('does not claim cancellation when the provider cannot remove the bot', async () => {
    fakes.fakeMeetings.getMeeting.mockResolvedValue({
      id: MEETING_ID,
      teamId: TEAM_ID,
      status: 'active',
      provider: 'recall',
      providerBotId: 'bot-1',
      metadata: {},
    });
    fakes.fakeLeaveMeeting.mockRejectedValue(new Error('provider unavailable'));

    const result = await cancelMeetingBotAction(MEETING_ID);

    expect(result).toEqual({
      ok: false,
      error: 'Meeting capture is closing, but provider confirmation is still pending.',
    });
    expect(fakes.fakeLeaveMeeting).toHaveBeenCalledWith('bot-1');
    expect(fakes.fakeMeetings.cancelMeetingCapture).toHaveBeenCalledWith(MEETING_ID, {
      allowPartialProcessing: false,
    });
    expect(fakes.fakeMeetings.confirmMeetingProviderLeave).not.toHaveBeenCalled();
  });

  it('closes local transcript acceptance before confirming the provider stopped', async () => {
    fakes.fakeMeetings.getMeeting.mockResolvedValue({
      id: MEETING_ID,
      teamId: TEAM_ID,
      status: 'active',
      provider: 'recall',
      providerBotId: 'bot-1',
      metadata: {},
    });
    const result = await cancelMeetingBotAction(MEETING_ID);

    expect(result).toEqual({ ok: true, meetingId: MEETING_ID });
    expect(fakes.fakeMeetings.cancelMeetingCapture.mock.invocationCallOrder[0]).toBeLessThan(
      fakes.fakeLeaveMeeting.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(fakes.fakeMeetings.confirmMeetingProviderLeave).toHaveBeenCalledWith(
      MEETING_ID,
      'bot-1',
    );
  });

  it('closes partial capture when the finalize queue is unavailable for janitor recovery', async () => {
    fakes.fakeMeetings.getMeeting.mockResolvedValue({
      id: MEETING_ID,
      teamId: TEAM_ID,
      status: 'active',
      provider: 'recall',
      providerBotId: null,
      metadata: {},
    });
    fakes.fakeMeetings.cancelMeetingCapture
      .mockResolvedValueOnce({ outcome: 'requires_finalize_queue' })
      .mockResolvedValueOnce({ outcome: 'processing' });
    fakes.fakeRequireRedisQueue.mockRejectedValue(new Error('redis unavailable'));

    const result = await cancelMeetingBotAction(MEETING_ID);

    expect(result).toEqual({ ok: true, meetingId: MEETING_ID });
    expect(fakes.fakeMeetings.cancelMeetingCapture).toHaveBeenNthCalledWith(2, MEETING_ID, {
      allowPartialProcessing: true,
    });
  });

  it('retries a provider leave after local transcript acceptance was already closed', async () => {
    fakes.fakeMeetings.getMeeting.mockResolvedValue({
      id: MEETING_ID,
      teamId: TEAM_ID,
      status: 'processing',
      provider: 'recall',
      providerBotId: 'bot-1',
      metadata: {
        transcript_closed_at: '2026-08-28T00:00:00.000Z',
        provider_leave_pending: true,
      },
    });

    await expect(cancelMeetingBotAction(MEETING_ID)).resolves.toEqual({
      ok: true,
      meetingId: MEETING_ID,
    });
    expect(fakes.fakeMeetings.cancelMeetingCapture).not.toHaveBeenCalled();
    expect(fakes.fakeLeaveMeeting).toHaveBeenCalledWith('bot-1');
    expect(fakes.fakeMeetings.confirmMeetingProviderLeave).toHaveBeenCalledWith(
      MEETING_ID,
      'bot-1',
    );
  });

  it('atomically moves a partial capture to processing before enqueueing finalization', async () => {
    const enqueueMeetingFinalizeJob = vi.fn().mockResolvedValue(undefined);
    fakes.fakeMeetings.getMeeting.mockResolvedValue({
      id: MEETING_ID,
      teamId: TEAM_ID,
      status: 'active',
      provider: 'recall',
      providerBotId: null,
      metadata: {},
    });
    fakes.fakeMeetings.cancelMeetingCapture
      .mockResolvedValueOnce({ outcome: 'requires_finalize_queue' })
      .mockResolvedValueOnce({ outcome: 'processing' });
    fakes.fakeRequireRedisQueue.mockResolvedValue({ enqueueMeetingFinalizeJob });

    const result = await cancelMeetingBotAction(MEETING_ID);

    expect(result).toEqual({ ok: true, meetingId: MEETING_ID });
    expect(fakes.fakeMeetings.cancelMeetingCapture).toHaveBeenNthCalledWith(1, MEETING_ID, {
      allowPartialProcessing: false,
    });
    expect(fakes.fakeMeetings.cancelMeetingCapture).toHaveBeenNthCalledWith(2, MEETING_ID, {
      allowPartialProcessing: true,
    });
    expect(enqueueMeetingFinalizeJob).toHaveBeenCalledWith({
      meetingId: MEETING_ID,
      teamId: TEAM_ID,
    });
  });

  it('settles elapsed Recall minutes when cancelling without transcript chunks', async () => {
    const startedAt = new Date('2026-08-27T08:00:00Z');
    fakes.fakeMeetings.getMeeting.mockResolvedValue({
      id: MEETING_ID,
      teamId: TEAM_ID,
      status: 'joining',
      provider: 'recall',
      providerBotId: null,
      startedAt,
      metadata: {
        reserved_recall_started_at: '2026-08-27T07:58:00Z',
        reserved_recall_minutes: 60,
      },
    });
    fakes.fakeMeetings.listChunks.mockResolvedValue([]);
    fakes.fakeSettleElapsedRecall.mockResolvedValue(undefined);

    const result = await cancelMeetingBotAction(MEETING_ID);

    expect(result).toEqual({ ok: true, meetingId: MEETING_ID });
    expect(fakes.fakeSettleElapsedRecall.mock.calls[0]?.[1]).toMatchObject({
      meetingId: MEETING_ID,
      startedAt,
      metadata: { reserved_recall_minutes: 60 },
      source: 'meeting_cancel',
    });
    expect(fakes.fakeReleaseRecall).not.toHaveBeenCalled();
  });
});

describe('updateSavedMeetingAction', () => {
  it('forwards a changed meeting URL to the meetings scope', async () => {
    const result = await updateSavedMeetingAction({
      savedMeetingId: MEETING_ID,
      title: 'Weekly sync',
      meetingUrl: 'https://zoom.us/j/987654321',
      aliases: ['weekly'],
      visibility: 'team',
      scheduleConfig: null,
      durationMinutes: 30,
      autoJoinEnabled: false,
    });

    expect(result).toEqual({ ok: true, savedMeetingId: MEETING_ID });
    expect(fakes.fakeMeetings.updateSavedMeeting).toHaveBeenCalledWith(
      MEETING_ID,
      expect.objectContaining({ meetingUrl: 'https://zoom.us/j/987654321' }),
    );
  });

  it('returns a useful message when an alias is already in use', async () => {
    fakes.fakeMeetings.updateSavedMeeting.mockRejectedValue(
      Object.assign(new Error('duplicate alias'), { code: 'SAVED_MEETING_ALIAS_CONFLICT' }),
    );

    const result = await updateSavedMeetingAction({
      savedMeetingId: MEETING_ID,
      title: 'Weekly sync',
      meetingUrl: 'https://zoom.us/j/987654321',
      aliases: ['daily'],
      visibility: 'team',
      scheduleConfig: null,
      durationMinutes: 30,
      autoJoinEnabled: false,
    });

    expect(result).toEqual({
      ok: false,
      error: 'One or more aliases are already used by another saved meeting.',
    });
  });
});
