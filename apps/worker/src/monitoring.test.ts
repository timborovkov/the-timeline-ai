import { afterEach, describe, expect, it, vi } from 'vitest';

const init = vi.fn();
const setTag = vi.fn();
const setScopeTag = vi.fn();
const setScopeContext = vi.fn();
const captureException = vi.fn();
const flush = vi.fn();
const withScope = vi.fn(
  (fn: (scope: { setTag: typeof setScopeTag; setContext: typeof setScopeContext }) => void) => {
    fn({ setTag: setScopeTag, setContext: setScopeContext });
  },
);
class MockUnrecoverableError extends Error {}

interface WorkerBeforeSendEvent {
  request?: {
    url?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  };
  breadcrumbs?: {
    message?: string;
    data?: Record<string, unknown>;
  }[];
}

interface WorkerBreadcrumb {
  message?: string;
  data?: Record<string, unknown>;
}

interface WorkerSentryInitOptions {
  beforeSend?: (event: WorkerBeforeSendEvent) => WorkerBeforeSendEvent;
  beforeBreadcrumb?: (breadcrumb: WorkerBreadcrumb) => WorkerBreadcrumb;
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

  it('tags AI failures by operation and model without prompt data', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.invalid/1';
    const monitoring = await import('#src/monitoring.js');
    const err = Object.assign(new Error('provider down'), {
      timelineAi: true,
      operation: 'llm.embed',
      model: 'openrouter/embed',
      causeName: 'AI_APICallError',
      causeMessage: 'OpenRouter 503 temporarily unavailable',
      prompt: 'must not be tagged',
    });

    monitoring.captureWorkerException(err, { component: 'worker_job' });

    expect(captureException).toHaveBeenCalledOnce();
    expect(setScopeTag).toHaveBeenCalledWith('aiOperation', 'llm.embed');
    expect(setScopeTag).toHaveBeenCalledWith('aiModel', 'openrouter/embed');
    expect(setScopeTag).toHaveBeenCalledWith('aiCauseName', 'AI_APICallError');
    expect(setScopeContext).toHaveBeenCalledWith('ai', {
      causeMessage: 'OpenRouter 503 temporarily unavailable',
    });
    expect(setScopeTag).not.toHaveBeenCalledWith('prompt', expect.anything());
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

  it('redacts Telegram bot tokens from breadcrumbs', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.invalid/1';
    const monitoring = await import('#src/monitoring.js');

    monitoring.initWorkerSentry();
    const initOptions = init.mock.calls[0]?.[0] as WorkerSentryInitOptions | undefined;
    const breadcrumb = initOptions?.beforeBreadcrumb?.({
      data: {
        url: 'https://api.telegram.org/bot123456:AAExampleTokenValue_for-tests/setWebhook',
      },
    });
    const event = initOptions?.beforeSend?.({
      breadcrumbs: [
        {
          data: {
            url: 'https://api.telegram.org/bot123456:AAExampleTokenValue_for-tests/getWebhookInfo',
          },
        },
      ],
    });

    expect(breadcrumb?.data?.url).toBe('https://api.telegram.org/bot[redacted]/setWebhook');
    expect(event?.breadcrumbs?.[0]?.data?.url).toBe(
      'https://api.telegram.org/bot[redacted]/getWebhookInfo',
    );
  });

  it('captures retrying and terminal worker job failures with artifact tags', async () => {
    process.env.SENTRY_DSN = 'https://example@sentry.invalid/1';
    const monitoring = await import('#src/monitoring.js');
    const err = new Error('job failed');

    monitoring.captureWorkerJobFailure(
      err,
      {
        id: 'job-1',
        name: 'transcribe',
        queueName: 'transcribe',
        attemptsMade: 1,
        opts: { attempts: 3 },
      },
      { rawEventId: 'raw-1', teamId: 'team-1' },
    );
    expect(captureException).toHaveBeenCalledOnce();
    expect(setScopeTag).toHaveBeenCalledWith('terminal', 'false');

    monitoring.captureWorkerJobFailure(
      err,
      {
        id: 'job-1',
        name: 'transcribe',
        queueName: 'transcribe',
        attemptsMade: 3,
        opts: { attempts: 3 },
      },
      { rawEventId: 'raw-1', teamId: 'team-1' },
    );

    expect(captureException).toHaveBeenCalledTimes(2);
    expect(setScopeTag).toHaveBeenCalledWith('component', 'worker_job');
    expect(setScopeTag).toHaveBeenCalledWith('queueName', 'transcribe');
    expect(setScopeTag).toHaveBeenCalledWith('attemptsMade', '3');
    expect(setScopeTag).toHaveBeenCalledWith('terminal', 'true');
    expect(setScopeTag).toHaveBeenCalledWith('rawEventId', 'raw-1');
    expect(setScopeTag).toHaveBeenCalledWith('teamId', 'team-1');
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
