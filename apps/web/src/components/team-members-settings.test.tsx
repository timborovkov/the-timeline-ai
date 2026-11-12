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

const { cleanup, fireEvent, render, screen, within, waitFor } =
  await import('@testing-library/react');
const { TeamMembersSettings } = await import('@/components/team-members-settings');
const { TeamListPagination } = await import('@/components/team-list-pagination');
const { PendingInvitesCard } = await import('@/components/pending-invites-card');
const { RemovedMembersCard } = await import('@/components/removed-members-card');
const { relatedMemberFixtures } = await import('@/app/dev/break-ui/fixtures');

afterEach(() => {
  cleanup();
});

const users = new Map([
  ['owner-1', { id: 'owner-1', name: 'Taylor', email: 'taylor@example.com' }],
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

describe('member identity and pagination', () => {
  function view(count: number) {
    return (
      <TeamMembersSettings
        members={Array.from({ length: count }, (_, index) => ({
          userId: `member-${index}`,
          role: 'member',
        }))}
        userMap={
          new Map(
            Array.from({ length: count }, (_, index) => [
              `member-${index}`,
              { id: `member-${index}`, name: null, email: `member.${index}@example.com` },
            ]),
          )
        }
        isAdmin={false}
        isOwner={false}
        currentUserId="member-0"
        invites={[]}
        removedMembers={[]}
      />
    );
  }

  it('renders an email fallback once and keeps all 51 members reachable across pages', () => {
    const { rerender } = render(view(50));
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    expect(screen.queryByRole('navigation', { name: 'Member pages' })).toBeNull();
    rerender(view(51));
    expect(screen.getAllByText('member.0@example.com')).toHaveLength(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    expect(screen.queryByText('member.50@example.com')).toBeNull();
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('member.50@example.com')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('list', { name: 'Members' }));
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('member.0@example.com')).toBeTruthy();
  });

  it('clamps the page after removal and does not resurrect a stale page when members return', () => {
    function renderView(count: number) {
      return (
        <>
          <button type="button">Outside list</button>
          {view(count)}
        </>
      );
    }
    const { rerender } = render(renderView(51));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const outside = screen.getByRole('button', { name: 'Outside list' });
    outside.focus();
    rerender(renderView(50));
    expect(document.activeElement).toBe(outside);
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    rerender(renderView(51));
    expect(screen.getByText('member.0@example.com')).toBeTruthy();
    expect(screen.queryByText('member.50@example.com')).toBeNull();
    rerender(renderView(0));
    expect(screen.getByText('No members are available right now')).toBeTruthy();
  });
});

describe('adjacent team lists', () => {
  it('falls back from blank inviter names and omits duplicate removed-member emails', () => {
    const fixture = relatedMemberFixtures('worst');
    render(
      <>
        <PendingInvitesCard
          siteUrl="https://preview.example.com"
          invites={fixture.invites.slice(11, 12)}
          userMap={fixture.userMap}
        />
        <RemovedMembersCard
          removedMembers={fixture.removedMembers.slice(11, 12)}
          userMap={fixture.userMap}
        />
      </>,
    );
    const pending = within(
      screen.getByRole('heading', { name: 'Pending invites' }).closest('section') ?? document.body,
    );
    expect(
      pending.getByText('member · invited by ops@sub.department.region.example.co.uk'),
    ).toBeTruthy();
    expect(
      pending.getByText('https://preview.example.com/accept-invite/synthetic-preview-token-11'),
    ).toBeTruthy();
    const removed = within(
      screen.getByRole('heading', { name: 'Removed members' }).closest('section') ?? document.body,
    );
    expect(removed.getAllByText('ops@sub.department.region.example.co.uk')).toHaveLength(1);
  });

  it('paginates invitations and removed members independently and clamps after removal', () => {
    const fixture = relatedMemberFixtures('huge');
    function view(count: number) {
      return (
        <>
          <PendingInvitesCard
            siteUrl="https://preview.example.com"
            invites={fixture.invites.slice(0, count)}
            userMap={fixture.userMap}
          />
          <RemovedMembersCard
            removedMembers={fixture.removedMembers.slice(0, count)}
            userMap={fixture.userMap}
          />
        </>
      );
    }
    const { rerender } = render(view(50));
    expect(screen.queryByRole('navigation')).toBeNull();
    rerender(view(51));
    const pending = within(
      screen.getByRole('heading', { name: 'Pending invites' }).closest('section') ?? document.body,
    );
    const removed = within(
      screen.getByRole('heading', { name: 'Removed members' }).closest('section') ?? document.body,
    );
    expect(pending.getAllByRole('listitem')).toHaveLength(50);
    expect(removed.getAllByRole('listitem')).toHaveLength(50);
    fireEvent.click(pending.getByRole('button', { name: 'Next' }));
    expect(pending.getAllByRole('listitem')).toHaveLength(1);
    expect(document.activeElement).toBe(pending.getByRole('list', { name: 'Pending invites' }));
    expect(removed.getAllByRole('listitem')).toHaveLength(50);
    expect(pending.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(removed.getByRole('button', { name: 'Next' }));
    expect(removed.getAllByRole('listitem')).toHaveLength(1);
    expect(document.activeElement).toBe(removed.getByRole('list', { name: 'Removed members' }));
    rerender(view(50));
    expect(pending.getAllByRole('listitem')).toHaveLength(50);
    expect(removed.getAllByRole('listitem')).toHaveLength(50);
    rerender(view(0));
    expect(screen.getByText('No pending invites')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Removed members' })).toBeNull();
  });
});

it('formats pagination for the browser language and follows language changes', async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'language');
  try {
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'de-DE' });
    render(
      <TeamListPagination
        page={0}
        total={1284}
        label="Member pages"
        noun="members"
        onPageChange={() => undefined}
      />,
    );
    expect(screen.getByText('1–50 of 1.284 members')).toBeTruthy();
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'en-US' });
    fireEvent(window, new Event('languagechange'));
    await waitFor(() => {
      expect(screen.getByText('1–50 of 1,284 members')).toBeTruthy();
    });
  } finally {
    if (original) Object.defineProperty(navigator, 'language', original);
    else Reflect.deleteProperty(navigator, 'language');
  }
});
