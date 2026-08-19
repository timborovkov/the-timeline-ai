import Link from 'next/link';

import type { TeamInviteRow, TeamMemberMap } from '@/components/team-member-types';

import { PendingInviteItem } from '@/components/pending-invite-item';
import { SettingsSection } from '@/components/section-heading';
import { Button } from '@/components/ui/button';

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
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">No pending invites.</p>
          <Button asChild variant="outline" size="sm">
            <Link href="#invite">Create an invite</Link>
          </Button>
        </div>
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
