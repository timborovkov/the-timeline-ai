'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createTeamExportAction,
  downloadTeamExportAction,
  type CreateTeamExportState,
} from '@/app/actions/team-exports';
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

export function InviteMemberForm() {
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

interface TeamExportRow {
  id: string;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'expired';
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
  error: string | null;
}

export function TeamExportPanel({ exports }: { exports: TeamExportRow[] }) {
  const [state, action] = useActionState<CreateTeamExportState, FormData>(
    createTeamExportAction,
    {},
  );
  return (
    <div className="space-y-4">
      <form action={action} className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Builds a 24-hour archive of team data you are already allowed to see.
          </p>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          {state.ok ? <p className="text-sm text-muted-foreground">Export queued.</p> : null}
        </div>
        <Submit label="Start export" />
      </form>

      {exports.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {exports.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.status}</p>
                <p className="text-xs text-muted-foreground">
                  Created {row.createdAt.toLocaleString()}
                  {row.expiresAt ? ` · expires ${row.expiresAt.toLocaleString()}` : ''}
                </p>
                {row.error ? <p className="text-xs text-destructive">{row.error}</p> : null}
              </div>
              {row.status === 'ready' ? (
                <form action={downloadTeamExportAction}>
                  <input type="hidden" name="exportId" value={row.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Download
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
