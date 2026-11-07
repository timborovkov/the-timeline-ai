import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, it } from 'bun:test';

const execute = vi.fn();
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: { execute } }),
  () => import('@/lib/db'),
);

const { GET } = await import('@/app/api/health/route');

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue([{ '?column?': 1 }]);
});

afterEach(() => {
  vi.clearAllMocks();
});

it('reports database liveness and the Bun runtime', async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, db: 'up', runtime: 'bun' });
});

it('keeps the Bun runtime label when the database probe fails', async () => {
  execute.mockRejectedValue(new Error('connection refused'));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, db: 'down', runtime: 'bun' });
});
