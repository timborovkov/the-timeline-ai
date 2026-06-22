'use client';

import { useActionState, useMemo, useSyncExternalStore } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createTeamExportAction,
  downloadTeamExportAction,
  type CreateTeamExportState,
} from '@/app/actions/team-exports';
import {
  createTeamAction,
  type DigestPreferenceState,
  inviteMemberAction,
  renameTeamAction,
  type TeamTimezoneState,
  updateDigestPreferenceAction,
  updateInboundEmailWhitelistAction,
  updateTeamTimezoneAction,
  type CreateTeamState,
  type InboundEmailWhitelistState,
  type InviteState,
  type RenameTeamState,
} from '@/app/actions/teams';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DEFAULT_TIMEZONE, timezoneOptions } from '@/lib/timezones';

function unsubscribeTimezone(): void {
  return undefined;
}

function subscribeTimezone(): () => void {
  return unsubscribeTimezone;
}

const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
const serverTimezone = () => DEFAULT_TIMEZONE;

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
  const timezone = useSyncExternalStore(subscribeTimezone, browserTimezone, serverTimezone);

  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="timezone" value={timezone} />
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

export function TeamTimezoneForm({ timezone }: { timezone: string }) {
  const [state, action] = useActionState<TeamTimezoneState, FormData>(updateTeamTimezoneAction, {});
  const options = useMemo(() => timezoneOptions(timezone), [timezone]);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="team-timezone">Team timezone</Label>
        <select
          id="team-timezone"
          name="timezone"
          defaultValue={timezone}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <p className="text-sm text-muted-foreground">
          Used for calendar views, event defaults, meeting schedules, daily digests, and
          workspace-relative dates in chat.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Submit label="Save timezone" />
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
        {state.ok ? <p className="text-sm text-muted-foreground">Timezone updated.</p> : null}
      </div>
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

export function InboundEmailWhitelistForm({
  inboundEmail,
  enabled,
  senders,
}: {
  inboundEmail: string | null;
  enabled: boolean;
  senders: string[];
}) {
  const [state, action] = useActionState<InboundEmailWhitelistState, FormData>(
    updateInboundEmailWhitelistAction,
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1">
        <Label>Team email address</Label>
        <code className="block break-all rounded-md bg-muted px-3 py-2 text-[12px]">
          {inboundEmail ?? 'Not configured'}
        </code>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={enabled}
          className="size-4 rounded border-input"
        />
        Enable sender whitelist
      </label>
      <div className="space-y-2">
        <Label htmlFor="inbound-email-senders">Allowed senders</Label>
        <Textarea
          id="inbound-email-senders"
          name="senders"
          defaultValue={senders.join(', ')}
          placeholder="alice@example.com, vendor@example.net"
          className="min-h-28"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Submit label="Save email settings" />
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
        {state.ok ? <p className="text-sm text-muted-foreground">Email settings updated.</p> : null}
      </div>
    </form>
  );
}

export function DigestPreferenceForm({ enabled }: { enabled: boolean }) {
  const [state, action] = useActionState<DigestPreferenceState, FormData>(
    updateDigestPreferenceAction,
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="dailyDigestEnabled"
          defaultChecked={enabled}
          className="mt-0.5 size-4 rounded border-input"
        />
        <span>
          <span className="block font-medium">Send me the daily team digest</span>
          <span className="block text-muted-foreground">
            One email per day with the generated summary and team updates. Individual inbox
            notifications are not emailed.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Submit label="Save digest setting" />
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
        {state.ok ? <p className="text-sm text-muted-foreground">Digest setting updated.</p> : null}
      </div>
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
