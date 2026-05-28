import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleMeetingBotAction } from './meetings.js';

import type * as SharedModuleNS from '@timeline/shared';

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeMeetings: {
    getMeetingSettings: vi.fn(),
    getCurrentMonthMinutes: vi.fn(),
    createMeeting: vi.fn(),
    updateMeetingStatus: vi.fn(),
  },
  fakeCheckRateLimit: vi.fn(),
  fakeJoinMeeting: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@timeline/shared', async () => {
  const actual = await vi.importActual<typeof SharedModuleNS>('@timeline/shared');
  return {
    ...actual,
    withTeam: () => ({ meetings: fakes.fakeMeetings }),
    meetingBots: {
      isMeetingBotConfigured: vi.fn(() => true),
      resolveTranscriptWebhookUrl: vi.fn(
        () => 'https://timeline.test/api/webhooks/recall/transcript',
      ),
      getMeetingBotProvider: vi.fn(() => ({
        joinMeeting: fakes.fakeJoinMeeting,
      })),
    },
    rateLimit: {
      ...actual.rateLimit,
      checkRateLimit: fakes.fakeCheckRateLimit,
    },
    childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  };
});

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
  fakes.fakeMeetings.updateMeetingStatus.mockResolvedValue(undefined);
  fakes.fakeJoinMeeting.mockResolvedValue({ botId: 'bot-1', raw: { id: 'bot-1' } });
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
