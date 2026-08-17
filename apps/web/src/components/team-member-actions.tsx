'use client';

import { useRouter } from 'next/navigation';
import { useRef, type SyntheticEvent } from 'react';
import { useFormStatus } from 'react-dom';

import {
  changeMemberRoleAction,
  removeMemberAction,
  resendInviteAction,
  revokeInviteAction,
  type TeamMutationResult,
} from '@/app/actions/teams';
import { useAppDialog } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { notifyAction } from '@/lib/notify';

type TeamAction = (formData: FormData) => void | Promise<void>;

async function runTeamMutation(
  action: (formData: FormData) => Promise<TeamMutationResult>,
  formData: FormData,
): Promise<TeamMutationResult> {
  const result = await action(formData);
  return result.error ? { error: result.error } : { ok: true };
}

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
  const router = useRouter();
  const controlId = `member-role-${userId}`;
  const helpId = `${controlId}-help`;

  return (
    <form
      action={async (formData) => {
        const result = await notifyAction({
          id: `member-role:${userId}`,
          loading: 'Updating role…',
          success: 'Role updated',
          error: 'Couldn’t update role',
          run: () => runTeamMutation(changeMemberRoleAction, formData),
          undo: {
            run: async () => {
              const undoData = new FormData();
              undoData.set('userId', userId);
              undoData.set('role', memberRole);
              const undone = await runTeamMutation(changeMemberRoleAction, undoData);
              if (!undone.error) router.refresh();
              return undone;
            },
          },
        });
        if (!result.error) router.refresh();
      }}
      className="w-full space-y-2 sm:w-auto"
    >
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
  const router = useRouter();
  return (
    <ConfirmingActionForm
      action={async (formData) => {
        const result = await notifyAction({
          id: `member:remove:${userId}`,
          loading: 'Removing member…',
          success: 'Member removed',
          error: 'Couldn’t remove member',
          run: () => runTeamMutation(removeMemberAction, formData),
        });
        if (!result.error) router.refresh();
      }}
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
  const router = useRouter();
  return (
    <ItemActionGroup label={`Actions for invite to ${inviteEmail}`}>
      <form
        action={async (formData) => {
          const result = await notifyAction({
            id: `invite:resend:${inviteId}`,
            loading: 'Resending invite…',
            success: 'Invite resent',
            error: 'Couldn’t resend invite',
            run: () => runTeamMutation(resendInviteAction, formData),
          });
          if (!result.error) router.refresh();
        }}
        className="w-full sm:w-auto"
      >
        <input type="hidden" name="inviteId" value={inviteId} />
        <SubmitButton label="Resend invite" pendingLabel="Resending invite…" />
      </form>
      <ConfirmingActionForm
        action={async (formData) => {
          const result = await notifyAction({
            id: `invite:revoke:${inviteId}`,
            loading: 'Revoking invite…',
            success: 'Invite revoked',
            error: 'Couldn’t revoke invite',
            run: () => runTeamMutation(revokeInviteAction, formData),
          });
          if (!result.error) router.refresh();
        }}
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
