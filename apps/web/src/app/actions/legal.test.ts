import { PRIVACY_VERSION, TERMS_VERSION } from '@timeline/shared/legal-versions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { acceptLegalAction } from '@/app/actions/legal';

/**
 * The legal gate must require an affirmative checkbox and commit acceptance
 * evidence before navigation. These tests cover the server-action boundary so
 * a forged or replayed form cannot fall back to a users-row-only update.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  headers: vi.fn(),
  legalAcceptanceRequestMetadata: vi.fn(),
  recordCurrentLegalAcceptance: vi.fn(),
  updateSession: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  transaction: vi.fn(),
  withServerActionInstrumentation: vi.fn(
    (_operation: string, _options: unknown, callback: () => unknown) => Promise.resolve(callback()),
  ),
}));

vi.mock('@sentry/nextjs', () => ({
  withServerActionInstrumentation: fakes.withServerActionInstrumentation,
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth, updateSession: fakes.updateSession }));
vi.mock('@/lib/db', () => ({ db: { transaction: fakes.transaction } }));
vi.mock('@/lib/legal', () => ({
  legalAcceptanceRequestMetadata: fakes.legalAcceptanceRequestMetadata,
  recordCurrentLegalAcceptance: fakes.recordCurrentLegalAcceptance,
}));
vi.mock('next/headers', () => ({ headers: fakes.headers }));
vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));

const tx = { kind: 'legal-test-transaction' };

function form(values: Record<string, string> = {}): FormData {
  const result = new FormData();
  result.set('termsVersion', TERMS_VERSION);
  result.set('privacyVersion', PRIVACY_VERSION);
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.headers.mockResolvedValue(new Headers());
  fakes.legalAcceptanceRequestMetadata.mockReturnValue({
    ipAddress: '203.0.113.10',
    userAgent: 'Timeline test browser',
  });
  fakes.recordCurrentLegalAcceptance.mockResolvedValue({ id: 'acceptance-1' });
  fakes.updateSession.mockResolvedValue(undefined);
  fakes.transaction.mockImplementation((callback: (value: unknown) => unknown) => callback(tx));
});

describe('acceptLegalAction', () => {
  it('rejects a stale rendered document version without writing evidence', async () => {
    await expect(
      acceptLegalAction({}, form({ accepted: 'on', privacyVersion: 'older-privacy' })),
    ).resolves.toEqual({
      error:
        'The Terms of Use or Privacy Policy changed. Reload this page and review the current versions before accepting.',
    });

    expect(fakes.transaction).not.toHaveBeenCalled();
    expect(fakes.recordCurrentLegalAcceptance).not.toHaveBeenCalled();
    expect(fakes.updateSession).not.toHaveBeenCalled();
  });

  it('rejects a missing checkbox without writing acceptance evidence', async () => {
    await expect(acceptLegalAction({}, form())).resolves.toEqual({
      error: 'You must agree before continuing.',
    });

    expect(fakes.transaction).not.toHaveBeenCalled();
    expect(fakes.recordCurrentLegalAcceptance).not.toHaveBeenCalled();
  });

  it('records request context in one transaction before a safe redirect', async () => {
    await expect(
      acceptLegalAction({}, form({ accepted: 'on', returnTo: '/app/timeline?view=all' })),
    ).rejects.toThrow('NEXT_REDIRECT:/app/timeline?view=all');

    expect(fakes.recordCurrentLegalAcceptance).toHaveBeenCalledWith(tx, {
      userId: 'user-1',
      source: 'legal_gate',
      ipAddress: '203.0.113.10',
      userAgent: 'Timeline test browser',
    });
    expect(fakes.updateSession).toHaveBeenCalledWith({});
    expect(fakes.updateSession.mock.invocationCallOrder[0]).toBeGreaterThan(
      fakes.transaction.mock.invocationCallOrder[0] ?? 0,
    );
    expect(fakes.redirect).toHaveBeenCalledOnce();
  });
});
