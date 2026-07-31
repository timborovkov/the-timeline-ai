import type {
  RemovedTeamMemberRow,
  TeamInviteRow,
  TeamMemberMap,
  TeamMemberRow,
} from '@/components/team-member-types';

import { TeamInviteCards } from '@/components/team-invite-cards';
import { MembersCard } from '@/components/team-members-card';

export type {
  RemovedTeamMemberRow,
  TeamInviteRow,
  TeamMemberMap,
  TeamMemberRow,
} from '@/components/team-member-types';

export function TeamMembersSettings({
  members,
  userMap,
  isAdmin,
  isOwner,
  currentUserId,
  invites,
  removedMembers,
}: {
  members: TeamMemberRow[];
  userMap: TeamMemberMap;
  isAdmin: boolean;
  isOwner: boolean;
  currentUserId: string;
  invites: TeamInviteRow[];
  removedMembers: RemovedTeamMemberRow[];
}) {
  return (
    <>
      <MembersCard
        members={members}
        userMap={userMap}
        isAdmin={isAdmin}
        isOwner={isOwner}
        currentUserId={currentUserId}
      />
      {isAdmin ? (
        <TeamInviteCards
          isOwner={isOwner}
          invites={invites}
          removedMembers={removedMembers}
          userMap={userMap}
        />
      ) : null}
    </>
  );
}
