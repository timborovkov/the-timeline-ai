'use client';

import { useRef, type SyntheticEvent } from 'react';
import { useFormStatus } from 'react-dom';

import {
  changeMemberRoleAction,
  removeMemberAction,
  resendInviteAction,
  revokeInviteAction,
} from '@/app/actions/teams';
import { useAppDialog } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';

type TeamAction = (formData: FormData) => void | Promise<void>;

function SubmitButton({
  label,
  pendingLabel,
  variant = 'outline',
}: {
  label: string;
  pendingLabel: string;
  variant?: 'destructive' | 'outline';
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size="sm"
      className="w-full sm:w-auto"
      disabled={pending}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

function ConfirmingActionForm({
  action,
  children,
  confirmLabel,
  description,
  title,
}: {
  action: TeamAction;
  children: React.ReactNode;
  confirmLabel: string;
  description: string;
  title: string;
}) {
  const dialog = useAppDialog();
  const formRef = useRef<HTMLFormElement>(null);
  const allowSubmitRef = useRef(false);

  function confirmSubmit(event: SyntheticEvent<HTMLFormElement>) {
    if (allowSubmitRef.current) {
      allowSubmitRef.current = false;
      return;
    }

    event.preventDefault();
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void dialog
      .confirm({ title, description, confirmLabel, destructive: true })
      .then((confirmed) => {
        if (!confirmed) {
          trigger?.focus();
          return;
        }
        allowSubmitRef.current = true;
        formRef.current?.requestSubmit();
      });
  }

  return (
    <form ref={formRef} action={action} onSubmit={confirmSubmit} className="w-full sm:w-auto">
      {children}
      {dialog.node}
    </form>
  );
}

export function MemberRoleForm({
  memberLabel,
  memberRole,
  userId,
}: {
  memberLabel: string;
  memberRole: string;
  userId: string;
}) {
  const controlId = `member-role-${userId}`;
  const helpId = `${controlId}-help`;

  return (
    <form action={changeMemberRoleAction} className="w-full space-y-2 sm:w-auto">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 space-y-1">
          <label htmlFor={controlId} className="text-xs font-medium text-fg-muted">
            Role
          </label>
          <select
            id={controlId}
            aria-label={`Role for ${memberLabel}`}
            aria-describedby={helpId}
            name="role"
            defaultValue={memberRole}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm sm:w-36"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <SubmitButton label="Save role" pendingLabel="Saving role…" />
      </div>
      <p id={helpId} className="text-xs text-fg-muted sm:max-w-72">
        Changing a role updates permissions immediately. Owners can manage all team settings.
      </p>
    </form>
  );
}

export function RemoveMemberForm({ memberLabel, userId }: { memberLabel: string; userId: string }) {
  return (
    <ConfirmingActionForm
      action={removeMemberAction}
      title={`Remove ${memberLabel}?`}
      description={`${memberLabel} will lose access to this team. You can review removed members below.`}
      confirmLabel="Remove member"
    >
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton label="Remove member" pendingLabel="Removing member…" variant="destructive" />
    </ConfirmingActionForm>
  );
}

export function PendingInviteActions({
  inviteEmail,
  inviteId,
}: {
  inviteEmail: string;
  inviteId: string;
}) {
  return (
    <ItemActionGroup label={`Actions for invite to ${inviteEmail}`}>
      <form action={resendInviteAction} className="w-full sm:w-auto">
        <input type="hidden" name="inviteId" value={inviteId} />
        <SubmitButton label="Resend invite" pendingLabel="Resending invite…" />
      </form>
      <ConfirmingActionForm
        action={revokeInviteAction}
        title={`Revoke invite for ${inviteEmail}?`}
        description="The current invite link will stop working. You can create a new invite later."
        confirmLabel="Revoke invite"
      >
        <input type="hidden" name="inviteId" value={inviteId} />
        <SubmitButton label="Revoke invite" pendingLabel="Revoking invite…" variant="destructive" />
      </ConfirmingActionForm>
    </ItemActionGroup>
  );
}
