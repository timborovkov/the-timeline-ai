'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createTeamAction,
  inviteMemberAction,
  renameTeamAction,
  type CreateTeamState,
  type InviteState,
  type RenameTeamState,
} from '@/app/actions/teams';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Working…' : label}
    </Button>
  );
}

export function CreateTeamForm({ id = 'new-team-name' }: { id?: string }) {
  const [state, action] = useActionState<CreateTeamState, FormData>(createTeamAction, {});
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-2">
        <Label htmlFor={id}>Team name</Label>
        <Input id={id} name="name" placeholder="Acme Sales" required />
      </div>
      <Submit label="Create" />
      {state.error ? (
        <span className="self-center text-xs text-destructive">{state.error}</span>
      ) : null}
    </form>
  );
}

export function RenameTeamForm({ currentName, teamId }: { currentName: string; teamId: string }) {
  const [state, action] = useActionState<RenameTeamState, FormData>(renameTeamAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="teamId" value={teamId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="team-name">Team name</Label>
          <Input id="team-name" name="name" defaultValue={currentName} required maxLength={80} />
        </div>
        <Submit label="Rename" />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-muted-foreground">Team name updated.</p> : null}
    </form>
  );
}

export function InviteMemberForm({ canInviteAdmin }: { canInviteAdmin: boolean }) {
  const [state, action] = useActionState<InviteState, FormData>(inviteMemberAction, {});
  return (
    <form action={action} className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="flex-1 space-y-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            placeholder="teammate@example.com"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-role">Role</Label>
          <select
            id="invite-role"
            name="role"
            defaultValue="member"
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="member">Member</option>
            {canInviteAdmin ? <option value="admin">Admin</option> : null}
          </select>
        </div>
        <Submit label="Create invite" />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.inviteUrl ? (
        <div className="rounded-md border bg-muted p-3 text-xs">
          <p className="mb-1 font-medium">Invite link (copy and share):</p>
          <code className="break-all font-mono text-[12px]">{state.inviteUrl}</code>
          {state.sendStatus === 'sent' ? (
            <p className="mt-2 text-muted-foreground">Invite email sent.</p>
          ) : null}
          {state.sendStatus === 'failed' ? (
            <p className="mt-2 text-destructive">
              Email was not sent: {state.sendError ?? 'unknown error'}. The link still works.
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
