import { describe, expect, it } from 'vitest';

import {
  attentionCategoryForHealthKind,
  classifyIntegrationHealthFailure,
  formatHealthPauseNotice,
  healthPauseAction,
  highestCountedHealthKind,
  integrationHealthPauseAfterMs,
} from '#src/integrations/health.js';

describe('integration health classification', () => {
  it('counts 401/403/404 and lost GitHub access as access_revoked', () => {
    expect(classifyIntegrationHealthFailure('GitHub GET /repos/acme/app: 403 forbidden')).toEqual({
      counted: true,
      kind: 'access_revoked',
    });
    expect(
      classifyIntegrationHealthFailure('GitHub GET /repos/acme/app failed with status 404'),
    ).toEqual({
      counted: true,
      kind: 'access_revoked',
    });
    expect(classifyIntegrationHealthFailure('Resource not accessible by integration')).toEqual({
      counted: true,
      kind: 'access_revoked',
    });
    expect(classifyIntegrationHealthFailure('Bad credentials')).toEqual({
      counted: true,
      kind: 'access_revoked',
    });
    expect(attentionCategoryForHealthKind('access_revoked')).toBe('access_revoked');
  });

  it('counts connectivity failures and ignores rate limits and 5xx', () => {
    expect(classifyIntegrationHealthFailure('TypeError fetch failed code=ETIMEDOUT')).toEqual({
      counted: true,
      kind: 'connectivity',
    });
    expect(classifyIntegrationHealthFailure('connect ECONNREFUSED 140.82.112.6:443')).toEqual({
      counted: true,
      kind: 'connectivity',
    });
    expect(classifyIntegrationHealthFailure('github_rate_limited retry later')).toEqual({
      counted: false,
      reason: 'rate_limited',
    });
    expect(classifyIntegrationHealthFailure('GitHub GET /repos/acme/app: 503')).toEqual({
      counted: false,
      reason: 'transient',
    });
    expect(classifyIntegrationHealthFailure('GitHub temporarily overloaded')).toEqual({
      counted: false,
      reason: 'transient',
    });
  });

  it('counts expired tokens as auth and gone resources as permanent', () => {
    expect(classifyIntegrationHealthFailure('No tokens — reconnect required')).toEqual({
      counted: true,
      kind: 'auth',
    });
    expect(
      classifyIntegrationHealthFailure(
        'Pull requests read permission required; update GitHub App repository permissions and reconnect',
      ),
    ).toEqual({ counted: true, kind: 'auth' });
    expect(classifyIntegrationHealthFailure('410 Gone: repository permanently deleted')).toEqual({
      counted: true,
      kind: 'permanent',
    });
    expect(classifyIntegrationHealthFailure('account suspended')).toEqual({
      counted: true,
      kind: 'permanent',
    });
  });

  it('picks the most severe counted kind from mixed partial failures', () => {
    expect(
      highestCountedHealthKind([
        'GitHub temporarily overloaded',
        'fetch failed ECONNREFUSED',
        'GitHub GET /repos/acme/app: 403',
      ]),
    ).toBe('access_revoked');
    expect(highestCountedHealthKind(['503', 'rate limited'])).toBeNull();
  });
});

describe('integration health pause copy', () => {
  it('builds a minimal Paused notice and reconnect vs resume action', () => {
    expect(formatHealthPauseNotice({ provider: 'github', kind: 'access_revoked' })).toBe(
      'Paused: GitHub access was revoked.',
    );
    expect(
      formatHealthPauseNotice({
        provider: 'github',
        kind: 'connectivity',
        firstFailedAt: new Date('2026-06-25T12:00:00.000Z'),
        now: new Date('2026-06-28T12:00:00.000Z'),
      }),
    ).toBe("Paused: GitHub hasn't responded for 3 days.");
    expect(healthPauseAction('access_revoked')).toEqual({
      action: 'reconnect',
      href: '/app/me/connections',
      label: 'Reconnect',
    });
    expect(healthPauseAction('connectivity')).toEqual({
      action: 'resume',
      label: 'Resume',
    });
    expect(integrationHealthPauseAfterMs(72)).toBe(72 * 60 * 60 * 1000);
  });
});
