import {
  isConnectorStarterPath,
  SETUP_SHELL_PHASES,
  type FirstRunPhase,
  type FirstRunState,
  type NamedProcessingStep,
} from '@timeline/shared/onboarding/first-run';

export interface FirstRunStatusPayload {
  firstRun: FirstRunState | null;
  inboundEmail: string | null;
  teamName: string;
  teamId: string | null;
  record: {
    title: string;
    meta: string;
    processingSteps: NamedProcessingStep[];
    emailArrived: boolean;
  } | null;
}

export function firstRunDestination(phase: FirstRunPhase): string {
  if (phase === 'record') return '/app/onboarding/record';
  if (phase === 'ask') return '/app/chat';
  if (phase === 'approve') return '/app/approvals';
  if (phase === 'live') return '/app/onboarding/live';
  return '/app';
}

const INITIAL_DELAY_MS = 2500;
const MAX_DELAY_MS = 30_000;

function progressKey(status: FirstRunStatusPayload) {
  return JSON.stringify([
    status.firstRun?.phase,
    status.record?.title,
    status.record?.processingSteps,
    status.record?.emailArrived,
  ]);
}

export function firstRunPollingNeeded(status: FirstRunStatusPayload): boolean {
  if (status.firstRun?.phase !== 'processing') return false;
  const path = status.firstRun.starterPath;
  const waitingForCapture =
    (path === 'email' || isConnectorStarterPath(path)) && !status.record?.emailArrived;
  return (
    waitingForCapture || !status.record?.processingSteps.some((step) => step.status === 'failed')
  );
}

export function pollFirstRun(
  initial: FirstRunStatusPayload,
  callbacks: {
    update: (status: FirstRunStatusPayload) => void;
    navigate: (destination: string) => void;
    refresh: () => void;
  },
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let delay = INITIAL_DELAY_MS;
  let lastProgress = progressKey(initial);
  let stopped = false;

  function pause() {
    clearTimeout(timer);
    request?.abort();
  }

  function stop() {
    stopped = true;
    pause();
    document.removeEventListener('visibilitychange', onVisibility);
  }

  function schedule(ms: number) {
    clearTimeout(timer);
    if (!stopped && !document.hidden) timer = setTimeout(() => void read(), ms);
  }

  function onVisibility() {
    if (document.hidden) pause();
    else schedule(0);
  }

  async function read() {
    if (stopped || document.hidden) return;
    if (request) {
      // The aborted fetch still owns the slot until it settles.
      schedule(INITIAL_DELAY_MS);
      return;
    }
    const controller = new AbortController();
    request = controller;
    const timeoutStatus = { expired: false };
    function wasAborted() {
      return controller.signal.aborted;
    }
    const timeout = setTimeout(() => {
      timeoutStatus.expired = true;
      controller.abort();
    }, 10_000);
    try {
      const response = await fetch('/api/onboarding/first-run', {
        cache: 'no-store',
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (wasAborted()) return;
      if ([401, 403, 428].includes(response.status)) {
        stop();
        callbacks.refresh();
        return;
      }
      if (!response.ok) throw new Error('First-run status unavailable');
      const status = (await response.json()) as FirstRunStatusPayload;
      if (wasAborted()) return;
      if (status.teamId !== initial.teamId) {
        stop();
        callbacks.refresh();
        return;
      }
      const phase = status.firstRun?.phase;
      if (!phase || !SETUP_SHELL_PHASES.includes(phase)) {
        stop();
        callbacks.navigate(phase ? firstRunDestination(phase) : '/app');
        return;
      }
      const progress = progressKey(status);
      delay = progress === lastProgress ? Math.min(delay * 2, MAX_DELAY_MS) : INITIAL_DELAY_MS;
      lastProgress = progress;
      callbacks.update(status);
      if (!firstRunPollingNeeded(status)) stop();
    } catch {
      if (!wasAborted()) delay = Math.min(delay * 2, MAX_DELAY_MS);
    } finally {
      clearTimeout(timeout);
      request = undefined;
      if (timeoutStatus.expired) delay = Math.min(delay * 2, MAX_DELAY_MS);
      if (timeoutStatus.expired || !wasAborted()) schedule(delay);
    }
  }

  document.addEventListener('visibilitychange', onVisibility);
  schedule(delay);
  return stop;
}
