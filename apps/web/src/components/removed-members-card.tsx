import type { RemovedTeamMemberRow, TeamMemberMap } from '@/components/team-member-types';

import { CollectionRow } from '@/components/collections/collection-row';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { SettingsSection } from '@/components/section-heading';
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
    <SettingsSection title="Removed members">
      <ul>
        {removedMembers.map((member) => {
          const user = userMap.get(member.userId);
          return (
            <li key={member.userId}>
              <CollectionRow>
                <CollectionRow.Title>{displayRemovedMemberLabel(user)}</CollectionRow.Title>
                <CollectionRow.Context>{user?.email ?? undefined}</CollectionRow.Context>
                <CollectionRow.Metadata>
                  <>
                    <span>{member.role}</span>
                    <RelativeTimestamp prefix="Removed" value={member.removedAt} />
                  </>
                </CollectionRow.Metadata>
              </CollectionRow>
            </li>
          );
        })}
      </ul>
    </SettingsSection>
  );
}
