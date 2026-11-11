import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requestDeletion: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/support-email'),
  () => ({ getSupportEmail: () => 'help@example.test' }),
  () => import('@/lib/support-email'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/platform-admin'),
  () => ({ requireAdmin: vi.fn() }),
  () => import('@/lib/platform-admin'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-action'),
  () => ({
    runSentryServerAction: (_name: string, callback: () => Promise<unknown>) => callback(),
  }),
  () => import('@/lib/sentry-action'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-lifecycle'),
  () => ({
    beginTeamDeletion: vi.fn(),
    retryTeamLifecycle: vi.fn(),
    recordTeamDeletionFollowup: vi.fn(),
  }),
  () => import('@timeline/shared/team-lifecycle'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({ withTeam: () => ({ lifecycle: { requestDeletion: fakes.requestDeletion } }) }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({ ...(await import('next/navigation')), redirect: fakes.redirect }),
  () => import('next/navigation'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: Page } = await import('./page');
const { requestTeamDeletionAction } = await import('@/app/actions/team-lifecycle');
const teamId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'owner' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: null, memberships: [] });
  fakes.requestDeletion.mockResolvedValue(undefined);
});
afterEach(cleanup);

function requestData() {
  const data = new FormData();
  data.set('teamId', teamId);
  data.set('confirmation', 'Example team');
  data.set('confirmed', 'yes');
  return data;
}

describe('Team deletion confirmation', () => {
  it('remains usable with no active team and offers restoration contact details', async () => {
    render(await Page());
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Deletion requested' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'help@example.test' }).getAttribute('href')).toBe(
      'mailto:help@example.test?subject=Request%20to%20restore%20a%20team',
    );
    expect(screen.getByText(/only before permanent deletion begins/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/');
  });
  it('offers continuation when another team remains active', async () => {
    fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'another-team' } });
    render(await Page());
    expect(
      screen.getByRole('link', { name: 'Continue to another team' }).getAttribute('href'),
    ).toBe('/app');
  });
  it('requires sign-in', async () => {
    fakes.auth.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
  });
  it('redirects a successful deletion request outside the workspace shell', async () => {
    fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId } });
    await expect(requestTeamDeletionAction(requestData())).rejects.toThrow(
      'NEXT_REDIRECT:/team-deletion-requested',
    );
  });
  it('does not show success when the deletion request fails', async () => {
    fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId } });
    fakes.requestDeletion.mockRejectedValue(new Error('Request failed'));
    await expect(requestTeamDeletionAction(requestData())).rejects.toThrow('Request failed');
    expect(fakes.redirect).not.toHaveBeenCalled();
  });
});
