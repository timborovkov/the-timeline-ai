import { Mail } from 'lucide-react';

import type { TeamInviteRow, TeamMemberMap } from '@/components/team-member-types';

import { EmptyState } from '@/components/empty-state';
import { PendingInviteItem } from '@/components/pending-invite-item';
import { SettingsSection } from '@/components/section-heading';

export function PendingInvitesCard({
  invites,
  userMap,
}: {
  invites: TeamInviteRow[];
  userMap: TeamMemberMap;
}) {
  return (
    <SettingsSection title="Pending invites">
      {invites.length === 0 ? (
        <EmptyState
          icon={Mail}
          size="inset"
          title="No pending invites"
          body="Create an invite when you want to bring someone onto this team."
          href="#invite"
          action="Create an invite"
        />
      ) : (
        <ul>
          {invites.map((invite) => (
            <PendingInviteItem
              key={invite.id}
              invite={invite}
              inviter={userMap.get(invite.invitedByUserId)}
            />
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
