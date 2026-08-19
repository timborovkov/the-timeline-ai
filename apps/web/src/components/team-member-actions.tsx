'use client';

import { RotateCw, UserMinus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, type SyntheticEvent } from 'react';

import {
  changeMemberRoleAction,
  removeMemberAction,
  resendInviteAction,
  revokeInviteAction,
  type TeamMutationResult,
} from '@/app/actions/teams';
import { useAppDialog } from '@/components/ui/app-dialog';
import { ItemActionGroup, ItemIconButton } from '@/components/ui/item-actions';
import { NativeSelect } from '@/components/ui/native-select';
import { notifyAction } from '@/lib/notify';

type TeamAction = (formData: FormData) => void | Promise<void>;

async function runTeamMutation(
  action: (formData: FormData) => Promise<TeamMutationResult>,
  formData: FormData,
): Promise<TeamMutationResult> {
  const result = await action(formData);
  return result.error ? { error: result.error } : { ok: true };
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
    <form ref={formRef} action={action} onSubmit={confirmSubmit} className="contents">
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
      className="min-w-0"
    >
      <input type="hidden" name="userId" value={userId} />
      <NativeSelect
        id={controlId}
        aria-label={`Role for ${memberLabel}`}
        name="role"
        defaultValue={memberRole}
        className="h-8 w-[7.5rem]"
        onChange={(event) => {
          event.currentTarget.form?.requestSubmit();
        }}
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
        <option value="owner">Owner</option>
      </NativeSelect>
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
      <ItemIconButton type="submit" label="Remove member" className="hover:text-danger">
        <UserMinus />
      </ItemIconButton>
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
      >
        <input type="hidden" name="inviteId" value={inviteId} />
        <ItemIconButton type="submit" label="Resend invite">
          <RotateCw />
        </ItemIconButton>
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
        <ItemIconButton type="submit" label="Revoke invite" className="hover:text-danger">
          <X />
        </ItemIconButton>
      </ConfirmingActionForm>
    </ItemActionGroup>
  );
}
