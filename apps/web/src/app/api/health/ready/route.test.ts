import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, it } from 'bun:test';

const fakes = vi.hoisted(() => ({ load: vi.fn(), workers: vi.fn(), jobs: vi.fn() }));
await vi.mock(
  import.meta.resolve('@/lib/queue'),
  () => ({ requireRedisQueue: fakes.load }),
  () => import('@/lib/queue'),
);
const { resetEnvForTests } = await import('@timeline/shared/env');
const { GET } = await import('@/app/api/health/ready/route');
const original = { ...process.env };
beforeEach(() => {
  process.env.CRON_SECRET = 'test-readiness-secret';
  resetEnvForTests();
  vi.clearAllMocks();
  fakes.workers.mockResolvedValue([{}]);
  fakes.jobs.mockResolvedValue([]);
  const queue = () => ({
    name: 'synthetic',
    getWorkers: fakes.workers,
    getJobs: fakes.jobs,
    getJobCounts: () => Promise.resolve({ waiting: 0, active: 0, failed: 0 }),
  });
  fakes.load.mockResolvedValue({
    getExtractQueue: queue,
    getEmbedQueue: queue,
    getIntegrationSyncQueue: queue,
    getWebhookDeliveryQueue: queue,
  });
});
afterEach(() => {
  process.env = { ...original };
  resetEnvForTests();
});
function request(authorized = true) {
  return new Request('https://timeline.test/api/health/ready', {
    headers: authorized ? { authorization: 'Bearer test-readiness-secret' } : {},
  });
}
it('rejects unauthenticated probes before touching queues', async () => {
  expect((await GET(request(false))).status).toBe(401);
  expect(fakes.load).not.toHaveBeenCalled();
});
it('reports absent workers and stale queued work as degraded', async () => {
  expect((await GET(request())).status).toBe(200);
  fakes.workers.mockResolvedValue([]);
  expect((await GET(request())).status).toBe(503);
  fakes.workers.mockResolvedValue([{}]);
  fakes.jobs.mockResolvedValue([
    { timestamp: Date.now() - 31 * 60_000, data: { private: 'not returned' } },
  ]);
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('not returned');
});
it('returns a minimal unavailable response on dependency failure', async () => {
  fakes.load.mockRejectedValue(new Error('secret infrastructure detail'));
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false });
});
