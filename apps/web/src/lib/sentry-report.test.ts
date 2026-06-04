import * as Sentry from '@sentry/nextjs';
import { describe, expect, it, vi } from 'vitest';

import { reportCaughtError, reportHandledEvent, shouldReportToSentry } from '@/lib/sentry-report';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
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

  it('captures handled warning events with safe tags only', () => {
    reportHandledEvent({
      message: 'recall_status_svix_verification_failed',
      surface: 'api',
      operation: 'recall_status_svix_verification',
      tags: { reason: 'bad_signature', empty: undefined, enabled: true },
    });

    expect(Sentry.captureMessage).toHaveBeenCalledWith('recall_status_svix_verification_failed', {
      level: 'warning',
      tags: {
        surface: 'api',
        operation: 'recall_status_svix_verification',
        reason: 'bad_signature',
        enabled: 'true',
      },
    });
  });
});
