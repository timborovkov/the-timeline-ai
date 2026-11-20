import { CollectionRow } from '@/components/collections/collection-row';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { TeamListRow } from '@/components/team-list-row';
import { PendingInviteActions } from '@/components/team-member-actions';
import type { TeamInviteRow, TeamMemberInfo } from '@/components/team-member-types';
import { displayMemberLabel } from '@/lib/display-labels';

export function PendingInviteItem({
  invite,
  inviter,
}: {
  invite: TeamInviteRow;
  inviter: TeamMemberInfo | undefined;
}) {
  const deliveryFailed = invite.sendStatus === 'failed';
  const deliveryStatus = deliveryFailed
    ? `Email delivery failed. ${invite.sendError ?? 'Resend to get a fresh link.'}`
    : invite.sendStatus === 'sent'
      ? 'Email sent'
      : `Email ${invite.sendStatus}`;

  return (
    <TeamListRow>
      <CollectionRow.Title>{invite.email}</CollectionRow.Title>
      <CollectionRow.Context>
        {invite.role} · invited by {displayMemberLabel(inviter)}
      </CollectionRow.Context>
      <CollectionRow.Metadata>
        <>
          <RelativeTimestamp prefix="Expires" value={invite.expiresAt} />
          {invite.lastSentAt ? <RelativeTimestamp prefix="Sent" value={invite.lastSentAt} /> : null}
          <span className={deliveryFailed ? 'text-[11px] text-danger' : 'text-[11px] text-fg-dim'}>
            {deliveryStatus}
          </span>
        </>
      </CollectionRow.Metadata>
      <CollectionRow.Actions>
        <PendingInviteActions inviteEmail={invite.email} inviteId={invite.id} />
      </CollectionRow.Actions>
    </TeamListRow>
  );
}
