// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  changeMemberRoleAction: vi.fn(),
  removeMemberAction: vi.fn(),
  resendInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
}));

vi.mock('@/app/actions/teams', () => fakes);
vi.mock('@/lib/notify', () => ({
  notifyAction: async ({ run }: { run: () => Promise<{ error?: string }> }) => run(),
}));

const { MemberRoleForm, PendingInviteActions, RemoveMemberForm } =
  await import('./team-member-actions.js');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('MemberRoleForm', () => {
  it('names the role control, explains its permission impact, and reflows on narrow screens', () => {
    render(<MemberRoleForm memberLabel="Ada Lovelace" memberRole="member" userId="member-1" />);

    const control = screen.getByLabelText<HTMLSelectElement>('Role for Ada Lovelace');
    expect(control.value).toBe('member');
    expect(control.getAttribute('aria-describedby')).toBe('member-role-member-1-help');
    expect(
      screen.getByText(
        'Changing a role updates permissions immediately. Owners can manage all team settings.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save role' })).toBeTruthy();

    const form = control.closest('form');
    expect(form?.className).toContain('w-full');
    const controlRow = control.closest('div')?.parentElement;
    expect(controlRow?.className).toContain('flex-col');
    expect(controlRow?.className).toContain('sm:flex-row');
  });
});

describe('destructive team member actions', () => {
  it('keeps focus and prevents removal until the keyboard confirmation is accepted', async () => {
    const user = userEvent.setup();
    render(<RemoveMemberForm memberLabel="Ada Lovelace" userId="member-1" />);

    const remove = screen.getByRole('button', { name: 'Remove member' });
    remove.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('heading', { name: 'Remove Ada Lovelace?' })).toBeTruthy();
    expect(
      screen.getByText(
        'Ada Lovelace will lose access to this team. You can review removed members below.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove member' })).toBeTruthy();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(remove);
    expect(fakes.removeMemberAction).not.toHaveBeenCalled();

    await user.click(remove);
    const dialog = screen.getByRole('dialog');
    const confirm = screen
      .getAllByRole('button', { name: 'Remove member' })
      .find((button) => dialog.contains(button));
    expect(confirm).toBeTruthy();
    if (!confirm) throw new Error('Expected the remove confirmation button');
    await user.click(confirm);

    await waitFor(() => {
      expect(fakes.removeMemberAction).toHaveBeenCalledOnce();
    });
    const formData = fakes.removeMemberAction.mock.calls[0]?.[0] as FormData;
    expect(formData.get('userId')).toBe('member-1');
  });

  it('makes invite recovery and revocation explicit before revoking the link', async () => {
    const user = userEvent.setup();
    render(<PendingInviteActions inviteEmail="ada@example.com" inviteId="invite-1" />);

    expect(screen.getByRole('button', { name: 'Resend invite' })).toBeTruthy();
    const revoke = screen.getByRole('button', { name: 'Revoke invite' });
    await user.click(revoke);

    expect(
      screen.getByRole('heading', { name: 'Revoke invite for ada@example.com?' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'The current invite link will stop working. You can create a new invite later.',
      ),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(fakes.revokeInviteAction).not.toHaveBeenCalled();
  });
});
