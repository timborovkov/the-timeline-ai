import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import {
  firstRunPollingNeeded,
  pollFirstRun,
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
    const waiting = {
      ...starter,
      firstRun: { ...starter.firstRun, phase: 'processing', starterPath: 'slack' },
      record: {
        ...starter.record,
        processingSteps: [{ id: 'extract', label: 'Extracting', status: 'failed' }],
      },
    } as FirstRunStatusPayload;
    expect(firstRunPollingNeeded(waiting)).toBe(true);
    expect(
      firstRunPollingNeeded({
        ...waiting,
        firstRun: { ...waiting.firstRun!, starterPath: 'document' },
      }),
    ).toBe(false);
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
