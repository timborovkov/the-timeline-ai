import * as Sentry from '@sentry/nextjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  reportCaughtError,
  reportHandledEvent,
  resetHandledEventThrottleForTests,
  shouldReportToSentry,
} from '@/lib/sentry-report';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

describe('Sentry caught-error reporting', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    resetHandledEventThrottleForTests();
  });

  it('reports unexpected errors passed to the caught-error helper', () => {
    expect(shouldReportToSentry(new Error('database down'))).toBe(true);
  });

  it('reports expected Auth.js credentials sign-in failures as handled warning events', () => {
    const err = Object.assign(
      new Error('Read more at https://errors.authjs.dev#credentialssignin'),
      {
        type: 'CredentialsSignin',
        code: 'credentials',
      },
    );

    expect(
      shouldReportToSentry(err, {
        surface: 'server_action',
        operation: 'sign_in',
      }),
    ).toBe(false);

    reportCaughtError(err, {
      surface: 'server_action',
      operation: 'sign_in',
    });

    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith('auth_credentials_signin_failed', {
      level: 'warning',
      tags: {
        surface: 'server_action',
        operation: 'sign_in',
        reason: 'invalid_credentials',
      },
    });
  });

  it('does not relabel rate-limited credentials sign-in as invalid credentials', () => {
    const err = Object.assign(new Error('Rate limited'), {
      type: 'CredentialsSignin',
      code: 'rate_limited',
    });

    expect(
      shouldReportToSentry(err, {
        surface: 'server_action',
        operation: 'sign_in',
      }),
    ).toBe(false);

    reportCaughtError(err, {
      surface: 'server_action',
      operation: 'sign_in',
    });

    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('reports credentials sign-in failures outside the expected invalid-login path', () => {
    const err = Object.assign(
      new Error('Read more at https://errors.authjs.dev#credentialssignin'),
      {
        type: 'CredentialsSignin',
        code: 'credentials',
      },
    );

    reportCaughtError(err, {
      surface: 'server_action',
      operation: 'sign_up_auto_sign_in',
    });

    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      level: 'error',
      tags: {
        surface: 'server_action',
        operation: 'sign_up_auto_sign_in',
      },
    });
  });

  it('reports custom credentials sign-in codes as unexpected errors', () => {
    const err = Object.assign(new Error('Account locked'), {
      type: 'CredentialsSignin',
      code: 'account_locked',
    });

    reportCaughtError(err, {
      surface: 'server_action',
      operation: 'sign_in',
    });

    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      level: 'error',
      tags: {
        surface: 'server_action',
        operation: 'sign_in',
      },
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
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

  it('throttles repeated handled events and reports the suppressed count on the next window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T00:00:00Z'));

    for (let i = 0; i < 12; i += 1) {
      reportHandledEvent({
        message: 'telegram_webhook_forbidden',
        surface: 'api',
        operation: 'telegram_webhook_auth',
        tags: { reason: 'forbidden' },
      });
    }

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(10);

    vi.setSystemTime(new Date('2026-06-04T00:01:01Z'));
    reportHandledEvent({
      message: 'telegram_webhook_forbidden',
      surface: 'api',
      operation: 'telegram_webhook_auth',
      tags: { reason: 'forbidden' },
    });

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(11);
    expect(Sentry.captureMessage).toHaveBeenLastCalledWith('telegram_webhook_forbidden', {
      level: 'warning',
      tags: {
        surface: 'api',
        operation: 'telegram_webhook_auth',
        reason: 'forbidden',
        suppressedCount: '2',
      },
    });
  });
});
