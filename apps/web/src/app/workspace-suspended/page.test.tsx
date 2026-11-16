import { expect, vi } from '@timeline/test-support';
import { afterEach, it } from 'bun:test';
// Test environment: happy-dom
// A suspended account must retain support and sign-out even without another workspace.

const fakes = vi.hoisted(() => ({ signOut: vi.fn() }));
await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: () => Promise.resolve({ user: { id: 'synthetic-user' } }) }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({
    db: {
      select: () => ({
        from: () => ({
          innerJoin: () => ({ leftJoin: () => ({ where: () => Promise.resolve([]) }) }),
        }),
      }),
    },
  }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/sign-out-session'),
  () => ({ signOutAfterClearingLocalSession: fakes.signOut }),
  () => import('@/lib/sign-out-session'),
);
const { cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { default: SuspendedWorkspacePage } = await import('./page');
afterEach(cleanup);
it('offers public support and a safe account exit with no available team', async () => {
  fakes.signOut.mockResolvedValue(undefined);
  render(await SuspendedWorkspacePage());
  expect(screen.getByRole('link', { name: 'Get support' }).getAttribute('href')).toBe(
    '/help/support',
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
  expect(fakes.signOut).toHaveBeenCalledWith(undefined, undefined, undefined);
});
