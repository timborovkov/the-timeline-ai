import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
/**
 * Credential signup is the first legal clickwrap path. These tests ensure the
 * acceptance event shares the user/team transaction and that a failed evidence
 * write stops provisioning instead of leaving an accepted-looking account.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';

const fakes = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  cookieSet: vi.fn(),
  dbSelect: vi.fn(),
  dbTransaction: vi.fn(),
  hashPassword: vi.fn(),
  headers: vi.fn(),
  isLegalPublicationReady: vi.fn(),
  insertDefaultDigestDestination: vi.fn(),
  legalAcceptanceRequestMetadata: vi.fn(),
  recordCurrentLegalAcceptance: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  reportCaughtError: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendMessage: vi.fn(),
  signIn: vi.fn(),
  trackProductEventBestEffort: vi.fn(),
  verifyTurnstileToken: vi.fn(),
  withServerActionInstrumentation: vi.fn(
    (_operation: string, _options: unknown, callback: () => unknown) => Promise.resolve(callback()),
  ),
}));

// Keep this suite focused on signup; telemetry/header timing has its own tests.
await vi.mock(
  import.meta.resolve('@/lib/sentry-action'),
  () => ({
    runSentryServerAction: (_operation: string, callback: () => unknown) => callback(),
  }),
  () => import('@/lib/sentry-action'),
);

await vi.mock(
  import.meta.resolve('@sentry/nextjs'),
  () => ({
    withServerActionInstrumentation: fakes.withServerActionInstrumentation,
  }),
  () => import('@sentry/nextjs'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/messaging'),
  () => ({
    insertDefaultDigestDestination: fakes.insertDefaultDigestDestination,
    sendMessage: fakes.sendMessage,
  }),
  () => import('@timeline/shared/messaging'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/passwords'),
  () => ({ hashPassword: fakes.hashPassword }),
  () => import('@timeline/shared/passwords'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/rate-limit'),
  () => ({
    RATE_LIMITS: { signup: { limit: 5, windowMs: 60_000 } },
    checkRateLimit: fakes.checkRateLimit,
    rateLimitKey: (...parts: string[]) => parts.join(':'),
  }),
  () => import('@timeline/shared/rate-limit'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/slug'),
  () => ({
    buildInboundEmail: (slug: string) => `${slug}@inbound.test`,
    randomSlugSuffix: () => 'legal',
    slugify: (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  }),
  () => import('@timeline/shared/slug'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({
    ACTIVE_TEAM_COOKIE: 'timeline_active_team',
    activeTeamCookieOptions: () => ({ httpOnly: true, path: '/', secure: true }),
    serializeActiveTeamCookie: (teamId: string) => `v2:${teamId}`,
  }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/analytics'),
  () => ({
    trackProductEventBestEffort: fakes.trackProductEventBestEffort,
  }),
  () => import('@/lib/analytics'),
);
await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: vi.fn(), signIn: fakes.signIn }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({
    db: { select: fakes.dbSelect, transaction: fakes.dbTransaction },
  }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/email-verification'),
  () => ({
    sendEmailVerification: fakes.sendEmailVerification,
  }),
  () => import('@/lib/email-verification'),
);
await vi.mock(
  import.meta.resolve('@/lib/legal'),
  () => ({
    legalAcceptanceRequestMetadata: fakes.legalAcceptanceRequestMetadata,
    recordCurrentLegalAcceptance: fakes.recordCurrentLegalAcceptance,
  }),
  () => import('@/lib/legal'),
);
await vi.mock(
  import.meta.resolve('@/lib/legal-publication'),
  () => ({
    isLegalPublicationReady: fakes.isLegalPublicationReady,
  }),
  () => import('@/lib/legal-publication'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: fakes.reportCaughtError }),
  () => import('@/lib/sentry-report'),
);
await vi.mock(
  import.meta.resolve('@/lib/site-url'),
  () => ({ getSiteUrl: () => 'https://timeline.test' }),
  () => import('@/lib/site-url'),
);
await vi.mock(
  import.meta.resolve('@/lib/turnstile'),
  () => ({
    turnstileHostnameFromHeaders: () => 'timeline.test',
    verifyTurnstileToken: fakes.verifyTurnstileToken,
  }),
  () => import('@/lib/turnstile'),
);
await vi.mock(
  import.meta.resolve('next/headers'),
  () => ({
    cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: fakes.cookieSet }),
    headers: fakes.headers,
  }),
  () => import('next/headers'),
);
await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: fakes.redirect,
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('next-auth'),
  () => ({
    AuthError: class AuthError extends Error {},
  }),
  () => import('next-auth'),
);

const { PRIVACY_VERSION, TERMS_VERSION } = await import('@timeline/shared/legal-versions');
const { signUpAction } = await import('@/app/actions/auth');

function form(includeAcceptance = true): FormData {
  const result = new FormData();
  result.set('name', 'Legal User');
  result.set('email', 'legal-user@example.test');
  result.set('password', 'safe-password');
  result.set('termsVersion', TERMS_VERSION);
  result.set('privacyVersion', PRIVACY_VERSION);
  if (includeAcceptance) result.set('legalAccepted', 'on');
  return result;
}

function selectChain(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(rows) })),
    })),
  };
}

const BILLING_ACCOUNT_CREATED_AT = new Date('2026-08-01T00:00:00.000Z');

function createSignupTransaction() {
  const insertedValues: unknown[] = [];
  let insertIndex = 0;
  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
    })),
    insert: vi.fn(() => {
      const index = insertIndex++;
      return {
        values: vi.fn((values: unknown) => {
          insertedValues.push(values);
          return {
            returning: vi
              .fn()
              .mockResolvedValue(
                index === 0 ? [{ id: USER_ID }] : index === 1 ? [{ id: TEAM_ID }] : [],
              ),
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue(
                index === 3
                  ? [
                      {
                        teamId: TEAM_ID,
                        planId: 'free',
                        createdAt: BILLING_ACCOUNT_CREATED_AT,
                      },
                    ]
                  : [],
              ),
            })),
          };
        }),
      };
    }),
  };
  return { insertedValues, tx };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.headers.mockResolvedValue(
    new Headers({ 'cf-connecting-ip': '203.0.113.10', 'user-agent': 'Signup browser' }),
  );
  fakes.legalAcceptanceRequestMetadata.mockReturnValue({
    ipAddress: '203.0.113.10',
    userAgent: 'Signup browser',
  });
  fakes.isLegalPublicationReady.mockReturnValue(true);
  fakes.checkRateLimit.mockResolvedValue({ ok: true });
  fakes.verifyTurnstileToken.mockResolvedValue(true);
  fakes.hashPassword.mockResolvedValue('password-hash');
  fakes.recordCurrentLegalAcceptance.mockResolvedValue({ id: 'acceptance-1' });
  fakes.insertDefaultDigestDestination.mockResolvedValue(undefined);
  fakes.sendMessage.mockResolvedValue({ ok: true });
  fakes.sendEmailVerification.mockResolvedValue({ ok: true });
  fakes.signIn.mockResolvedValue(undefined);
  let selectIndex = 0;
  fakes.dbSelect.mockImplementation(() => {
    const rows = selectIndex++ === 0 ? [] : [{ name: "Legal User's Team" }];
    return selectChain(rows);
  });
});

describe('signUpAction legal acceptance', () => {
  it('does not provision an account while legal publication is blocked', async () => {
    fakes.isLegalPublicationReady.mockReturnValue(false);

    await expect(signUpAction({}, form())).resolves.toEqual({
      error:
        'Account creation is temporarily unavailable while our legal publication review is completed.',
    });
    expect(fakes.headers).not.toHaveBeenCalled();
    expect(fakes.dbTransaction).not.toHaveBeenCalled();
    expect(fakes.recordCurrentLegalAcceptance).not.toHaveBeenCalled();
  });

  it('rejects a form rendered for older legal documents before provisioning', async () => {
    const staleForm = form();
    staleForm.set('termsVersion', 'older-terms');

    await expect(signUpAction({}, staleForm)).resolves.toEqual({
      error:
        'The Terms of Use or Privacy Policy changed. Reload this page and review the current versions before accepting.',
    });
    expect(fakes.dbTransaction).not.toHaveBeenCalled();
    expect(fakes.recordCurrentLegalAcceptance).not.toHaveBeenCalled();
  });

  it('rejects signup without affirmative acceptance before provisioning', async () => {
    const result = await signUpAction({}, form(false));

    expect(result.error).toBeTruthy();

    expect(fakes.dbTransaction).not.toHaveBeenCalled();
    expect(fakes.recordCurrentLegalAcceptance).not.toHaveBeenCalled();
  });

  it('records acceptance in the same transaction as the new user and team', async () => {
    const transaction = createSignupTransaction();
    fakes.dbTransaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback(transaction.tx),
    );

    await expect(signUpAction({}, form())).rejects.toThrow('NEXT_REDIRECT:/app');

    expect(fakes.recordCurrentLegalAcceptance).toHaveBeenCalledWith(transaction.tx, {
      userId: USER_ID,
      source: 'credentials_signup',
      ipAddress: '203.0.113.10',
      userAgent: 'Signup browser',
    });
    expect(transaction.insertedValues).toContainEqual({
      name: 'Legal User',
      email: 'legal-user@example.test',
      passwordHash: 'password-hash',
    });
    expect(transaction.insertedValues).toContainEqual({
      teamId: TEAM_ID,
      planId: 'free',
      billingState: 'restricted',
      spendCapCents: 0,
      shadowBilling: true,
    });
    expect(transaction.insertedValues).toContainEqual({
      teamId: TEAM_ID,
      planId: 'free',
      effectiveAt: BILLING_ACCOUNT_CREATED_AT,
    });
    expect(fakes.cookieSet).toHaveBeenCalledWith(
      'timeline_active_team',
      `v2:${TEAM_ID}`,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', teamId: TEAM_ID, userId: USER_ID },
      'account_registered',
      { source: 'credentials', joinedViaInvite: false },
    );
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', teamId: TEAM_ID, userId: USER_ID },
      'team_created',
      { source: 'signup' },
    );
  });

  it('stops team provisioning when the acceptance event cannot be recorded', async () => {
    const transaction = createSignupTransaction();
    fakes.dbTransaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback(transaction.tx),
    );
    fakes.recordCurrentLegalAcceptance.mockRejectedValue(new Error('acceptance write failed'));

    await expect(signUpAction({}, form())).resolves.toEqual({
      error: 'Could not create account. Please try again.',
    });

    expect(transaction.tx.insert).toHaveBeenCalledTimes(1);
    expect(fakes.cookieSet).not.toHaveBeenCalled();
    expect(fakes.signIn).not.toHaveBeenCalled();
  });
});
