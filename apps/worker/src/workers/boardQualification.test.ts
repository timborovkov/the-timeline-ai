import { expect, vi } from '@timeline/test-support';
import { beforeEach, it } from 'bun:test';
import { UnrecoverableError } from 'bullmq';
import { BillingAdmissionError } from '@timeline/shared/billing';

const failRequest = vi.fn(async () => undefined);
const billing = vi.fn(async () => undefined);
let processor: () => Promise<void>;

await vi.mock(
  import.meta.resolve('@timeline/shared'),
  () => ({
    queue: { getRedisConnection: () => ({ set: async () => 'OK' }) },
  }),
  () => import('@timeline/shared'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      boardQualification: { failRequest, processRequest: async () => undefined },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/platform-admin/runtime'),
  () => ({
    runGuardedJob: async (_request: unknown, run: () => Promise<void>) => run(),
  }),
  () => import('@timeline/shared/platform-admin/runtime'),
);
await vi.mock(
  import.meta.resolve('#src/billing-context.js'),
  () => ({
    withWorkerAiBilling: billing,
  }),
  () => import('#src/billing-context.js'),
);
await vi.mock(
  import.meta.resolve('#src/workers/boardQualification-discovery.js'),
  () => ({
    discoverBoardQualificationRequests: async () => [
      { id: 'request', teamId: 'team', userId: 'user', version: 3 },
    ],
  }),
  () => import('#src/workers/boardQualification-discovery.js'),
);
await vi.mock(
  import.meta.resolve('bullmq'),
  () => ({
    UnrecoverableError,
    Queue: vi.fn(),
    Worker: vi.fn((_name: string, run: () => Promise<void>) => {
      processor = run;
    }),
  }),
  () => import('bullmq'),
);
const { startBoardQualificationWorker } = await import('#src/workers/boardQualification.js');

beforeEach(() => {
  vi.clearAllMocks();
  startBoardQualificationWorker({ db: {} as never });
});

it.each([
  new BillingAdmissionError('spend_cap_reached'),
  new UnrecoverableError('spend cap reached'),
])('propagates billing rejection without recording a model failure (%s)', async (error) => {
  billing.mockRejectedValueOnce(error);
  await expect(processor()).rejects.toBe(error);
  expect(failRequest).not.toHaveBeenCalled();
});

it('keeps ordinary qualification failures retryable on their request version', async () => {
  billing.mockRejectedValueOnce(new Error('model failure'));
  await processor();
  expect(failRequest).toHaveBeenCalledWith('request', 3);
});
