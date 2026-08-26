import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as PostHogNodeSdk from 'posthog-node';

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('posthog-node', async (importOriginal) => {
  const actual = await importOriginal<typeof PostHogNodeSdk>();
  return {
    ...actual,
    PostHog: class extends actual.PostHog {
      constructor(key: string, options: ConstructorParameters<typeof actual.PostHog>[1]) {
        super(key, {
          ...options,
          disableCompression: true,
          fetch: transport.fetch,
        });
      }
    },
  };
});

afterEach(async () => {
  const analytics = await import('#src/analytics/posthog-node.js');
  await analytics.shutdownPostHogNodeClients();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('PostHog Node fixed-stream transport', () => {
  it('sends only approved application data plus mandatory SDK transport metadata', async () => {
    transport.fetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
      headers: { get: () => null },
    });
    const analytics = await import('#src/analytics/posthog-node.js');

    await analytics.capturePostHogPersonlessSurfaceRequest(
      { key: 'ph-test', host: 'https://eu.i.posthog.com' },
      'public',
      'solution_client_project_handoffs',
    );

    expect(transport.fetch).toHaveBeenCalledOnce();
    const [url, options] = transport.fetch.mock.calls[0] as [
      string,
      { body: string; method: string },
    ];
    expect(url).toBe('https://eu.i.posthog.com/batch/');
    expect(options.method).toBe('POST');

    const payload = JSON.parse(options.body) as {
      api_key: string;
      batch: Record<string, unknown>[];
      sent_at: string;
    };
    expect(Object.keys(payload).sort()).toEqual(['api_key', 'batch', 'sent_at']);
    expect(payload.api_key).toBe('ph-test');
    expect(typeof payload.sent_at).toBe('string');
    expect(payload.batch).toHaveLength(1);

    const event = payload.batch[0];
    expect(Object.keys(event ?? {}).sort()).toEqual([
      'distinct_id',
      'event',
      'properties',
      'timestamp',
      'uuid',
    ]);
    expect(event).toMatchObject({
      distinct_id: '__timeline_personless__:public:v1',
      event: 'public_surface_requested',
    });
    expect(typeof event?.timestamp).toBe('string');
    expect(typeof event?.uuid).toBe('string');
    const properties = event?.properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual([
      '$geoip_disable',
      '$is_server',
      '$lib',
      '$lib_version',
      '$process_person_profile',
      'surface',
    ]);
    expect(properties).toMatchObject({
      surface: 'solution_client_project_handoffs',
      $process_person_profile: false,
      $geoip_disable: true,
      $is_server: true,
      $lib: 'posthog-node',
    });
    expect(typeof properties.$lib_version).toBe('string');

    const serialized = JSON.stringify(payload);
    for (const prohibited of [
      'request',
      'pathname',
      'query',
      'referrer',
      'cookie',
      'user_agent',
      'visitor_id',
      'session_id',
      'user_id',
      'team_id',
    ]) {
      expect(serialized).not.toContain(`\"${prohibited}\"`);
    }
  });
});
