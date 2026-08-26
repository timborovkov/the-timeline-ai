import { describe, expect, it } from 'vitest';

import {
  redactTelegramBotTokenInUrl,
  sanitizeRequestUrl,
  scrubSentryBreadcrumb,
  scrubSentryRequestEvent,
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
});
