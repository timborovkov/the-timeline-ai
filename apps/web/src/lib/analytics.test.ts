import { afterEach, describe, expect, it, vi } from 'vitest';

const shutdown = vi.fn();
const capture = vi.fn();
const identify = vi.fn();
const groupIdentify = vi.fn();
const evaluateFlags = vi.fn();
const ctor = vi.fn();

vi.mock('posthog-node', () => ({
  PostHog: vi.fn().mockImplementation(function PostHog(key: string, options: unknown) {
    ctor(key, options);
    return { capture, identify, groupIdentify, evaluateFlags, shutdown };
  }),
}));

const ENV_BACKUP = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  vi.clearAllMocks();
  vi.resetModules();
});

describe('server analytics helper', () => {
  it('no-ops when PostHog is not configured', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const analytics = await import('@/lib/analytics');

    await analytics.trackProductEvent('user-1', 'team_created', {
      teamId: 'team-1',
      userId: 'user-1',
      source: 'signup',
    });

    expect(ctor).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('captures sanitized product events and flushes', async () => {
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
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'ph-test';
    const analytics = await import('@/lib/analytics');

    await expect(analytics.getFeatureFlag('onboardingChecklistV2', 'user-1')).resolves.toBe(true);
    expect(evaluateFlags).toHaveBeenCalledWith('user-1', {
      flagKeys: ['onboarding-checklist-v2'],
    });
    expect(getFlag).toHaveBeenCalledWith('onboarding-checklist-v2');
    expect(shutdown).toHaveBeenCalledOnce();
  });
});
