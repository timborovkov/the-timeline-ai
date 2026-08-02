import type { TeamInviteRow, TeamMemberInfo } from '@/components/team-member-types';

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
  const deliveryStatus =
    invite.sendStatus === 'failed'
      ? `Email delivery failed. ${invite.sendError ?? 'Try resending the invite or share the link.'}`
      : `Email ${invite.sendStatus}${invite.lastSentAt ? ` · sent ${invite.lastSentAt.toLocaleDateString()}` : ''}`;

  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="break-all text-sm font-medium">{invite.email}</p>
          <p className="text-xs text-fg-muted">
            {invite.role} · invited by {inviter?.name ?? inviter?.email ?? 'Unknown'} · expires{' '}
            {invite.expiresAt.toLocaleDateString()}
          </p>
          <p
            className={
              invite.sendStatus === 'failed' ? 'text-xs text-danger' : 'text-xs text-fg-muted'
            }
          >
            {deliveryStatus}
          </p>
        </div>
        <PendingInviteActions inviteEmail={invite.email} inviteId={invite.id} />
      </div>
      <code className="block w-full break-all rounded-md bg-surface-2 px-3 py-2 text-[12px]">
        {inviteUrl}
      </code>
    </li>
  );
}
