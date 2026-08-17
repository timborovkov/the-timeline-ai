import type { TeamMemberInfo, TeamMemberRow } from '@/components/team-member-types';

import { CollectionRow } from '@/components/collections/collection-row';
import { MemberRoleForm, RemoveMemberForm } from '@/components/team-member-actions';
import { Badge } from '@/components/ui/badge';
import { ItemActionGroup } from '@/components/ui/item-actions';
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
    <li>
      <CollectionRow
        title={memberLabel}
        context={user?.email ?? undefined}
        metadata={<Badge variant="outline">{member.role}</Badge>}
        actions={
          canManageRole || canRemove ? (
            <ItemActionGroup label={`Actions for ${memberLabel}`}>
              {canManageRole ? (
                <MemberRoleForm
                  memberLabel={memberLabel}
                  memberRole={member.role}
                  userId={member.userId}
                />
              ) : null}
              {canRemove ? (
                <RemoveMemberForm memberLabel={memberLabel} userId={member.userId} />
              ) : null}
            </ItemActionGroup>
          ) : undefined
        }
      />
    </li>
  );
}
