'use client';

import { useFormState, useFormStatus } from 'react-dom';

import {
  createTeamAction,
  inviteMemberAction,
  type CreateTeamState,
  type InviteState,
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

export function CreateTeamForm() {
  const [state, action] = useFormState<CreateTeamState, FormData>(createTeamAction, {});
  return (
    <form action={action} className="flex items-end gap-3">
      <div className="flex-1 space-y-2">
        <Label htmlFor="new-team-name">Team name</Label>
        <Input id="new-team-name" name="name" placeholder="Acme Sales" required />
      </div>
      <Submit label="Create" />
      {state.error ? (
        <span className="self-center text-xs text-destructive">{state.error}</span>
      ) : null}
    </form>
  );
}

export function InviteMemberForm() {
  const [state, action] = useFormState<InviteState, FormData>(inviteMemberAction, {});
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
            <option value="admin">Admin</option>
          </select>
        </div>
        <Submit label="Create invite" />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.inviteUrl ? (
        <div className="rounded-md border bg-muted p-3 text-xs">
          <p className="mb-1 font-medium">Invite link (copy and share):</p>
          <code className="break-all font-mono text-[12px]">{state.inviteUrl}</code>
        </div>
      ) : null}
    </form>
  );
}
