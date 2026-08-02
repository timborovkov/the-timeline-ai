import type { RemovedTeamMemberRow, TeamMemberMap } from '@/components/team-member-types';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { displayRemovedMemberLabel } from '@/lib/display-labels';

export function RemovedMembersCard({
  removedMembers,
  userMap,
}: {
  removedMembers: RemovedTeamMemberRow[];
  userMap: TeamMemberMap;
}) {
  if (removedMembers.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Removed members</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {removedMembers.map((member) => {
            const user = userMap.get(member.userId);
            return (
              <li
                key={member.userId}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">
                    {displayRemovedMemberLabel(user)}
                  </p>
                  {user?.email ? (
                    <p className="break-all text-xs text-fg-muted">
                      {user.email} · removed {member.removedAt?.toLocaleDateString()}
                    </p>
                  ) : null}
                </div>
                <Badge variant="outline">{member.role}</Badge>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
