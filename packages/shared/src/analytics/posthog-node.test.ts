import { afterEach, describe, expect, it, vi } from 'vitest';

const shutdown = vi.fn();
const capture = vi.fn();
const evaluateFlags = vi.fn();
const ctor = vi.fn();

vi.mock('posthog-node', () => ({
  PostHog: vi.fn().mockImplementation(function PostHog(key: string, options: unknown) {
    ctor(key, options);
    return { capture, evaluateFlags, shutdown };
  }),
}));

describe('PostHog Node analytics helper', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('no-ops without a project key', async () => {
    const analytics = await import('#src/analytics/posthog-node.js');

    await analytics.capturePostHogProductEvent(
      { key: undefined, host: 'https://eu.i.posthog.com' },
      'user-1',
      'team_created',
      { teamId: 'team-1', userId: 'user-1', source: 'signup' },
    );

    expect(ctor).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('captures sanitized product events and flushes', async () => {
    const analytics = await import('#src/analytics/posthog-node.js');

    await analytics.capturePostHogProductEvent(
      { key: 'ph-test', host: 'https://eu.i.posthog.com' },
      'user-1',
      'capture_created',
      {
        teamId: 'team-1',
        userId: 'user-1',
        rawEventId: 'event-1',
        captureType: 'text',
        visibility: 'team',
      },
    );

    expect(ctor).toHaveBeenCalledWith('ph-test', {
      flushAt: 1,
      flushInterval: 0,
      host: 'https://eu.i.posthog.com',
    });
    expect(capture).toHaveBeenCalledWith({
      distinctId: 'user-1',
      event: 'capture_created',
      groups: { team: 'team-1' },
      properties: {
        teamId: 'team-1',
        userId: 'user-1',
        rawEventId: 'event-1',
        captureType: 'text',
        visibility: 'team',
      },
      sendFeatureFlags: true,
    });
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('reads typed feature flags and flushes', async () => {
    const getFlag = vi.fn().mockReturnValueOnce(true);
    evaluateFlags.mockResolvedValueOnce({ getFlag });
    const analytics = await import('#src/analytics/posthog-node.js');

    await expect(
      analytics.evaluatePostHogFeatureFlag(
        { key: 'ph-test', host: 'https://eu.i.posthog.com' },
        'onboardingChecklistV2',
        'user-1',
      ),
    ).resolves.toBe(true);
    expect(evaluateFlags).toHaveBeenCalledWith('user-1', {
      flagKeys: ['onboarding-checklist-v2'],
    });
    expect(getFlag).toHaveBeenCalledWith('onboarding-checklist-v2');
    expect(shutdown).toHaveBeenCalledOnce();
  });
});
