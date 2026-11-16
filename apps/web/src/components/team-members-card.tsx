'use client';

import { Users } from 'lucide-react';

import type { TeamMemberMap, TeamMemberRow } from '@/components/team-member-types';

import { EmptyState } from '@/components/empty-state';
import { SectionHeading } from '@/components/section-heading';
import { TeamListPagination, useTeamListPage } from '@/components/team-list-pagination';
import { TeamMemberListItem } from '@/components/team-member-list-item';

export function MembersCard({
  members,
  userMap,
  isAdmin,
  isOwner,
  currentUserId,
}: {
  members: TeamMemberRow[];
  userMap: TeamMemberMap;
  isAdmin: boolean;
  isOwner: boolean;
  currentUserId: string;
}) {
  const { visibleItems: visibleMembers, pagination, listRef } = useTeamListPage(members);

  return (
    <section className="space-y-2">
      <SectionHeading>Members</SectionHeading>
      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          size="inset"
          title="No members are available right now"
          body="Reload this list if a teammate was just added, or invite someone from the form on this page."
          href="/app/team?section=members"
          action="Refresh members"
        />
      ) : (
        <ul
          ref={listRef}
          tabIndex={-1}
          aria-label="Members"
          className="scroll-mt-16 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visibleMembers.map((member) => (
            <TeamMemberListItem
              key={member.userId}
              member={member}
              user={userMap.get(member.userId)}
              isAdmin={isAdmin}
              isOwner={isOwner}
              currentUserId={currentUserId}
            />
          ))}
        </ul>
      )}
      <TeamListPagination {...pagination} label="Member pages" noun="members" />
    </section>
  );
}
