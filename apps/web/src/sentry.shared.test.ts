import { describe, expect, it } from 'vitest';

import type { ErrorEvent } from '@sentry/nextjs';

import { scrubSentryEvent, sentrySampleRate } from '@/sentry.shared';

describe('Sentry web config helpers', () => {
  it('defaults invalid sample rates to zero', () => {
    process.env.SENTRY_TRACES_SAMPLE_RATE = 'nope';
    expect(sentrySampleRate('SENTRY_TRACES_SAMPLE_RATE')).toBe(0);
    process.env.SENTRY_TRACES_SAMPLE_RATE = '2';
    expect(sentrySampleRate('SENTRY_TRACES_SAMPLE_RATE')).toBe(0);
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';
    expect(sentrySampleRate('SENTRY_TRACES_SAMPLE_RATE')).toBe(0.25);
  });

  it('scrubs request auth material', () => {
    const event = scrubSentryEvent({
      request: {
        cookies: { session: 'secret' },
        headers: {
          authorization: 'Bearer token',
          cookie: 'session=secret',
          'x-auth-token': 'token',
          'x-request-id': 'req-1',
        },
      },
    } as unknown as ErrorEvent);

    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers).toEqual({ 'x-request-id': 'req-1' });
  });
});
