import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  getUserLegalAcceptance: vi.fn(),
  redirect: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: fakes.redirect,
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({
    // Bun links all named exports, including actions this suite must never invoke.
    hasGitHubAuth: vi.fn(() => {
      throw new Error('Unexpected hasGitHubAuth call in this test');
    }),
    handlers: vi.fn(() => {
      throw new Error('Unexpected handlers call in this test');
    }),
    signIn: vi.fn(() => {
      throw new Error('Unexpected signIn call in this test');
    }),
    updateSession: vi.fn(() => {
      throw new Error('Unexpected updateSession call in this test');
    }),
    auth: fakes.auth,
  }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/auth.config'),
  () => ({
    hasCurrentLegalSession: (user: {
      legalTermsVersion?: string | null;
      legalPrivacyVersion?: string | null;
      legalAcceptedAt?: string | null;
    }) =>
      user.legalTermsVersion === TERMS_VERSION &&
      user.legalPrivacyVersion === PRIVACY_VERSION &&
      Boolean(user.legalAcceptedAt),
  }),
  () => import('@/lib/auth.config'),
);
await vi.mock(
  import.meta.resolve('@/lib/legal'),
  () => ({
    // Bun links all named exports, including actions this suite must never invoke.
    legalAcceptanceRequestMetadata: vi.fn(() => {
      throw new Error('Unexpected legalAcceptanceRequestMetadata call in this test');
    }),
    recordCurrentLegalAcceptance: vi.fn(() => {
      throw new Error('Unexpected recordCurrentLegalAcceptance call in this test');
    }),
    getUserLegalAcceptance: fakes.getUserLegalAcceptance,
    hasCurrentLegalAcceptance: (legal: {
      legalTermsVersion: string;
      legalPrivacyVersion: string;
      legalAcceptedAt: Date | null;
    }) =>
      legal.legalTermsVersion === TERMS_VERSION &&
      legal.legalPrivacyVersion === PRIVACY_VERSION &&
      Boolean(legal.legalAcceptedAt),
  }),
  () => import('@/lib/legal'),
);

const { default: LegalAcceptPage } = await import('@/app/legal/accept/page');
const { PRIVACY_VERSION, TERMS_VERSION } = await import('@/lib/legal-versions');

const currentDbAcceptance = {
  legalTermsVersion: TERMS_VERSION,
  legalPrivacyVersion: PRIVACY_VERSION,
  legalAcceptedAt: new Date('2026-08-21T00:00:00.000Z'),
};

describe('LegalAcceptPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.redirect.mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });
    fakes.getUserLegalAcceptance.mockResolvedValue(currentDbAcceptance);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns to the dashboard when production legal publication is withheld', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LEGAL_PUBLICATION_READY', 'false');
    fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
    fakes.getUserLegalAcceptance.mockResolvedValue(null);

    await expect(LegalAcceptPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/app',
    );
  });

  it('renders the idempotent form when the DB is current but the signed session is stale', async () => {
    fakes.auth.mockResolvedValue({
      user: {
        id: 'user-1',
        legalTermsVersion: 'old',
        legalPrivacyVersion: 'old',
        legalAcceptedAt: '2026-06-02T00:00:00.000Z',
      },
    });

    const page = await LegalAcceptPage({ searchParams: Promise.resolve({ returnTo: '/app' }) });

    expect(page).toBeTruthy();
    expect(fakes.redirect).not.toHaveBeenCalled();
  });

  it('redirects only when both the DB snapshot and signed session are current', async () => {
    fakes.auth.mockResolvedValue({
      user: {
        id: 'user-1',
        legalTermsVersion: TERMS_VERSION,
        legalPrivacyVersion: PRIVACY_VERSION,
        legalAcceptedAt: '2026-08-21T00:00:00.000Z',
      },
    });

    await expect(
      LegalAcceptPage({ searchParams: Promise.resolve({ returnTo: '/app/team' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/app/team');
  });
});
