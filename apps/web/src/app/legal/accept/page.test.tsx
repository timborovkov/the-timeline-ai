import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    user.legalTermsVersion === '2026-08-21' &&
    user.legalPrivacyVersion === '2026-08-21' &&
    Boolean(user.legalAcceptedAt),
}));
vi.mock('@/lib/legal', () => ({
  getUserLegalAcceptance: fakes.getUserLegalAcceptance,
  hasCurrentLegalAcceptance: (legal: {
    legalTermsVersion: string;
    legalPrivacyVersion: string;
    legalAcceptedAt: Date | null;
  }) =>
    legal.legalTermsVersion === '2026-08-21' &&
    legal.legalPrivacyVersion === '2026-08-21' &&
    Boolean(legal.legalAcceptedAt),
}));

import LegalAcceptPage from '@/app/legal/accept/page';

const currentDbAcceptance = {
  legalTermsVersion: '2026-08-21',
  legalPrivacyVersion: '2026-08-21',
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
        legalTermsVersion: '2026-08-21',
        legalPrivacyVersion: '2026-08-21',
        legalAcceptedAt: '2026-08-21T00:00:00.000Z',
      },
    });

    await expect(
      LegalAcceptPage({ searchParams: Promise.resolve({ returnTo: '/app/team' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/app/team');
  });
});
