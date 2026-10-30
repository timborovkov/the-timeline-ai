import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
/**
 * The legal gate must require an affirmative checkbox and commit acceptance
 * evidence before navigation. These tests cover the server-action boundary so
 * a forged or replayed form cannot fall back to a users-row-only update.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  headers: vi.fn(),
  isLegalPublicationReady: vi.fn(),
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

await vi.mock(
  import.meta.resolve('@sentry/nextjs'),
  () => ({
    withServerActionInstrumentation: fakes.withServerActionInstrumentation,
  }),
  () => import('@sentry/nextjs'),
);
await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth, updateSession: fakes.updateSession }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: { transaction: fakes.transaction } }),
  () => import('@/lib/db'),
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
  import.meta.resolve('next/headers'),
  () => ({ headers: fakes.headers }),
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

const { PRIVACY_VERSION, TERMS_VERSION } = await import('@timeline/shared/legal-versions');
const { acceptLegalAction } = await import('@/app/actions/legal');

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
  fakes.isLegalPublicationReady.mockReturnValue(true);
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
  it('does not record acceptance while legal publication is blocked', async () => {
    fakes.isLegalPublicationReady.mockReturnValue(false);

    await expect(acceptLegalAction({}, form({ accepted: 'on' }))).resolves.toEqual({
      error:
        'Legal acceptance is unavailable while our contracting-entity publication review is completed.',
    });
    expect(fakes.auth).not.toHaveBeenCalled();
    expect(fakes.transaction).not.toHaveBeenCalled();
    expect(fakes.recordCurrentLegalAcceptance).not.toHaveBeenCalled();
  });

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
