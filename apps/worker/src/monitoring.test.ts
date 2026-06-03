import { afterEach, describe, expect, it, vi } from 'vitest';

const init = vi.fn();
const setTag = vi.fn();
const setScopeTag = vi.fn();
const captureException = vi.fn();
const flush = vi.fn();
const withScope = vi.fn((fn: (scope: { setTag: typeof setScopeTag }) => void) => {
  fn({ setTag: setScopeTag });
});
class MockUnrecoverableError extends Error {}

interface WorkerBeforeSendEvent {
  request?: {
    url?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  };
}

interface WorkerSentryInitOptions {
  beforeSend?: (event: WorkerBeforeSendEvent) => WorkerBeforeSendEvent;
}

vi.mock('@sentry/node', () => ({
  init,
  setTag,
  withScope,
  captureException,
  flush,
}));

vi.mock('bullmq', () => ({
  UnrecoverableError: MockUnrecoverableError,
}));

const ENV_BACKUP = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  vi.clearAllMocks();
});

describe('worker Sentry monitoring', () => {
  it('skips init without DSN', async () => {
    delete process.env.SENTRY_DSN;
    const monitoring = await import('#src/monitoring.js');

    expect(monitoring.initWorkerSentry()).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it('parses invalid sample rates as zero', async () => {
    const monitoring = await import('#src/monitoring.js');
    process.env.SENTRY_TRACES_SAMPLE_RATE = 'invalid';
    expect(monitoring.workerSentryInternals.sampleRate('SENTRY_TRACES_SAMPLE_RATE')).toBe(0);
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.1';
    expect(monitoring.workerSentryInternals.sampleRate('SENTRY_TRACES_SAMPLE_RATE')).toBe(0.1);
  });

  it('captures and flushes when configured', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.invalid/1';
    flush.mockResolvedValueOnce(true);
    const monitoring = await import('#src/monitoring.js');

    expect(monitoring.initWorkerSentry()).toBe(true);
    monitoring.captureWorkerException(new Error('boom'), { jobName: 'meeting-finalize' });
    await expect(monitoring.flushWorkerSentry()).resolves.toBe(true);

    expect(init).toHaveBeenCalledWith(expect.objectContaining({ sendDefaultPii: false }));
    expect(setTag).toHaveBeenCalledWith('component', 'worker');
    expect(setScopeTag).toHaveBeenCalledWith('jobName', 'meeting-finalize');
    expect(captureException).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(2000);
  });

  it('scrubs request auth material case-insensitively', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.invalid/1';
    const monitoring = await import('#src/monitoring.js');

    monitoring.initWorkerSentry();
    const initOptions = init.mock.calls[0]?.[0] as WorkerSentryInitOptions | undefined;
    const beforeSend = initOptions?.beforeSend;
    const event = beforeSend?.({
      request: {
        url: 'https://app.timeline.test/api/mcp/oauth/callback?code=secret&state=secret#frag',
        cookies: { session: 'secret' },
        headers: {
          Authorization: 'Bearer token',
          Cookie: 'session=secret',
          'X-Auth-Token': 'token',
          'x-request-id': 'req-1',
        },
      },
    });

    expect(event?.request?.url).toBe('https://app.timeline.test/api/mcp/oauth/callback');
    expect(event?.request?.cookies).toBeUndefined();
    expect(event?.request?.headers).toEqual({ 'x-request-id': 'req-1' });
  });

  it('redacts invite token path segments from request URLs', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.invalid/1';
    const monitoring = await import('#src/monitoring.js');

    monitoring.initWorkerSentry();
    const initOptions = init.mock.calls[0]?.[0] as WorkerSentryInitOptions | undefined;
    const event = initOptions?.beforeSend?.({
      request: {
        url: 'https://app.timeline.test/accept-invite/sensitive-token?invite=secret',
      },
    });

    expect(event?.request?.url).toBe('https://app.timeline.test/accept-invite/[redacted]');
  });

  it('captures terminal worker job failures only', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.invalid/1';
    const monitoring = await import('#src/monitoring.js');
    const err = new Error('job failed');

    monitoring.captureWorkerJobFailure(err, {
      id: 'job-1',
      name: 'transcribe',
      queueName: 'transcribe',
      attemptsMade: 1,
      opts: { attempts: 3 },
    });
    expect(captureException).not.toHaveBeenCalled();

    monitoring.captureWorkerJobFailure(err, {
      id: 'job-1',
      name: 'transcribe',
      queueName: 'transcribe',
      attemptsMade: 3,
      opts: { attempts: 3 },
    });

    expect(captureException).toHaveBeenCalledOnce();
    expect(setScopeTag).toHaveBeenCalledWith('component', 'worker_job');
    expect(setScopeTag).toHaveBeenCalledWith('queueName', 'transcribe');
    expect(setScopeTag).toHaveBeenCalledWith('attemptsMade', '3');
    expect(setScopeTag).not.toHaveBeenCalledWith('rawEventId', expect.any(String));
  });

  it('captures unrecoverable worker job failures immediately', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.invalid/1';
    const monitoring = await import('#src/monitoring.js');

    monitoring.captureWorkerJobFailure(new MockUnrecoverableError('bad input'), {
      id: 'job-2',
      name: 'extract',
      queueName: 'extract',
      attemptsMade: 1,
      opts: { attempts: 3 },
    });

    expect(captureException).toHaveBeenCalledOnce();
    expect(setScopeTag).toHaveBeenCalledWith('unrecoverable', 'true');
  });
});
