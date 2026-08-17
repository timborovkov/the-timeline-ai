'use client';

import { type ReactNode, useActionState, useEffect, useMemo, useSyncExternalStore } from 'react';
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
import { FormActionToast } from '@/components/form-action-toast';
import { TechnicalDetails } from '@/components/technical-details';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { notifyError } from '@/lib/notify';
import { DEFAULT_TIMEZONE, timezoneOptions } from '@/lib/timezones';

function unsubscribeTimezone(): void {
  return undefined;
}

function subscribeTimezone(): () => void {
  return unsubscribeTimezone;
}

const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
const serverTimezone = () => DEFAULT_TIMEZONE;

function Submit({
  label,
  pendingLabel = 'Working…',
  className,
}: {
  label: string;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className={className} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function FormFeedback({
  error,
  success,
  errorId,
  toastId,
  fieldError = false,
}: {
  error?: string;
  success?: string;
  errorId?: string;
  toastId: string;
  fieldError?: boolean;
}) {
  const { pending } = useFormStatus();
  const failure = fieldError && !pending ? error : undefined;

  return (
    <>
      <FormActionToast id={toastId} error={error} success={success} fieldError={fieldError} />
      <p
        id={errorId}
        aria-atomic="true"
        aria-live="assertive"
        className="text-sm text-destructive"
        role={failure ? 'alert' : undefined}
      >
        {failure ?? ''}
      </p>
    </>
  );
}

function FieldError({
  error,
  children,
}: {
  error?: string;
  children: (activeError: string | undefined) => ReactNode;
}) {
  const { pending } = useFormStatus();

  return children(pending ? undefined : error);
}

function InviteFeedback({
  inviteUrl,
  sendStatus,
  sendError,
}: Pick<InviteState, 'inviteUrl' | 'sendStatus' | 'sendError'>) {
  const status = !inviteUrl
    ? undefined
    : sendStatus === 'sent'
      ? 'Invite created and email sent. The invite link is ready to share.'
      : sendStatus === 'failed'
        ? undefined
        : 'Invite created. The invite link is ready to share.';
  const error =
    inviteUrl && sendStatus === 'failed'
      ? `Invite created, but the email was not sent: ${sendError ?? 'unknown error'}. The link is ready to share.`
      : undefined;

  return (
    <>
      <p
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role={status ? 'status' : undefined}
      >
        {status ?? ''}
      </p>
      <p
        aria-atomic="true"
        aria-live="assertive"
        className="sr-only"
        role={error ? 'alert' : undefined}
      >
        {error ?? ''}
      </p>
    </>
  );
}

export function CreateTeamForm({ id = 'new-team-name' }: { id?: string }) {
  const [state, action] = useActionState<CreateTeamState, FormData>(createTeamAction, {});
  const timezone = useSyncExternalStore(subscribeTimezone, browserTimezone, serverTimezone);
  const nameError = state.error === 'Invalid team name' ? state.error : undefined;
  const errorId = `${id}-error`;

  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="timezone" value={timezone} />
      <div className="flex-1 space-y-2">
        <Label htmlFor={id}>Team name</Label>
        <FieldError error={nameError}>
          {(activeNameError) => (
            <Input
              id={id}
              name="name"
              placeholder="Acme Sales"
              required
              className="transition-colors hover:border-border-strong"
              aria-invalid={activeNameError ? true : undefined}
              aria-describedby={activeNameError ? errorId : undefined}
            />
          )}
        </FieldError>
      </div>
      <Submit label="Create" />
      <div className="self-center">
        <FormFeedback
          toastId="create-team"
          error={state.error}
          errorId={errorId}
          fieldError={Boolean(nameError)}
        />
      </div>
    </form>
  );
}

export function TeamTimezoneForm({ timezone }: { timezone: string }) {
  const [state, action] = useActionState<TeamTimezoneState, FormData>(updateTeamTimezoneAction, {});
  const options = useMemo(() => timezoneOptions(timezone), [timezone]);
  const timezoneError = state.error === 'Choose a valid timezone' ? state.error : undefined;
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="team-timezone">Team timezone</Label>
        <FieldError error={timezoneError}>
          {(activeTimezoneError) => (
            <select
              id="team-timezone"
              name="timezone"
              defaultValue={timezone}
              className="h-9 w-full rounded-sm border border-input bg-background px-3 text-sm transition-colors hover:border-border-strong ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-invalid={activeTimezoneError ? true : undefined}
              aria-describedby={activeTimezoneError ? 'team-timezone-error' : undefined}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </FieldError>
        <p className="text-sm text-muted-foreground">
          Used for calendar views, event defaults, meeting schedules, daily digests, and
          workspace-relative dates in chat.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Submit label="Save timezone" />
        <FormFeedback
          toastId="team-timezone"
          error={state.error}
          success={state.ok ? 'Timezone updated' : undefined}
          errorId="team-timezone-error"
          fieldError={Boolean(timezoneError)}
        />
      </div>
    </form>
  );
}

export function RenameTeamForm({ currentName, teamId }: { currentName: string; teamId: string }) {
  const [state, action] = useActionState<RenameTeamState, FormData>(renameTeamAction, {});
  const nameError = state.error === 'Invalid team name' ? state.error : undefined;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="teamId" value={teamId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="team-name">Team name</Label>
          <FieldError error={nameError}>
            {(activeNameError) => (
              <Input
                id="team-name"
                name="name"
                defaultValue={currentName}
                required
                maxLength={80}
                className="transition-colors hover:border-border-strong"
                aria-invalid={activeNameError ? true : undefined}
                aria-describedby={activeNameError ? 'team-name-error' : undefined}
              />
            )}
          </FieldError>
        </div>
        <Submit label="Rename" />
      </div>
      <FormFeedback
        toastId="rename-team"
        error={state.error}
        success={state.ok ? 'Team name updated' : undefined}
        errorId="team-name-error"
        fieldError={Boolean(nameError)}
      />
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
  const sendersError =
    state.error === 'Enter valid email addresses only' ||
    state.error === 'Add at least one sender before enabling the whitelist'
      ? state.error
      : undefined;
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1">
        <Label>Team email address</Label>
        <code className="block break-all rounded-md bg-muted px-3 py-2 text-[12px]">
          {inboundEmail ?? 'Not configured'}
        </code>
      </div>
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={enabled}
          className="size-4 rounded-sm border-input accent-signal transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        Enable sender whitelist
      </label>
      <div className="space-y-2">
        <Label htmlFor="inbound-email-senders">Allowed senders</Label>
        <FieldError error={sendersError}>
          {(activeSendersError) => (
            <Textarea
              id="inbound-email-senders"
              name="senders"
              defaultValue={senders.join(', ')}
              placeholder="alice@example.com, vendor@example.net"
              className="min-h-28 transition-colors hover:border-border-strong"
              aria-invalid={activeSendersError ? true : undefined}
              aria-describedby={activeSendersError ? 'inbound-email-senders-error' : undefined}
            />
          )}
        </FieldError>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Submit label="Save email settings" />
        <FormFeedback
          toastId="inbound-email"
          error={state.error}
          success={state.ok ? 'Email settings updated' : undefined}
          errorId="inbound-email-senders-error"
          fieldError={Boolean(sendersError)}
        />
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
      <label className="flex min-h-9 items-center gap-3 text-sm">
        <input
          type="checkbox"
          name="dailyDigestEnabled"
          defaultChecked={enabled}
          className="size-4 rounded-sm border-input accent-signal transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <span>
          <span className="block font-medium">Send me a personal daily digest</span>
          <span className="block text-muted-foreground">
            Email or bot DMs configured for this workspace. Shared Slack or Telegram chats still
            receive the team digest. Individual inbox notifications are not emailed.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Submit label="Save digest setting" />
        <FormFeedback
          toastId="digest-preference"
          error={state.error}
          success={state.ok ? 'Digest setting updated' : undefined}
        />
      </div>
    </form>
  );
}

export function InviteMemberForm({ canInviteAdmin }: { canInviteAdmin: boolean }) {
  const [state, action] = useActionState<InviteState, FormData>(inviteMemberAction, {});
  const emailError = state.error === 'Invalid email' ? state.error : undefined;
  return (
    <form action={action} className="space-y-3">
      <InviteFeedback
        inviteUrl={state.inviteUrl}
        sendStatus={state.sendStatus}
        sendError={state.sendError}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="invite-email">Email</Label>
          <FieldError error={emailError}>
            {(activeEmailError) => (
              <Input
                id="invite-email"
                name="email"
                type="email"
                placeholder="teammate@example.com"
                required
                className="transition-colors hover:border-border-strong"
                aria-invalid={activeEmailError ? true : undefined}
                aria-describedby={activeEmailError ? 'invite-error' : undefined}
              />
            )}
          </FieldError>
        </div>
        <div className="space-y-2 sm:w-36">
          <Label htmlFor="invite-role">Role</Label>
          <select
            id="invite-role"
            name="role"
            defaultValue="member"
            className="h-9 w-full rounded-sm border border-input bg-background px-2 text-sm transition-colors hover:border-border-strong ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="member">Member</option>
            {canInviteAdmin ? <option value="admin">Admin</option> : null}
          </select>
        </div>
        <Submit
          label="Create invite"
          pendingLabel="Creating invite…"
          className="w-full sm:w-auto"
        />
      </div>
      <FormFeedback
        toastId="invite-member"
        error={state.error}
        success={
          state.inviteUrl
            ? state.sendStatus === 'sent'
              ? 'Invite created and email sent'
              : 'Invite created'
            : undefined
        }
        errorId="invite-error"
        fieldError={Boolean(emailError)}
      />
      {state.inviteUrl ? (
        <div className="rounded-md border bg-muted p-3 text-xs">
          <p className="mb-1 font-medium">Invite link (copy and share):</p>
          <code className="break-all font-mono text-[12px]">{state.inviteUrl}</code>
          {state.sendStatus === 'sent' ? (
            <p className="mt-2 text-muted-foreground">Invite email sent.</p>
          ) : null}
          {state.sendStatus === 'failed' ? (
            <p className="mt-2 text-destructive">
              Email was not sent: {state.sendError ?? 'unknown error'}. The link is ready to share.
            </p>
          ) : null}
          {!state.sendStatus ? (
            <p className="mt-2 text-muted-foreground">
              Invite created. The invite link is ready to share.
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

function teamExportDownloadErrorMessage(value: string | undefined): string | undefined {
  switch (value) {
    case 'invalid':
      return 'That export link is invalid. Refresh and try again.';
    case 'forbidden':
      return 'You no longer have permission to download team exports.';
    case 'unavailable':
      return 'This export is not ready or is no longer available. Refresh or start a new export.';
    default:
      return undefined;
  }
}

export function TeamExportPanel({
  exports,
  downloadError,
}: {
  exports: TeamExportRow[];
  downloadError?: string;
}) {
  const [state, action] = useActionState<CreateTeamExportState, FormData>(
    createTeamExportAction,
    {},
  );
  const downloadErrorMessage = teamExportDownloadErrorMessage(downloadError);
  useEffect(() => {
    if (downloadErrorMessage) notifyError('team-export:download', downloadErrorMessage);
  }, [downloadErrorMessage]);
  return (
    <div className="space-y-4">
      <form
        action={action}
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">
            Builds a 24-hour archive of team data you are already allowed to see.
          </p>
          <FormFeedback
            toastId="team-export"
            error={state.error}
            success={state.ok ? 'Export queued' : undefined}
          />
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
                {row.error ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs text-destructive">
                      This export could not be completed. Start a new export or try again later.
                    </p>
                    <TechnicalDetails
                      items={[
                        {
                          label: 'Export error',
                          value: row.error,
                          copyValue: row.error,
                        },
                      ]}
                    />
                  </div>
                ) : null}
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
