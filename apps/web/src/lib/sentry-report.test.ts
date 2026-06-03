import * as Sentry from '@sentry/nextjs';
import { describe, expect, it, vi } from 'vitest';

import { reportCaughtError, shouldReportToSentry } from '@/lib/sentry-report';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

describe('Sentry caught-error reporting', () => {
  it('ignores expected framework and domain control-flow errors', () => {
    expect(shouldReportToSentry(new Error('already-member'))).toBe(false);
    expect(
      shouldReportToSentry(Object.assign(new Error('redirect'), { digest: 'NEXT_REDIRECT;/' })),
    ).toBe(false);
    expect(shouldReportToSentry(new Error('database down'))).toBe(true);
  });

  it('captures unexpected errors with safe tags only', () => {
    const err = new Error('database down');

    reportCaughtError(err, {
      surface: 'api',
      operation: 'searchEvents',
      tags: { provider: 'qdrant', empty: undefined, enabled: true },
    });

    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      level: 'error',
      tags: {
        surface: 'api',
        operation: 'searchEvents',
        provider: 'qdrant',
        enabled: 'true',
      },
    });
  });
});
