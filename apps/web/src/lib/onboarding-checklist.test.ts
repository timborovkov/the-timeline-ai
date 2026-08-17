import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  cachedJson: vi.fn(async (_key: string, _ttl: number, load: () => Promise<unknown>) => load()),
  cacheKey: vi.fn((parts: unknown[]) => parts.join(':')),
}));

vi.mock('@timeline/shared/cache', () => ({
  cacheKey: fakes.cacheKey,
  cachedJson: fakes.cachedJson,
}));

const {
  ONBOARDING_CHECKLIST_CACHE_TTL_SECONDS,
  loadOnboardingChecklistView,
  onboardingChecklistCacheKey,
  toOnboardingChecklistView,
} = await import('./onboarding-checklist.js');

describe('onboarding checklist view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.cachedJson.mockImplementation(
      async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
    );
    fakes.cacheKey.mockImplementation((parts: unknown[]) => parts.join(':'));
  });

  it('maps scoped step state onto the client checklist view', () => {
    expect(
      toOnboardingChecklistView({
        dismissed: true,
        steps: [
          {
            step: 'first_note',
            completed: true,
            completedAt: null,
            completedByUserId: null,
          },
          {
            step: 'invite_teammate',
            completed: false,
            completedAt: null,
            completedByUserId: null,
          },
        ],
        connectionCounts: {
          telegramLinkTokens: 0,
          telegramChatBindings: 0,
          telegramUserTeams: 0,
          slackWorkspaceTeams: 0,
          slackConversationBindings: 0,
          slackUserTeams: 0,
          nativeIntegrations: 0,
          teamMcpServers: 0,
          activeMembers: 0,
          pendingInvites: 0,
          userChatMessages: 0,
          meetings: 0,
          reviewedProposals: 0,
          dailyDigests: 0,
          ingestWebhooks: 0,
          outboundMcpKeys: 0,
        },
      }),
    ).toEqual({
      dismissed: true,
      items: [
        { key: 'first_note', label: 'Capture one timeline event', completed: true },
        { key: 'invite_teammate', label: 'Invite a teammate', completed: false },
      ],
    });
  });

  it('loads the mapped view through the shared onboarding cache key', async () => {
    const getChecklistState = vi.fn(async () => ({
      dismissed: false,
      steps: [
        {
          step: 'first_ask',
          completed: false,
          completedAt: null,
          completedByUserId: null,
        },
      ],
      connectionCounts: {
        telegramLinkTokens: 0,
        telegramChatBindings: 0,
        telegramUserTeams: 0,
        slackWorkspaceTeams: 0,
        slackConversationBindings: 0,
        slackUserTeams: 0,
        nativeIntegrations: 0,
        teamMcpServers: 0,
        activeMembers: 0,
        pendingInvites: 0,
        userChatMessages: 0,
        meetings: 0,
        reviewedProposals: 0,
        dailyDigests: 0,
        ingestWebhooks: 0,
        outboundMcpKeys: 0,
      },
    }));

    await expect(
      loadOnboardingChecklistView({
        teamId: 'team-1',
        userId: 'user-1',
        getChecklistState,
      }),
    ).resolves.toEqual({
      dismissed: false,
      items: [{ key: 'first_ask', label: 'Ask the agent a question', completed: false }],
    });

    expect(onboardingChecklistCacheKey('team-1', 'user-1')).toBe('onboarding:team-1:user-1');
    expect(fakes.cachedJson).toHaveBeenCalledWith(
      'onboarding:team-1:user-1',
      ONBOARDING_CHECKLIST_CACHE_TTL_SECONDS,
      expect.any(Function),
    );
    expect(getChecklistState).toHaveBeenCalledOnce();
  });
});
