import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RateLimitModule from '@timeline/shared/rate-limit';

import { cancelMeetingBotAction, scheduleMeetingBotAction } from '@/app/actions/meetings';

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeMeetings: {
    getMeetingSettings: vi.fn(),
    getCurrentMonthMinutes: vi.fn(),
    getMeeting: vi.fn(),
    listChunks: vi.fn(),
    createMeeting: vi.fn(),
    updateMeetingStatus: vi.fn(),
  },
  fakeCheckRateLimit: vi.fn(),
  fakeJoinMeeting: vi.fn(),
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
  getMeetingBotProvider: vi.fn(() => ({
    joinMeeting: fakes.fakeJoinMeeting,
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
  fakes.fakeMeetings.getMeeting.mockResolvedValue(null);
  fakes.fakeMeetings.listChunks.mockResolvedValue([]);
  fakes.fakeMeetings.updateMeetingStatus.mockResolvedValue(undefined);
  fakes.fakeJoinMeeting.mockResolvedValue({ botId: 'bot-1', raw: { id: 'bot-1' } });
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
  });
});

describe('cancelMeetingBotAction', () => {
  it('does not move partial captures to processing when the finalize queue is unavailable', async () => {
    fakes.fakeMeetings.getMeeting.mockResolvedValue({
      id: MEETING_ID,
      teamId: TEAM_ID,
      status: 'active',
      provider: 'recall',
      providerBotId: null,
    });
    fakes.fakeMeetings.listChunks.mockResolvedValue([{ id: 'chunk-1' }]);
    fakes.fakeRequireRedisQueue.mockRejectedValue(new Error('redis unavailable'));

    const result = await cancelMeetingBotAction(MEETING_ID);

    expect(result).toMatchObject({
      ok: false,
      error: 'Cannot cancel this meeting while finalize queue is unavailable.',
    });
    expect(fakes.fakeMeetings.updateMeetingStatus).not.toHaveBeenCalled();
  });
});
