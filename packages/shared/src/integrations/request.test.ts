import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  providerResponseLimit,
  providerRetryAt,
  withProviderRequestContext,
} from '#src/integrations/request.js';

describe('provider quota responses', () => {
  it('honors both Retry-After forms', () => {
    const now = Date.parse('2026-10-26T10:00:00Z');
    expect(providerRetryAt(new Headers({ 'retry-after': '120' }), now).getTime()).toBe(
      now + 120_000,
    );
    expect(
      providerRetryAt(
        new Headers({ 'retry-after': 'Mon, 26 Oct 2026 10:05:00 GMT' }),
        now,
      ).getTime(),
    ).toBe(now + 300_000);
  });
  it('honors provider-specific reset headers when Retry-After is absent', () => {
    const now = Date.parse('2026-10-26T10:00:00Z');
    expect(
      providerRetryAt(
        new Headers({ 'x-ratelimit-requests-reset': String(now + 3600_000) }),
        now,
      ).getTime(),
    ).toBe(now + 3600_000);
    expect(
      providerRetryAt(
        new Headers({ 'x-sentry-rate-limit-reset': String((now + 60_000) / 1000) }),
        now,
      ).getTime(),
    ).toBe(now + 60_000);
  });
  it.each(['30', 'Mon, 26 Oct 2026 10:00:30 GMT'])(
    'honors a later quota reset alongside Retry-After %s',
    (retryAfter) => {
      const now = Date.parse('2026-10-26T10:00:00Z');
      expect(
        providerRetryAt(
          new Headers({
            'retry-after': retryAfter,
            'x-ratelimit-requests-reset': String(now + 3600_000),
          }),
          now,
        ).getTime(),
      ).toBe(now + 3600_000);
    },
  );
  it('does not shorten Retry-After to an earlier quota reset', () => {
    const now = Date.parse('2026-10-26T10:00:00Z');
    expect(
      providerRetryAt(
        new Headers({
          'retry-after': '120',
          'x-ratelimit-reset': String((now + 30_000) / 1000),
        }),
        now,
      ).getTime(),
    ).toBe(now + 120_000);
  });
  it('distinguishes quota exhaustion from access denial', () => {
    expect(
      providerResponseLimit('google_drive', new Response('', { status: 403 }), 'permission denied'),
    ).toBeNull();
    expect(
      providerResponseLimit(
        'google_drive',
        new Response('', { status: 403 }),
        'userRateLimitExceeded',
      )?.code,
    ).toBe('provider_rate_limited');
  });
  it('recognizes GraphQL quota failures on HTTP 200 and retains account scope', () => {
    const error = withProviderRequestContext(
      { provider: 'linear', externalAccountId: 'org', purpose: 'recovery' },
      () =>
        providerResponseLimit(
          'linear',
          new Response(),
          '{"errors":[{"extensions":{"code":"RATELIMITED"}}]}',
        ),
    );
    expect(error?.externalAccountId).toBe('org');
    expect(
      providerResponseLimit('linear', new Response(), '{"data":{"title":"rate limit"}}'),
    ).toBeNull();
  });
});
