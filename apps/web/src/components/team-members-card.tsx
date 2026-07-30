import Link from 'next/link';

import type { TeamMemberMap, TeamMemberRow } from '@/components/team-member-types';

import { TeamMemberListItem } from '@/components/team-member-list-item';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
    <Card>
      <CardHeader>
        <CardTitle as="h2">Members</CardTitle>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">No members are available right now.</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/app/team?section=members">Refresh members</Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y">
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
      </CardContent>
    </Card>
  );
}
