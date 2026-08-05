import { describe, expect, it } from 'vitest';

import type { ErrorEvent } from '@sentry/nextjs';

import {
  parseSentrySampleRate,
  sanitizeRequestUrl,
  scrubSentryEvent,
  sentrySampleRate,
  shouldDropBrowserExtensionEvent,
  shouldDropMalformedMultipartFormDataEvent,
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

    expect(event).not.toBeNull();
    expect(event?.request?.url).toBe('https://app.timeline.test/api/integrations/github/callback');
    expect(event?.request?.cookies).toBeUndefined();
    expect(event?.request?.headers).toEqual({ 'x-request-id': 'req-1' });
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

  it('drops MetaMask browser extension errors injected into app pages', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'Error',
            value: 'MetaMask extension not found',
            stacktrace: {
              frames: [{ filename: 'app:///scripts/inpage.js', lineno: 4, in_app: true }],
            },
          },
          {
            type: 'i',
            value: 'Failed to connect to MetaMask',
            stacktrace: {
              frames: [{ filename: 'app:///scripts/inpage.js', lineno: 7, in_app: true }],
            },
          },
        ],
      },
    } as unknown as ErrorEvent;

    expect(shouldDropBrowserExtensionEvent(event)).toBe(true);
    expect(scrubSentryEvent(event)).toBeNull();
  });

  it('keeps matching app errors when the stack is not from a browser extension', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Failed to connect to MetaMask',
            stacktrace: {
              frames: [{ filename: '/app/chat/page.js', lineno: 12, in_app: true }],
            },
          },
        ],
      },
    } as unknown as ErrorEvent;

    expect(shouldDropBrowserExtensionEvent(event)).toBe(false);
    expect(scrubSentryEvent(event)).toBe(event);
  });

  it('drops malformed multipart FormData parse errors on not-found', () => {
    const event = {
      transaction: 'POST /_not-found/page',
      exception: {
        values: [{ type: 'TypeError', value: 'Failed to parse body as FormData.' }],
      },
    } as unknown as ErrorEvent;

    expect(shouldDropMalformedMultipartFormDataEvent(event)).toBe(true);
    expect(scrubSentryEvent(event)).toBeNull();
  });

  it('drops FormData parse errors whose cause is a missing multipart boundary', () => {
    const event = {
      transaction: 'POST /app',
      exception: {
        values: [{ type: 'TypeError', value: 'Failed to parse body as FormData.' }],
      },
    } as unknown as ErrorEvent;
    const originalException = Object.assign(new TypeError('Failed to parse body as FormData.'), {
      cause: new TypeError('no boundary found in multipart body'),
    });

    expect(shouldDropMalformedMultipartFormDataEvent(event, { originalException })).toBe(true);
    expect(scrubSentryEvent(event, { originalException })).toBeNull();
  });

  it('keeps FormData parse errors on real routes without a boundary cause', () => {
    const event = {
      transaction: 'POST /app',
      exception: {
        values: [{ type: 'TypeError', value: 'Failed to parse body as FormData.' }],
      },
    } as unknown as ErrorEvent;

    expect(shouldDropMalformedMultipartFormDataEvent(event)).toBe(false);
    expect(scrubSentryEvent(event)).toBe(event);
  });

  it('redacts Telegram bot tokens from breadcrumbs before send', () => {
    const event = scrubSentryEvent({
      breadcrumbs: [
        {
          data: {
            url: 'https://api.telegram.org/bot123456:AAExampleTokenValue_for-tests/setWebhook',
          },
        },
      ],
    } as unknown as ErrorEvent);

    expect(event?.breadcrumbs?.[0]?.data?.url).toBe(
      'https://api.telegram.org/bot[redacted]/setWebhook',
    );
  });
});
