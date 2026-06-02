import { describe, expect, it } from 'vitest';

import type { ErrorEvent } from '@sentry/nextjs';

import {
  parseSentrySampleRate,
  sanitizeRequestUrl,
  scrubSentryEvent,
  sentrySampleRate,
} from '@/sentry.shared';

describe('Sentry web config helpers', () => {
  it('defaults invalid sample rates to zero', () => {
    process.env.SENTRY_TRACES_SAMPLE_RATE = 'nope';
    expect(sentrySampleRate('SENTRY_TRACES_SAMPLE_RATE')).toBe(0);
    process.env.SENTRY_TRACES_SAMPLE_RATE = '2';
    expect(sentrySampleRate('SENTRY_TRACES_SAMPLE_RATE')).toBe(0);
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';
    expect(sentrySampleRate('SENTRY_TRACES_SAMPLE_RATE')).toBe(0.25);
    expect(parseSentrySampleRate(undefined)).toBe(0);
    expect(parseSentrySampleRate('0.5')).toBe(0.5);
  });

  it('scrubs request auth material', () => {
    const event = scrubSentryEvent({
      request: {
        url: 'https://app.timeline.test/api/integrations/github/callback?code=secret&state=secret#frag',
        cookies: { session: 'secret' },
        headers: {
          authorization: 'Bearer token',
          Authorization: 'Bearer other-token',
          cookie: 'session=secret',
          Cookie: 'session=other-secret',
          'x-auth-token': 'token',
          'X-Auth-Token': 'other-token',
          'x-request-id': 'req-1',
        },
      },
    } as unknown as ErrorEvent);

    expect(event.request?.url).toBe('https://app.timeline.test/api/integrations/github/callback');
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers).toEqual({ 'x-request-id': 'req-1' });
  });

  it('strips query strings and redacts invite tokens from request URLs', () => {
    expect(
      sanitizeRequestUrl(
        'https://app.timeline.test/accept-invite/sensitive-token?callbackUrl=/app#fragment',
      ),
    ).toBe('https://app.timeline.test/accept-invite/[redacted]');
    expect(sanitizeRequestUrl('/accept-invite/sensitive-token?invite=secret')).toBe(
      '/accept-invite/[redacted]',
    );
  });
});
