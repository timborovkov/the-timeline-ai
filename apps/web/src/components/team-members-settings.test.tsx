import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/teams'),
  () => ({
    changeMemberRoleAction: vi.fn(),
    removeMemberAction: vi.fn(),
    resendInviteAction: vi.fn(),
    revokeInviteAction: vi.fn(),
  }),
  () => import('@/app/actions/teams'),
);

await vi.mock(
  import.meta.resolve('@/components/team-forms'),
  () => ({
    InviteMemberForm: ({ canInviteAdmin }: { canInviteAdmin: boolean }) => (
      <p>Invite form: {canInviteAdmin ? 'owner' : 'admin'}</p>
    ),
  }),
  () => import('@/components/team-forms'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { TeamMembersSettings } = await import('@/components/team-members-settings');

afterEach(() => {
  cleanup();
});

const users = new Map([
  ['owner-1', { id: 'owner-1', name: 'Tim', email: 'tim@example.com' }],
  ['member-1', { id: 'member-1', name: 'Ada Lovelace', email: 'ada@example.com' }],
]);

describe('TeamMembersSettings', () => {
  it('gives an empty member list a focused recovery action', () => {
    render(
      <TeamMembersSettings
        members={[]}
        userMap={new Map()}
        isAdmin={false}
        isOwner={false}
        currentUserId="member-1"
        invites={[]}
        removedMembers={[]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Members', level: 2 })).toBeTruthy();
    expect(screen.getByText('No members are available right now')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Refresh members' }).getAttribute('href')).toBe(
      '/app/team?section=members',
    );
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('keeps role, member removal, invite delivery recovery, and narrow-row reflow discoverable', () => {
    render(
      <TeamMembersSettings
        members={[
          { userId: 'owner-1', role: 'owner' },
          { userId: 'member-1', role: 'member' },
        ]}
        userMap={users}
        isAdmin
        isOwner
        currentUserId="owner-1"
        invites={[
          {
            id: 'invite-1',
            email: 'grace@example.com',
            role: 'member',
            token: 'invite-token',
            expiresAt: new Date('2026-08-01T00:00:00.000Z'),
            lastSentAt: null,
            sendStatus: 'failed',
            sendError: 'The mailbox rejected this message.',
            invitedByUserId: 'owner-1',
          },
        ]}
        removedMembers={[]}
      />,
    );

    const memberRole = screen.getByLabelText<HTMLSelectElement>('Role for Ada Lovelace');
    expect(memberRole.value).toBe('member');
    expect(screen.getByRole('button', { name: 'Remove member' })).toBeTruthy();
    expect(screen.getByText('Invite form: owner')).toBeTruthy();
    expect(
      screen.getByText('Email delivery failed. The mailbox rejected this message.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resend invite' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke invite' })).toBeTruthy();
    expect(screen.getByText(/accept-invite\/invite-token/)).toBeTruthy();

    const memberRow = screen.getByText('Ada Lovelace').closest('li');
    const inviteRow = screen.getByText('grace@example.com').closest('li');
    expect(memberRow).toBeTruthy();
    expect(inviteRow).toBeTruthy();
    expect(inviteRow?.textContent).toContain('accept-invite/invite-token');
  });

  it('keeps administrator permissions scoped to member invites and member removals', () => {
    render(
      <TeamMembersSettings
        members={[{ userId: 'member-1', role: 'member' }]}
        userMap={users}
        isAdmin
        isOwner={false}
        currentUserId="owner-1"
        invites={[]}
        removedMembers={[]}
      />,
    );

    expect(screen.queryByLabelText('Role for Ada Lovelace')).toBeNull();
    expect(screen.getByText('member')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove member' })).toBeTruthy();
    expect(screen.getByText('Invite form: admin')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create an invite' }).getAttribute('href')).toBe(
      '#invite',
    );
  });
});
