import type { TeamMemberInfo, TeamMemberRow } from '@/components/team-member-types';

import { MemberRoleForm, RemoveMemberForm } from '@/components/team-member-actions';
import { Badge } from '@/components/ui/badge';
import { displayMemberLabel } from '@/lib/display-labels';

export function TeamMemberListItem({
  member,
  user,
  isAdmin,
  isOwner,
  currentUserId,
}: {
  member: TeamMemberRow;
  user: TeamMemberInfo | undefined;
  isAdmin: boolean;
  isOwner: boolean;
  currentUserId: string;
}) {
  const memberLabel = displayMemberLabel(user);
  const canManageRole = isOwner && member.userId !== currentUserId;
  const canRemove =
    isAdmin && member.userId !== currentUserId && (isOwner || member.role === 'member');

  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium">{memberLabel}</p>
        {user?.email ? <p className="break-all text-xs text-fg-muted">{user.email}</p> : null}
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
        {canManageRole ? (
          <MemberRoleForm
            memberLabel={memberLabel}
            memberRole={member.role}
            userId={member.userId}
          />
        ) : (
          <Badge variant="outline">{member.role}</Badge>
        )}
        {canRemove ? <RemoveMemberForm memberLabel={memberLabel} userId={member.userId} /> : null}
      </div>
    </li>
  );
}
