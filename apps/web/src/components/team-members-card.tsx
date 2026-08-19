import { Users } from 'lucide-react';

import type { TeamMemberMap, TeamMemberRow } from '@/components/team-member-types';

import { EmptyState } from '@/components/empty-state';
import { SectionHeading } from '@/components/section-heading';
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
        <ul className="border-x border-border">
          {members.map((member) => (
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
    </section>
  );
}
