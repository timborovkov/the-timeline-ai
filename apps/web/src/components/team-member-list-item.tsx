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
      <CollectionRow>
        <CollectionRow.Title>{memberLabel}</CollectionRow.Title>
        <CollectionRow.Context>{user?.email ?? undefined}</CollectionRow.Context>
        <CollectionRow.Metadata>
          <Badge variant="outline" className="capitalize">
            {member.role}
          </Badge>
        </CollectionRow.Metadata>
        <CollectionRow.Actions>
          {canManageRole || canRemove ? (
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
          ) : undefined}
        </CollectionRow.Actions>
      </CollectionRow>
    </li>
  );
}
