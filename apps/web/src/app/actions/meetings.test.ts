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
    createMeeting: vi.fn(),
    claimMeetingForJoin: vi.fn(),
    findActiveMeetingForUrl: vi.fn(),
    updateMeetingStatus: vi.fn(),
    updateSavedMeeting: vi.fn(),
  },
  fakeCheckRateLimit: vi.fn(),
  fakeJoinMeeting: vi.fn(),
  fakeLeaveMeeting: vi.fn(),
  fakeRequireRedisQueue: vi.fn(),
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
  fakes.fakeMeetings.updateMeetingStatus.mockResolvedValue(undefined);
  fakes.fakeMeetings.updateSavedMeeting.mockResolvedValue({ id: MEETING_ID });
  fakes.fakeJoinMeeting.mockResolvedValue({ botId: 'bot-1' });
  fakes.fakeLeaveMeeting.mockResolvedValue(undefined);
  fakes.fakeRequireRedisQueue.mockResolvedValue({ enqueueMeetingFinalizeJob: vi.fn() });
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
    });
  });
});

describe('cancelMeetingBotAction', () => {
  it('preserves local cancellation when the provider cannot remove the bot', async () => {
    fakes.fakeMeetings.getMeeting.mockResolvedValue({
      id: MEETING_ID,
      teamId: TEAM_ID,
      status: 'active',
      provider: 'recall',
      providerBotId: 'bot-1',
    });
    fakes.fakeLeaveMeeting.mockRejectedValue(new Error('provider unavailable'));

    const result = await cancelMeetingBotAction(MEETING_ID);

    expect(result).toEqual({ ok: true, meetingId: MEETING_ID });
    expect(fakes.fakeLeaveMeeting).toHaveBeenCalledWith('bot-1');
    expect(fakes.fakeMeetings.cancelMeetingCapture).toHaveBeenCalledWith(MEETING_ID, {
      allowPartialProcessing: false,
    });
  });

  it('does not move partial captures to processing when the finalize queue is unavailable', async () => {
    fakes.fakeMeetings.getMeeting.mockResolvedValue({
      id: MEETING_ID,
      teamId: TEAM_ID,
      status: 'active',
      provider: 'recall',
      providerBotId: null,
    });
    fakes.fakeMeetings.cancelMeetingCapture.mockResolvedValue({
      outcome: 'requires_finalize_queue',
    });
    fakes.fakeRequireRedisQueue.mockRejectedValue(new Error('redis unavailable'));

    const result = await cancelMeetingBotAction(MEETING_ID);

    expect(result).toMatchObject({
      ok: false,
      error: 'Cannot cancel this meeting while finalize queue is unavailable.',
    });
    expect(fakes.fakeMeetings.updateMeetingStatus).not.toHaveBeenCalled();
  });

  it('atomically moves a partial capture to processing before enqueueing finalization', async () => {
    const enqueueMeetingFinalizeJob = vi.fn().mockResolvedValue(undefined);
    fakes.fakeMeetings.getMeeting.mockResolvedValue({
      id: MEETING_ID,
      teamId: TEAM_ID,
      status: 'active',
      provider: 'recall',
      providerBotId: null,
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
