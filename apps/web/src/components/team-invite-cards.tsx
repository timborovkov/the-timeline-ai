import type {
  RemovedTeamMemberRow,
  TeamInviteRow,
  TeamMemberMap,
} from '@/components/team-member-types';

import { PendingInvitesCard } from '@/components/pending-invites-card';
import { RemovedMembersCard } from '@/components/removed-members-card';
import { InviteMemberForm } from '@/components/team-forms';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function TeamInviteCards({
  isOwner,
  invites,
  removedMembers,
  userMap,
}: {
  isOwner: boolean;
  invites: TeamInviteRow[];
  removedMembers: RemovedTeamMemberRow[];
  userMap: TeamMemberMap;
}) {
  return (
    <>
      <Card id="invite" className="scroll-mt-24">
        <CardHeader>
          <CardTitle as="h2">Invite a teammate</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteMemberForm canInviteAdmin={isOwner} />
        </CardContent>
      </Card>
      <PendingInvitesCard invites={invites} userMap={userMap} />
      <RemovedMembersCard removedMembers={removedMembers} userMap={userMap} />
    </>
  );
}
