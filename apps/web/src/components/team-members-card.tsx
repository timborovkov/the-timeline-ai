import Link from 'next/link';

import type { TeamMemberMap, TeamMemberRow } from '@/components/team-member-types';

import { SectionHeading } from '@/components/section-heading';
import { TeamMemberListItem } from '@/components/team-member-list-item';
import { Button } from '@/components/ui/button';

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
        <div className="space-y-3 px-1">
          <p className="text-sm text-fg-muted">No members are available right now.</p>
          <Button asChild variant="ghost" size="sm">
            <Link href="/app/team?section=members">Refresh members</Link>
          </Button>
        </div>
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
