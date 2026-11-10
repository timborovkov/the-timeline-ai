import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getFirstRun: vi.fn(),
  refreshDocumentCapture: vi.fn(),
  detectEmailArrival: vi.fn(),
  getFirstRunRecord: vi.fn(),
  trackProductEventBestEffort: vi.fn(),
  displayInboundEmail: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
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

const { GET } = await import('./route.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({
    active: { teamId: 'team-1', teamSlug: 'northwind', teamName: 'Northwind' },
  });
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

describe('GET /api/onboarding/first-run', () => {
  it('fires first_capture_landed once the document capture persists', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', userId: 'user-1', teamId: 'team-1' },
      'first_capture_landed',
      { path: 'document' },
    );
    const body = (await response.json()) as { inboundEmail: string; prefilledQuestion: string };
    expect(body.inboundEmail).toBe('northwind@inbound.test');
    expect(body.prefilledQuestion).toContain('document');
  });
});
