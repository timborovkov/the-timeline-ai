import type { TeamInviteRow, TeamMemberInfo } from '@/components/team-member-types';

import { CollectionRow } from '@/components/collections/collection-row';
import { CopyButton } from '@/components/copy-button';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { PendingInviteActions } from '@/components/team-member-actions';
import { getSiteUrl } from '@/lib/site-url';

export function PendingInviteItem({
  invite,
  inviter,
}: {
  invite: TeamInviteRow;
  inviter: TeamMemberInfo | undefined;
}) {
  const inviteUrl = `${getSiteUrl()}/accept-invite/${invite.token}`;
  const deliveryFailed = invite.sendStatus === 'failed';
  const deliveryStatus = deliveryFailed
    ? `Email delivery failed. ${invite.sendError ?? 'Try resending the invite or share the link.'}`
    : invite.sendStatus === 'sent'
      ? 'Email sent'
      : `Email ${invite.sendStatus}`;

  return (
    <li>
      <CollectionRow>
        <CollectionRow.Title>{invite.email}</CollectionRow.Title>
        <CollectionRow.Context>
          {invite.role} · invited by {inviter?.name ?? inviter?.email ?? 'Unknown'}
        </CollectionRow.Context>
        <CollectionRow.Subtitle>
          <span className="font-mono text-[11px] text-fg-dim">{inviteUrl}</span>
        </CollectionRow.Subtitle>
        <CollectionRow.Metadata>
          <>
            <RelativeTimestamp prefix="Expires" value={invite.expiresAt} />
            {invite.lastSentAt ? (
              <RelativeTimestamp prefix="Sent" value={invite.lastSentAt} />
            ) : null}
            <span
              className={deliveryFailed ? 'text-[11px] text-danger' : 'text-[11px] text-fg-dim'}
            >
              {deliveryStatus}
            </span>
          </>
        </CollectionRow.Metadata>
        <CollectionRow.Actions>
          <CopyButton appearance="icon" label="Copy invite link" value={inviteUrl} />
          <PendingInviteActions inviteEmail={invite.email} inviteId={invite.id} />
        </CollectionRow.Actions>
      </CollectionRow>
    </li>
  );
}
