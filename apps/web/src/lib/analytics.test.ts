import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as PostHogNodeAnalytics from '@timeline/shared/analytics/posthog-node';

const capturePostHogProductEvent = vi.fn();
const evaluatePostHogFeatureFlag = vi.fn();

vi.mock('@timeline/shared/analytics/posthog-node', async (importOriginal) => ({
  ...(await importOriginal<typeof PostHogNodeAnalytics>()),
  capturePostHogProductEvent,
  evaluatePostHogFeatureFlag,
}));

const ENV_BACKUP = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  vi.clearAllMocks();
  vi.resetModules();
});

describe('server analytics helper', () => {
  it('passes missing PostHog config to the shared no-op helper', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const analytics = await import('@/lib/analytics');

    await analytics.trackProductEvent('user-1', 'team_created', {
      teamId: 'team-1',
      userId: 'user-1',
      source: 'signup',
    });

    expect(capturePostHogProductEvent).toHaveBeenCalledWith(
      { key: undefined, host: 'https://eu.i.posthog.com' },
      'user-1',
      'team_created',
      { teamId: 'team-1', userId: 'user-1', source: 'signup' },
    );
  });

  it('captures sanitized product events through the shared helper', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'ph-test';
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com';
    const analytics = await import('@/lib/analytics');

    await analytics.trackProductEvent('user-1', 'capture_created', {
      teamId: 'team-1',
      userId: 'user-1',
      rawEventId: 'event-1',
      captureType: 'text',
      visibility: 'team',
    });

    expect(capturePostHogProductEvent).toHaveBeenCalledWith(
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
  });

  it('starts best-effort captures without making callers await shutdown', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'ph-test';
    capturePostHogProductEvent.mockResolvedValueOnce(undefined);
    const analytics = await import('@/lib/analytics');

    analytics.trackProductEventBestEffort('user-1', 'team_created', {
      teamId: 'team-1',
      userId: 'user-1',
      source: 'signup',
    });

    expect(capturePostHogProductEvent).toHaveBeenCalledWith(
      { key: 'ph-test', host: 'https://eu.i.posthog.com' },
      'user-1',
      'team_created',
      { teamId: 'team-1', userId: 'user-1', source: 'signup' },
    );
  });

  it('swallows best-effort capture failures', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'ph-test';
    capturePostHogProductEvent.mockRejectedValueOnce(new Error('posthog down'));
    const analytics = await import('@/lib/analytics');

    expect(() => {
      analytics.trackProductEventBestEffort('user-1', 'team_created', {
        teamId: 'team-1',
        userId: 'user-1',
        source: 'signup',
      });
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(capturePostHogProductEvent).toHaveBeenCalledOnce();
    });
  });

  it('reads typed feature flags through the shared helper', async () => {
    evaluatePostHogFeatureFlag.mockResolvedValueOnce(true);
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'ph-test';
    const analytics = await import('@/lib/analytics');

    await expect(analytics.getFeatureFlag('onboardingChecklistV2', 'user-1')).resolves.toBe(true);
    expect(evaluatePostHogFeatureFlag).toHaveBeenCalledWith(
      { key: 'ph-test', host: 'https://eu.i.posthog.com' },
      'onboardingChecklistV2',
      'user-1',
    );
  });
});
