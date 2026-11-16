'use client';

import type { RemovedTeamMemberRow, TeamMemberMap } from '@/components/team-member-types';

import { CollectionRow } from '@/components/collections/collection-row';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { SettingsSection } from '@/components/section-heading';
import { TeamListPagination, useTeamListPage } from '@/components/team-list-pagination';
import { displayRemovedMemberLabel } from '@/lib/display-labels';

export function RemovedMembersCard({
  removedMembers,
  userMap,
}: {
  removedMembers: RemovedTeamMemberRow[];
  userMap: TeamMemberMap;
}) {
  const { visibleItems, pagination, listRef } = useTeamListPage(removedMembers);
  if (removedMembers.length === 0) return null;
  return (
    <SettingsSection title="Removed members">
      <ul
        ref={listRef}
        tabIndex={-1}
        aria-label="Removed members"
        className="scroll-mt-16 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visibleItems.map((member) => {
          const user = userMap.get(member.userId);
          const memberLabel = displayRemovedMemberLabel(user);
          return (
            <li key={member.userId}>
              <CollectionRow>
                <CollectionRow.Title>{memberLabel}</CollectionRow.Title>
                <CollectionRow.Context>
                  {user?.email?.trim() !== memberLabel ? user?.email : undefined}
                </CollectionRow.Context>
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
      <TeamListPagination {...pagination} label="Removed member pages" noun="removed members" />
    </SettingsSection>
  );
}
