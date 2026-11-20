import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import {
  firstRunPollingNeeded,
  pollFirstRun,
  reviveFirstRunStatus,
  type FirstRunStatusPayload,
} from '@/lib/first-run-poll';

const starter = {
  teamId: 'team-test',
  teamName: 'Example',
  inboundEmail: null,
  firstRun: { phase: 'processing' },
  record: {
    title: 'Synthetic document',
    meta: '',
    processingSteps: [{ id: 'extract', label: 'Extracting', status: 'active' }],
    emailArrived: false,
  },
} as FirstRunStatusPayload;

function state(phase: 'processing' | 'record', teamId = starter.teamId) {
  return { ...starter, teamId, firstRun: { ...starter.firstRun, phase } };
}

describe('first-run status polling', () => {
  let hidden = false;
  const fetchStatus = vi.fn<typeof fetch>();
  const callbacks = { update: vi.fn(), navigate: vi.fn(), refresh: vi.fn() };
  let stop: (() => void) | undefined;

  beforeEach(() => {
    hidden = false;
    vi.clearAllMocks();
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    vi.stubGlobal('fetch', fetchStatus);
  });

  afterEach(() => {
    stop?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('backs off unchanged results and navigates as soon as the record is ready', async () => {
    fetchStatus
      .mockResolvedValueOnce(Response.json(starter))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json(state('record')));
    stop = pollFirstRun(starter, callbacks);
    await vi.advanceTimersByTimeAsync(2500);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(callbacks.navigate).toHaveBeenCalledWith('/app/onboarding/record');
    expect(callbacks.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it('keeps waiting for the first connector capture and stops on document extraction failure', () => {
    function capture(starterPath: 'slack' | 'document') {
      return {
        ...starter,
        firstRun: { ...starter.firstRun, phase: 'processing', starterPath },
        record: {
          ...starter.record,
          processingSteps: [{ id: 'extract', label: 'Extracting', status: 'failed' }],
        },
      } as FirstRunStatusPayload;
    }
    expect(firstRunPollingNeeded(capture('slack'))).toBe(true);
    expect(firstRunPollingNeeded(capture('document'))).toBe(false);
  });

  it('revives JSON date strings from the status poll before updating callers', async () => {
    const payload = {
      ...starter,
      firstRun: {
        phase: 'processing',
        starterPath: 'document',
        starterSelectedAt: '2026-03-29T19:00:00.000Z',
        guideHiddenAt: null,
        firstCaptureLandedAt: '2026-03-29T19:05:00.000Z',
        createdAt: '2026-03-29T18:00:00.000Z',
        updatedAt: '2026-03-29T19:05:00.000Z',
      },
    };
    fetchStatus.mockResolvedValueOnce(Response.json(payload));
    stop = pollFirstRun(starter, callbacks);
    await vi.advanceTimersByTimeAsync(2500);
    expect(callbacks.update).toHaveBeenCalledTimes(1);
    const next = callbacks.update.mock.calls[0]?.[0] as FirstRunStatusPayload;
    expect(next.firstRun?.starterSelectedAt).toBeInstanceOf(Date);
    expect(next.firstRun?.starterSelectedAt?.toISOString()).toBe('2026-03-29T19:00:00.000Z');
    expect(next.firstRun?.firstCaptureLandedAt).toBeInstanceOf(Date);
    expect(next.firstRun?.createdAt).toBeInstanceOf(Date);
    expect(next.firstRun?.updatedAt).toBeInstanceOf(Date);
  });

  it('pauses on a hidden tab and ignores a late response or another workspace', async () => {
    const late = Promise.withResolvers<Response>();
    fetchStatus
      .mockResolvedValueOnce(Response.json(starter))
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce(Response.json(state('record', 'other-team')));
    stop = pollFirstRun(starter, callbacks);
    await vi.advanceTimersByTimeAsync(7500);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    late.resolve(Response.json(state('record')));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(callbacks.navigate).not.toHaveBeenCalled();
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1);
    expect(callbacks.refresh).toHaveBeenCalledTimes(1);
    expect(callbacks.update).toHaveBeenCalledTimes(1);
    expect(callbacks.navigate).not.toHaveBeenCalled();
  });
});

describe('reviveFirstRunStatus', () => {
  it('turns polled JSON strings into Date values and drops invalid ones', () => {
    const revived = reviveFirstRunStatus({
      teamId: 'team-test',
      teamName: 'Example',
      inboundEmail: null,
      firstRun: {
        phase: 'processing',
        starterPath: 'email',
        starterSelectedAt: '2026-03-29T19:00:00.000Z',
        guideHiddenAt: 'not-a-date',
        firstCaptureLandedAt: null,
        createdAt: '2026-03-29T18:00:00.000Z',
        updatedAt: '2026-03-29T18:30:00.000Z',
      },
      record: null,
    } as unknown as FirstRunStatusPayload);

    expect(revived.firstRun?.starterSelectedAt).toBeInstanceOf(Date);
    expect(revived.firstRun?.guideHiddenAt).toBeNull();
    expect(revived.firstRun?.firstCaptureLandedAt).toBeNull();
    expect(revived.firstRun?.createdAt).toBeInstanceOf(Date);
  });
});
