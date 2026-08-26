import { PRIVACY_VERSION, TERMS_VERSION } from '@timeline/shared/legal-versions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { signUpAction } from '@/app/actions/auth';

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

vi.mock('@sentry/nextjs', () => ({
  withServerActionInstrumentation: fakes.withServerActionInstrumentation,
}));
vi.mock('@timeline/shared/messaging', () => ({
  insertDefaultDigestDestination: fakes.insertDefaultDigestDestination,
  sendMessage: fakes.sendMessage,
}));
vi.mock('@timeline/shared/passwords', () => ({ hashPassword: fakes.hashPassword }));
vi.mock('@timeline/shared/rate-limit', () => ({
  RATE_LIMITS: { signup: { limit: 5, windowMs: 60_000 } },
  checkRateLimit: fakes.checkRateLimit,
  rateLimitKey: (...parts: string[]) => parts.join(':'),
}));
vi.mock('@timeline/shared/slug', () => ({
  buildInboundEmail: (slug: string) => `${slug}@inbound.test`,
  randomSlugSuffix: () => 'legal',
  slugify: (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
}));
vi.mock('@/lib/active-team', () => ({
  ACTIVE_TEAM_COOKIE: 'timeline_active_team',
  activeTeamCookieOptions: () => ({ httpOnly: true, path: '/', secure: true }),
}));
vi.mock('@/lib/analytics', () => ({
  trackProductEventBestEffort: fakes.trackProductEventBestEffort,
}));
vi.mock('@/lib/auth', () => ({ auth: vi.fn(), signIn: fakes.signIn }));
vi.mock('@/lib/db', () => ({
  db: { select: fakes.dbSelect, transaction: fakes.dbTransaction },
}));
vi.mock('@/lib/email-verification', () => ({
  sendEmailVerification: fakes.sendEmailVerification,
}));
vi.mock('@/lib/legal', () => ({
  legalAcceptanceRequestMetadata: fakes.legalAcceptanceRequestMetadata,
  recordCurrentLegalAcceptance: fakes.recordCurrentLegalAcceptance,
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://timeline.test' }));
vi.mock('@/lib/turnstile', () => ({
  turnstileHostnameFromHeaders: () => 'timeline.test',
  verifyTurnstileToken: fakes.verifyTurnstileToken,
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ set: fakes.cookieSet }),
  headers: fakes.headers,
}));
vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('next-auth', () => ({
  AuthError: class AuthError extends Error {},
}));

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

function createSignupTransaction() {
  const insertedValues: unknown[] = [];
  let insertIndex = 0;
  const tx = {
    insert: vi.fn(() => {
      const index = insertIndex++;
      return {
        values: vi.fn((values: unknown) => {
          insertedValues.push(values);
          if (index === 0) {
            return { returning: vi.fn().mockResolvedValue([{ id: USER_ID }]) };
          }
          if (index === 1) {
            return { returning: vi.fn().mockResolvedValue([{ id: TEAM_ID }]) };
          }
          return Promise.resolve();
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
    expect(fakes.cookieSet).toHaveBeenCalledWith(
      'timeline_active_team',
      TEAM_ID,
      expect.objectContaining({ httpOnly: true, path: '/' }),
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
