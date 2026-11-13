import type {
  RemovedTeamMemberRow,
  TeamInviteRow,
  TeamMemberMap,
} from '@/components/team-member-types';

import { PendingInvitesCard } from '@/components/pending-invites-card';
import { RemovedMembersCard } from '@/components/removed-members-card';
import { SettingsSection } from '@/components/section-heading';
import { InviteMemberForm } from '@/components/team-forms';
import { getSiteUrl } from '@/lib/site-url';

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
      <SettingsSection id="invite" title="Invite a teammate">
        <InviteMemberForm canInviteAdmin={isOwner} />
      </SettingsSection>
      <PendingInvitesCard siteUrl={getSiteUrl()} invites={invites} userMap={userMap} />
      <RemovedMembersCard removedMembers={removedMembers} userMap={userMap} />
    </>
  );
}
