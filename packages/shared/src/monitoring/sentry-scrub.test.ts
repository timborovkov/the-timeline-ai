import { describe, expect, it } from 'vitest';

import {
  RESTRICTED_SENTRY_DATA_COLLECTION,
  redactTelegramBotTokenInUrl,
  sanitizeRequestUrl,
  sanitizeSpanName,
  scrubSentryBreadcrumb,
  scrubSentryRequestEvent,
  scrubSentrySpan,
} from '#src/monitoring/sentry-scrub.js';

describe('Sentry scrubber', () => {
  it('removes the complete request-header map and request cookies', () => {
    const event = scrubSentryRequestEvent({
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
          referer: 'https://app.timeline.test/accept-invite/private?token=secret',
          'x-forwarded-for': '203.0.113.10',
          'x-unknown-secret': 'must-not-reach-sentry',
        },
      },
    });

    expect(event.request.url).toBe('https://app.timeline.test/api/integrations/github/callback');
    expect(event.request.cookies).toBeUndefined();
    expect(event.request.headers).toBeUndefined();
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

  it('redacts Telegram bot tokens embedded in Bot API URLs', () => {
    expect(
      redactTelegramBotTokenInUrl(
        'https://api.telegram.org/bot123456:AAExampleTokenValue_for-tests/setWebhook',
      ),
    ).toBe('https://api.telegram.org/bot[redacted]/setWebhook');
    expect(
      sanitizeRequestUrl(
        'https://api.telegram.org/bot123456:AAExampleTokenValue_for-tests/getWebhookInfo',
      ),
    ).toBe('https://api.telegram.org/bot[redacted]/getWebhookInfo');
    expect(
      redactTelegramBotTokenInUrl(
        'https://api.telegram.org/file/bot123456:AAExampleTokenValue_for-tests/voice/file_1.oga',
      ),
    ).toBe('https://api.telegram.org/file/bot[redacted]/voice/file_1.oga');
  });

  it('scrubs Telegram bot tokens from HTTP breadcrumbs', () => {
    const event = scrubSentryRequestEvent({
      breadcrumbs: [
        {
          message: 'https://api.telegram.org/bot123456:AAExampleTokenValue_for-tests/setWebhook',
          data: {
            url: 'https://api.telegram.org/bot123456:AAExampleTokenValue_for-tests/setWebhook',
            'http.method': 'POST',
          },
        },
      ],
    });

    expect(event.breadcrumbs[0]?.message).toBe('https://api.telegram.org/bot[redacted]/setWebhook');
    expect(event.breadcrumbs[0]?.data).toEqual({
      url: 'https://api.telegram.org/bot[redacted]/setWebhook',
      'http.method': 'POST',
    });
    expect(
      scrubSentryBreadcrumb({
        data: { url: 'https://api.telegram.org/bot123456:AAExampleTokenValue_for-tests/getMe' },
      }).data.url,
    ).toBe('https://api.telegram.org/bot[redacted]/getMe');
  });

  it('sanitizes URL-bearing navigation and HTTP breadcrumb fields', () => {
    expect(
      scrubSentryBreadcrumb({
        data: {
          url: 'https://app.timeline.test/api/auth/callback/github?code=secret&state=secret',
          from: '/accept-invite/private-invite-token?returnTo=/app',
          to: '/verify-email/private-verification-token?email=person@example.com',
          href: 'https://storage.timeline.test/team/private-document.pdf?signature=secret',
          method: 'GET',
        },
      }).data,
    ).toEqual({
      url: 'https://app.timeline.test/api/auth/callback/github',
      from: '/accept-invite/[redacted]',
      to: '/verify-email/[redacted]',
      href: 'https://storage.timeline.test/team/private-document.pdf',
      method: 'GET',
    });
  });

  it('scrubs streamed span names and URL attributes without sending query or header data', () => {
    const span = scrubSentrySpan({
      name: 'GET /app/search?q=private',
      attributes: {
        'http.url': 'https://app.timeline.test/app/search?q=private#frag',
        'http.target': '/accept-invite/sensitive-token?invite=secret',
        'http.request.header.authorization': 'Bearer token',
        'http.request.header.cookie': 'session=secret',
        'url.query': 'q=private',
        'http.method': 'GET',
        'sentry.op': 'http.server',
      },
    });

    expect(span.name).toBe('GET /app/search');
    expect(span.attributes).toEqual({
      'http.url': 'https://app.timeline.test/app/search',
      'http.target': '/accept-invite/[redacted]',
      'http.method': 'GET',
      'sentry.op': 'http.server',
    });
    expect(sanitizeSpanName('https://app.timeline.test/verify-email/secret?x=1')).toBe(
      'https://app.timeline.test/verify-email/[redacted]',
    );
  });

  it('restricts Sentry 11 dataCollection to the v10 sendDefaultPii:false shape', () => {
    expect(RESTRICTED_SENTRY_DATA_COLLECTION).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
        response: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
      },
      httpBodies: [],
      urlQueryParams: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      graphQL: { document: false, variables: false },
      queues: false,
      stackFrameVariables: false,
    });
  });
});
