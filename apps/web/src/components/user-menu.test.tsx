import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from '@timeline/test-support';
import { afterEach, it } from 'bun:test';

await vi.mock(
  import.meta.resolve('@/app/actions/auth'),
  () => ({ resendEmailVerificationAction: vi.fn() }),
  () => import('@/app/actions/auth'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/onboarding'),
  () => ({ reopenOnboardingChecklistAction: vi.fn() }),
  () => import('@/app/actions/onboarding'),
);
await vi.mock(
  import.meta.resolve('@/lib/form-action-toast'),
  () => ({ useFormActionToast: vi.fn() }),
  () => import('@/lib/form-action-toast'),
);
await vi.mock(
  import.meta.resolve('@/lib/sign-out-session'),
  () => ({ signOutAfterClearingLocalSession: vi.fn() }),
  () => import('@/lib/sign-out-session'),
);

const { UserMenu } = await import('@/components/user-menu');
const { resendEmailVerificationAction } = await import('@/app/actions/auth');
const { useFormActionToast } = await import('@/lib/form-action-toast');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

for (const result of [{ ok: true }, { error: 'Email provider unavailable' }]) {
  it(`submits verification and retains ${'ok' in result ? 'success' : 'error'} feedback after closing the menu`, async () => {
    let resolve!: (value: typeof result) => void;
    vi.mocked(resendEmailVerificationAction).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const user = userEvent.setup();
    render(<UserMenu user={{ email: 'owner@example.test', emailVerified: null }} />);
    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(screen.getByRole('menuitem', { name: 'Resend verification' }));
    await waitFor(() => {
      expect(resendEmailVerificationAction).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('menuitem', { name: 'Sending verification…' })).toBeDefined();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    resolve(result);
    await waitFor(() => {
      expect(useFormActionToast).toHaveBeenLastCalledWith(
        expect.objectContaining({
          pending: false,
          ...('ok' in result ? { success: 'Verification email sent' } : { error: result.error }),
        }),
      );
    });
  });
}
