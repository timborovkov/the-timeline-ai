import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LegalAcceptPage from '@/app/legal/accept/page';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  getUserLegalAcceptance: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/auth.config', () => ({
  hasCurrentLegalSession: (user: {
    legalTermsVersion?: string | null;
    legalPrivacyVersion?: string | null;
    legalAcceptedAt?: string | null;
  }) =>
    user.legalTermsVersion === TERMS_VERSION &&
    user.legalPrivacyVersion === PRIVACY_VERSION &&
    Boolean(user.legalAcceptedAt),
}));
vi.mock('@/lib/legal', () => ({
  getUserLegalAcceptance: fakes.getUserLegalAcceptance,
  hasCurrentLegalAcceptance: (legal: {
    legalTermsVersion: string;
    legalPrivacyVersion: string;
    legalAcceptedAt: Date | null;
  }) =>
    legal.legalTermsVersion === TERMS_VERSION &&
    legal.legalPrivacyVersion === PRIVACY_VERSION &&
    Boolean(legal.legalAcceptedAt),
}));

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
