import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  pathname: '/app/timeline',
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    usePathname: () => fakes.pathname,
  }),
  () => import('next/navigation'),
);

await vi.mock(
  import.meta.resolve('@/app/actions/invites'),
  () => ({
    acceptRecipientInviteAction: vi.fn(),
    declineInviteAction: vi.fn(),
  }),
  () => import('@/app/actions/invites'),
);

await vi.mock(
  import.meta.resolve('@/components/team-forms'),
  () => ({
    CreateTeamForm: () => createElement('div', null, 'Create team form'),
  }),
  () => import('@/components/team-forms'),
);

const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { createElement } = await import('react');

const { MobileNav } = await import('./mobile-nav.js');

const active = {
  teamId: 'team-1',
  teamName: "Tim Borovkov's Team",
  teamSlug: 'tim-borovkov',
  role: 'admin' as const,
};

const otherTeam = {
  teamId: 'team-2',
  teamName: 'Research Team',
  teamSlug: 'research',
  role: 'member' as const,
};

beforeEach(() => {
  fakes.pathname = '/app/timeline';
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
});

afterEach(() => {
  cleanup();
});

describe('MobileNav team switcher', () => {
  it('opens, submits another team, and closes within the mobile navigation dialog', async () => {
    const user = userEvent.setup();
    render(
      createElement(MobileNav, {
        active,
        memberships: [active, otherTeam],
        recipientInvites: [],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const navigationDialog = screen.getByRole('dialog', { name: 'Navigation' });
    await user.click(
      screen.getByRole('button', { name: "Switch team — current: Tim Borovkov's Team" }),
    );

    const teamsDialog = await screen.findByRole('dialog', { name: 'Teams' });
    expect(navigationDialog.contains(teamsDialog)).toBe(true);

    const switchForm = screen.getByRole('button', { name: /Research Team/ }).closest('form');
    expect(switchForm).not.toBeNull();
    expect(switchForm?.getAttribute('action')).toBe('/app/team/switch/team-2');
    const submit = vi.fn((event: SubmitEvent) => {
      event.preventDefault();
    });
    switchForm?.addEventListener('submit', submit);
    await user.click(screen.getByRole('button', { name: /Research Team/ }));
    expect(submit).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Teams' })).toBeNull();
    });
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBe(navigationDialog);
  });
});
