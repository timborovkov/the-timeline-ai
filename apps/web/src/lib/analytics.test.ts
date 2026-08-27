import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as PostHogNodeAnalytics from '@timeline/shared/analytics/posthog-node';

const capturePostHogProductEvent = vi.fn();
const capturePostHogPersonlessSurfaceRequest = vi.fn();
const scheduleAfter = vi.fn();

vi.mock('next/server', () => ({ after: scheduleAfter }));

vi.mock('@timeline/shared/analytics/posthog-node', async (importOriginal) => ({
  ...(await importOriginal<typeof PostHogNodeAnalytics>()),
  capturePostHogProductEvent,
  capturePostHogPersonlessSurfaceRequest,
}));

const ENV_BACKUP = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  vi.clearAllMocks();
  vi.resetModules();
});

describe('server analytics helper', () => {
  it('uses only server PostHog configuration', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'ph-browser';
    delete process.env.POSTHOG_PROJECT_KEY;
    delete process.env.ANALYTICS_PSEUDONYMIZATION_KEY;
    const analytics = await import('@/lib/analytics');
    const actor = { kind: 'user' as const, userId: 'user-1', teamId: 'team-1' };

    await analytics.trackProductEvent(actor, 'team_created', { source: 'signup' });

    expect(capturePostHogProductEvent).toHaveBeenCalledWith(
      {
        key: undefined,
        host: 'https://eu.i.posthog.com',
      },
      actor,
      'team_created',
      { source: 'signup' },
    );
  });

  it('passes actors separately from minimized event properties', async () => {
    process.env.POSTHOG_PROJECT_KEY = 'ph-server';
    process.env.POSTHOG_HOST = 'https://eu.i.posthog.com';
    process.env.ANALYTICS_PSEUDONYMIZATION_KEY = 'a'.repeat(32);
    const analytics = await import('@/lib/analytics');
    const actor = { kind: 'user' as const, userId: 'user-1', teamId: 'team-1' };

    await analytics.trackProductEvent(actor, 'capture_created', {
      captureType: 'text',
      visibility: 'team',
    });

    expect(capturePostHogProductEvent).toHaveBeenCalledWith(
      {
        key: 'ph-server',
        host: 'https://eu.i.posthog.com',
        pseudonymizationKey: 'a'.repeat(32),
      },
      actor,
      'capture_created',
      { captureType: 'text', visibility: 'team' },
    );
  });

  it('extends best-effort captures through the Next.js request lifetime and swallows failures', async () => {
    process.env.POSTHOG_PROJECT_KEY = 'ph-server';
    process.env.ANALYTICS_PSEUDONYMIZATION_KEY = 'a'.repeat(32);
    capturePostHogProductEvent.mockRejectedValueOnce(new Error('posthog down'));
    const analytics = await import('@/lib/analytics');

    expect(() => {
      analytics.trackProductEventBestEffort({ kind: 'team', teamId: 'team-1' }, 'team_created', {
        source: 'manual',
      });
    }).not.toThrow();
    expect(scheduleAfter).toHaveBeenCalledOnce();
    await expect(scheduleAfter.mock.calls[0]?.[0]).resolves.toBeUndefined();
    await vi.waitFor(() => {
      expect(capturePostHogProductEvent).toHaveBeenCalledOnce();
    });
  });

  it('keeps capture best-effort when called outside a Next.js request', async () => {
    scheduleAfter.mockImplementationOnce(() => {
      throw new Error('outside request');
    });
    const analytics = await import('@/lib/analytics');

    expect(() => {
      analytics.trackProductEventBestEffort({ kind: 'team', teamId: 'team-1' }, 'team_created', {
        source: 'manual',
      });
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(capturePostHogProductEvent).toHaveBeenCalledOnce();
    });
  });

  it('captures public and app surfaces through the fixed-stream helper', async () => {
    process.env.POSTHOG_PROJECT_KEY = 'ph-server';
    const analytics = await import('@/lib/analytics');

    await analytics.capturePersonlessSurfaceRequest('public', 'home');
    await analytics.capturePersonlessSurfaceRequest('app', 'documents');

    expect(capturePostHogPersonlessSurfaceRequest).toHaveBeenNthCalledWith(
      1,
      {
        key: 'ph-server',
        host: 'https://eu.i.posthog.com',
      },
      'public',
      'home',
    );
    expect(capturePostHogPersonlessSurfaceRequest).toHaveBeenNthCalledWith(
      2,
      {
        key: 'ph-server',
        host: 'https://eu.i.posthog.com',
      },
      'app',
      'documents',
    );
  });

  it('disables capture when the server host is not the reviewed EU origin', async () => {
    process.env.POSTHOG_PROJECT_KEY = 'ph-server';
    process.env.POSTHOG_HOST = 'https://us.i.posthog.com';
    const analytics = await import('@/lib/analytics');

    await analytics.capturePersonlessSurfaceRequest('public', 'home');

    expect(capturePostHogPersonlessSurfaceRequest).toHaveBeenCalledWith(
      { key: undefined, host: 'https://eu.i.posthog.com' },
      'public',
      'home',
    );
  });
});
