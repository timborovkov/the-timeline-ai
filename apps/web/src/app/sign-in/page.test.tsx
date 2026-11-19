import { expect, vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  readPendingInvite: vi.fn(),
  readLastLoginMethod: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({
    // Bun links all named exports, including actions this suite must never invoke.
    hasGitHubAuth: false,
    hasGoogleAuth: false,
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
  import.meta.resolve('@/lib/pending-invite'),
  () => ({ readPendingInvite: fakes.readPendingInvite }),
  () => import('@/lib/pending-invite'),
);
await vi.mock(
  import.meta.resolve('@/lib/last-login-method'),
  () => ({ readLastLoginMethod: fakes.readLastLoginMethod }),
  () => import('@/lib/last-login-method'),
);
await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({ ...(await import('next/navigation')), redirect: fakes.redirect }),
  () => import('next/navigation'),
);

const { default: SignInPage } = await import('@/app/sign-in/page');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.readPendingInvite.mockResolvedValue(null);
  fakes.readLastLoginMethod.mockResolvedValue(null);
});

describe('Sign in page', () => {
  it('redirects authenticated visitors into the app', async () => {
    fakes.auth.mockResolvedValue({ user: { id: 'user-1', email: 'ada@example.test' } });

    await expect(SignInPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/app',
    );
  });

  it('honors a safe callbackUrl when redirecting authenticated visitors', async () => {
    fakes.auth.mockResolvedValue({ user: { id: 'user-1', email: 'ada@example.test' } });

    await expect(
      SignInPage({
        searchParams: Promise.resolve({ callbackUrl: '/app/team' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/app/team');
  });
});
