import { afterEach, describe, expect, it, vi } from 'vitest';

const shutdown = vi.fn();
const captureImmediate = vi.fn().mockResolvedValue(undefined);
const ctor = vi.fn();

vi.mock('posthog-node', () => ({
  PostHog: vi.fn().mockImplementation(function PostHog(key: string, options: unknown) {
    ctor(key, options);
    return { captureImmediate, shutdown };
  }),
}));

describe('PostHog Node analytics helper', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('no-ops without a project key', async () => {
    const analytics = await import('#src/analytics/posthog-node.js');

    await analytics.capturePostHogProductEvent(
      {
        key: undefined,
        host: 'https://eu.i.posthog.com',
        pseudonymizationKey: 'a'.repeat(32),
      },
      { kind: 'user', userId: 'user-1', teamId: 'team-1' },
      'team_created',
      { source: 'signup' },
    );

    expect(ctor).not.toHaveBeenCalled();
    expect(captureImmediate).not.toHaveBeenCalled();
  });

  it('fails closed without the pseudonymization key', async () => {
    const analytics = await import('#src/analytics/posthog-node.js');

    await analytics.capturePostHogProductEvent(
      { key: 'ph-test', host: 'https://eu.i.posthog.com' },
      { kind: 'user', userId: 'user-1', teamId: 'team-1' },
      'team_created',
      { source: 'signup' },
    );

    expect(ctor).not.toHaveBeenCalled();
    expect(captureImmediate).not.toHaveBeenCalled();
  });

  it('fails closed with a short pseudonymization key', async () => {
    const analytics = await import('#src/analytics/posthog-node.js');

    await analytics.capturePostHogProductEvent(
      {
        key: 'ph-test',
        host: 'https://eu.i.posthog.com',
        pseudonymizationKey: 'short',
      },
      { kind: 'user', userId: 'user-1', teamId: 'team-1' },
      'team_created',
      { source: 'signup' },
    );

    expect(ctor).not.toHaveBeenCalled();
    expect(captureImmediate).not.toHaveBeenCalled();
  });

  it('captures runtime-validated product events with only pseudonymous actor keys', async () => {
    const analytics = await import('#src/analytics/posthog-node.js');
    const pseudonymizationKey = 'a'.repeat(32);
    const userKey = analytics.pseudonymizeAnalyticsId(pseudonymizationKey, 'user', 'user-1');
    const teamKey = analytics.pseudonymizeAnalyticsId(pseudonymizationKey, 'team', 'team-1');

    await analytics.capturePostHogProductEvent(
      {
        key: 'ph-test',
        host: 'https://eu.i.posthog.com',
        pseudonymizationKey,
      },
      { kind: 'user', userId: 'user-1', teamId: 'team-1' },
      'capture_created',
      { captureType: 'text', visibility: 'team' },
    );

    expect(ctor).toHaveBeenCalledWith('ph-test', {
      flushAt: 1,
      flushInterval: 0,
      host: 'https://eu.i.posthog.com',
      disableGeoip: true,
      personProfiles: 'never',
    });
    expect(captureImmediate).toHaveBeenCalledWith({
      distinctId: userKey,
      event: 'capture_created',
      disableGeoip: true,
      sendFeatureFlags: false,
      properties: {
        captureType: 'text',
        visibility: 'team',
        team_key: teamKey,
        $process_person_profile: false,
      },
    });
    expect(JSON.stringify(captureImmediate.mock.calls)).not.toContain('user-1');
    expect(JSON.stringify(captureImmediate.mock.calls)).not.toContain('team-1');
    expect(shutdown).not.toHaveBeenCalled();
    await analytics.shutdownPostHogNodeClients();
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('rejects extra properties before the provider receives anything', async () => {
    const analytics = await import('#src/analytics/posthog-node.js');

    await expect(
      analytics.capturePostHogProductEvent(
        {
          key: 'ph-test',
          host: 'https://eu.i.posthog.com',
          pseudonymizationKey: 'a'.repeat(32),
        },
        { kind: 'team', teamId: 'team-1' },
        'capture_created',
        {
          captureType: 'text',
          visibility: 'team',
          rawEventId: 'event-1',
        } as never,
      ),
    ).rejects.toThrow();
    expect(ctor).not.toHaveBeenCalled();
    expect(captureImmediate).not.toHaveBeenCalled();
  });

  it('passes only the approved application-owned fixed-stream input to the SDK', async () => {
    const analytics = await import('#src/analytics/posthog-node.js');

    await analytics.capturePostHogPersonlessSurfaceRequest(
      { key: 'ph-test', host: 'https://eu.i.posthog.com' },
      'public',
      'help_capture',
    );
    await analytics.capturePostHogPersonlessSurfaceRequest(
      { key: 'ph-test', host: 'https://eu.i.posthog.com' },
      'app',
      'board_detail',
    );

    expect(captureImmediate).toHaveBeenNthCalledWith(1, {
      distinctId: '__timeline_personless__:public:v1',
      event: 'public_surface_requested',
      disableGeoip: true,
      sendFeatureFlags: false,
      properties: { surface: 'help_capture', $process_person_profile: false },
    });
    expect(captureImmediate).toHaveBeenNthCalledWith(2, {
      distinctId: '__timeline_personless__:app:v1',
      event: 'app_surface_requested',
      disableGeoip: true,
      sendFeatureFlags: false,
      properties: { surface: 'board_detail', $process_person_profile: false },
    });
    expect(ctor).toHaveBeenCalledOnce();
    await analytics.shutdownPostHogNodeClients();
  });

  it('fails closed for unknown surface values', async () => {
    const analytics = await import('#src/analytics/posthog-node.js');

    await expect(
      analytics.capturePostHogPersonlessSurfaceRequest(
        { key: 'ph-test', host: 'https://eu.i.posthog.com' },
        'public',
        '/help/private-token' as never,
      ),
    ).rejects.toThrow();
    expect(ctor).not.toHaveBeenCalled();
  });

  it('fails closed for an unreviewed PostHog ingestion host', async () => {
    const analytics = await import('#src/analytics/posthog-node.js');

    await analytics.capturePostHogPersonlessSurfaceRequest(
      { key: 'ph-test', host: 'https://us.i.posthog.com' },
      'public',
      'home',
    );
    expect(ctor).not.toHaveBeenCalled();
    expect(captureImmediate).not.toHaveBeenCalled();
  });

  it('creates a separate cached client when host or key changes', async () => {
    const analytics = await import('#src/analytics/posthog-node.js');
    const actor = { kind: 'team' as const, teamId: 'team-1' };

    await analytics.capturePostHogProductEvent(
      {
        key: 'ph-test-a',
        host: 'https://eu.i.posthog.com',
        pseudonymizationKey: 'a'.repeat(32),
      },
      actor,
      'team_created',
      { source: 'manual' },
    );
    await analytics.capturePostHogProductEvent(
      {
        key: 'ph-test-b',
        host: 'https://eu.i.posthog.com',
        pseudonymizationKey: 'a'.repeat(32),
      },
      actor,
      'team_created',
      { source: 'manual' },
    );

    expect(ctor).toHaveBeenCalledTimes(2);
    await analytics.shutdownPostHogNodeClients();
    expect(shutdown).toHaveBeenCalledTimes(2);
  });
});
