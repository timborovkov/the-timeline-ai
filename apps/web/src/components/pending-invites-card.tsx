'use client';

import { Mail } from 'lucide-react';

import type { TeamInviteRow, TeamMemberMap } from '@/components/team-member-types';

import { EmptyState } from '@/components/empty-state';
import { PendingInviteItem } from '@/components/pending-invite-item';
import { SettingsSection } from '@/components/section-heading';
import { TeamListPagination, useTeamListPage } from '@/components/team-list-pagination';

export function PendingInvitesCard({
  invites,
  userMap,
  siteUrl,
}: {
  invites: TeamInviteRow[];
  userMap: TeamMemberMap;
  siteUrl: string;
}) {
  const { visibleItems, pagination, listRef } = useTeamListPage(invites);
  return (
    <SettingsSection title="Pending invites">
      {invites.length === 0 ? (
        <EmptyState
          icon={Mail}
          size="inset"
          title="No pending invites"
          body="Create an invite when you want to bring someone onto this team."
          href="#invite"
          action="Create an invite"
        />
      ) : (
        <ul
          ref={listRef}
          tabIndex={-1}
          aria-label="Pending invites"
          className="scroll-mt-16 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visibleItems.map((invite) => (
            <PendingInviteItem
              key={invite.id}
              invite={invite}
              siteUrl={siteUrl}
              inviter={userMap.get(invite.invitedByUserId)}
            />
          ))}
        </ul>
      )}
      <TeamListPagination {...pagination} label="Invitation pages" noun="invites" />
    </SettingsSection>
  );
}
