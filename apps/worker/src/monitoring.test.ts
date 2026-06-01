import { afterEach, describe, expect, it, vi } from 'vitest';

const init = vi.fn();
const setTag = vi.fn();
const setScopeTag = vi.fn();
const captureException = vi.fn();
const flush = vi.fn();
const withScope = vi.fn((fn: (scope: { setTag: typeof setScopeTag }) => void) => {
  fn({ setTag: setScopeTag });
});

vi.mock('@sentry/node', () => ({
  init,
  setTag,
  withScope,
  captureException,
  flush,
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
});
