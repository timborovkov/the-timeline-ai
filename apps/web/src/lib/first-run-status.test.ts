import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({
  getFirstRun: vi.fn(),
  refreshDocumentCapture: vi.fn(),
  detectEmailArrival: vi.fn(),
  getFirstRunRecord: vi.fn(),
  trackProductEventBestEffort: vi.fn(),
  displayInboundEmail: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/analytics'),
  () => ({ trackProductEventBestEffort: fakes.trackProductEventBestEffort }),
  () => import('@/lib/analytics'),
);
await vi.mock(
  import.meta.resolve('@/lib/hub-status'),
  () => ({ displayInboundEmail: fakes.displayInboundEmail }),
  () => import('@/lib/hub-status'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/env'),
  () => ({ getEnv: () => ({}) }),
  () => import('@timeline/shared/env'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/onboarding'),
  async () => ({
    ...(await import('@timeline/shared/onboarding')),
  }),
  () => import('@timeline/shared/onboarding'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      onboarding: {
        getFirstRun: fakes.getFirstRun,
        refreshDocumentCapture: fakes.refreshDocumentCapture,
        detectEmailArrival: fakes.detectEmailArrival,
        getFirstRunRecord: fakes.getFirstRunRecord,
      },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);

const { loadFirstRunStatus } = await import('./first-run-status.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.displayInboundEmail.mockReturnValue('northwind@inbound.test');
  fakes.getFirstRun.mockResolvedValue({
    starterPath: 'document',
    firstCaptureLandedAt: null,
    workStyle: 'email',
    phase: 'processing',
  });
  fakes.refreshDocumentCapture.mockResolvedValue(undefined);
  fakes.getFirstRunRecord.mockResolvedValue({
    firstRun: {
      starterPath: 'document',
      firstCaptureLandedAt: new Date('2026-11-09T12:00:00.000Z'),
      workStyle: 'email',
      phase: 'record',
    },
    inboundEmail: 'northwind@inbound.test',
    teamName: 'Northwind',
    recordTitle: 'seed-deck.pdf',
    recordMeta: 'Document',
    summary: 'A short cited summary.',
    note: 'A document is a snapshot.',
    sources: [],
    suggestions: [],
    processingSteps: [],
    emailArrived: false,
  });
});

describe('loadFirstRunStatus', () => {
  it('fires first_capture_landed on the UI poll path when a document lands', async () => {
    await loadFirstRunStatus({
      db: {} as never,
      teamId: 'team-1',
      userId: 'user-1',
      teamSlug: 'northwind',
      teamName: 'Northwind',
    });
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', userId: 'user-1', teamId: 'team-1' },
      'first_capture_landed',
      { path: 'document' },
    );
  });
});
