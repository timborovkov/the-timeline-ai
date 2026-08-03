// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/invites', () => ({
  acceptRecipientInviteAction: vi.fn(),
  declineInviteAction: vi.fn(),
}));
vi.mock('@/components/team-forms', () => ({
  CreateTeamForm: () => <div>Create team form</div>,
}));

import { TeamSwitcher } from '@/components/team-switcher';

afterEach(() => {
  cleanup();
});

const active = {
  teamId: 'team-1',
  teamName: 'Acme Labs',
  teamSlug: 'acme-labs',
  role: 'admin' as const,
};

const otherTeam = {
  teamId: 'team-2',
  teamName: 'Research Team',
  teamSlug: 'research',
  role: 'member' as const,
};

describe('TeamSwitcher', () => {
  it('keeps the active workspace explicit and announces a switch before the POST navigation', async () => {
    const user = userEvent.setup();
    render(<TeamSwitcher active={active} memberships={[active, otherTeam]} />);

    await user.click(screen.getByRole('button', { name: 'Switch team — current: Acme Labs' }));

    expect(
      screen.getByText('Your current team stays active until another workspace opens.'),
    ).toBeTruthy();
    const activeTeam = screen.getByRole<HTMLButtonElement>('button', { name: /Acme Labs/ });
    expect(activeTeam.disabled).toBe(true);
    expect(activeTeam.getAttribute('aria-current')).toBe('true');

    const otherTeamButton = screen.getByRole<HTMLButtonElement>('button', {
      name: /Research Team/,
    });
    const switchForm = otherTeamButton.closest('form');
    const preventNavigation = (event: SubmitEvent) => {
      event.preventDefault();
    };
    switchForm?.addEventListener('submit', preventNavigation);

    await user.click(otherTeamButton);

    await waitFor(() => {
      expect(screen.getByText('Opening Research Team')).toBeTruthy();
    });
    expect(otherTeamButton.disabled).toBe(true);
    expect(otherTeamButton.getAttribute('aria-disabled')).toBe('true');
    expect(switchForm?.getAttribute('aria-busy')).toBe('true');
    expect(otherTeamButton.textContent).toContain('Opening…');
    expect(otherTeamButton.className).toContain('rounded-sm');
  });

  it('keeps pending invite actions readable and stacked until the dialog has room', async () => {
    const user = userEvent.setup();
    render(
      <TeamSwitcher
        active={active}
        memberships={[active, otherTeam]}
        recipientInvites={[
          {
            id: 'invite-1',
            teamName: 'A team with a long translated workspace name',
            role: 'member',
            expiresAt: '2026-08-10T00:00:00.000Z',
            invitedBy: 'A teammate with a long address',
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Switch team — current: Acme Labs' }));

    const accept = screen.getByRole<HTMLButtonElement>('button', { name: 'Accept' });
    const decline = screen.getByRole<HTMLButtonElement>('button', { name: 'Decline' });
    const actions = accept.parentElement?.parentElement;
    expect(actions?.className).toContain('flex-col');
    expect(actions?.className).toContain('sm:flex-row');
    expect(accept.className).toContain('w-full');
    expect(accept.className).toContain('sm:w-auto');
    expect(decline.className).toContain('rounded-sm');
    expect(screen.getByText(/A teammate with a long address/).className).toContain('break-words');
  });
});
