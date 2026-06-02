import { describe, expect, it } from 'vitest';

import { sanitizeRequestUrl, scrubSentryRequestEvent } from '#src/monitoring/sentry-scrub.js';

describe('Sentry scrubber', () => {
  it('scrubs request auth material case-insensitively', () => {
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
        },
      },
    });

    expect(event.request.url).toBe('https://app.timeline.test/api/integrations/github/callback');
    expect(event.request.cookies).toBeUndefined();
    expect(event.request.headers).toEqual({ 'x-request-id': 'req-1' });
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
