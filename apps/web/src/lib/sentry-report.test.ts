import * as Sentry from '@sentry/nextjs';
import { describe, expect, it, vi } from 'vitest';

import { reportCaughtError, reportHandledEvent, shouldReportToSentry } from '@/lib/sentry-report';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

describe('Sentry caught-error reporting', () => {
  it('reports every error passed to the caught-error helper', () => {
    expect(shouldReportToSentry(new Error('already-member'))).toBe(true);
    expect(shouldReportToSentry(new Error('database down'))).toBe(true);
  });

  it('captures unexpected errors with safe tags only', () => {
    const err = Object.assign(new Error('database down'), {
      timelineAi: true,
      operation: 'llm.chatStructured',
      model: 'openrouter/test',
    });

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
        aiOperation: 'llm.chatStructured',
        aiModel: 'openrouter/test',
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
