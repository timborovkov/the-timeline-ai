'use client';

import { type ReactNode, useActionState, useMemo, useSyncExternalStore } from 'react';
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
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { CopyableTextField } from '@/components/copyable-text-field';
import { FormActionToast } from '@/components/form-action-toast';
import { RedirectActionToast } from '@/components/redirect-action-toast';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { TechnicalDetails } from '@/components/technical-details';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
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

function Submit({
  label,
  pendingLabel = 'Working…',
  className,
  variant = 'outline',
  size = 'sm',
}: {
  label: string;
  pendingLabel?: string;
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} className={className} disabled={pending}>
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
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="timezone" value={timezone} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label htmlFor={id} size="sm">
          Team name
        </Label>
        <FieldError error={nameError}>
          {(activeNameError) => (
            <Input
              id={id}
              name="name"
              placeholder="Acme Sales"
              required
              aria-invalid={activeNameError ? true : undefined}
              aria-describedby={activeNameError ? errorId : undefined}
            />
          )}
        </FieldError>
      </div>
      <Submit label="Create" variant="default" />
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
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="team-timezone" size="sm">
          Team timezone
        </Label>
        <FieldError error={timezoneError}>
          {(activeTimezoneError) => (
            <NativeSelect
              id="team-timezone"
              name="timezone"
              defaultValue={timezone}
              aria-invalid={activeTimezoneError ? true : undefined}
              aria-describedby={activeTimezoneError ? 'team-timezone-error' : undefined}
              onChange={(event) => {
                event.currentTarget.form?.requestSubmit();
              }}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </NativeSelect>
          )}
        </FieldError>
        <p className="text-xs text-fg-dim">
          Used for calendar views, event defaults, meeting schedules, daily digests, and
          workspace-relative dates in chat.
        </p>
      </div>
      <FormFeedback
        toastId="team-timezone"
        error={state.error}
        success={state.ok ? 'Timezone updated' : undefined}
        errorId="team-timezone-error"
        fieldError={Boolean(timezoneError)}
      />
    </form>
  );
}

export function RenameTeamForm({ currentName, teamId }: { currentName: string; teamId: string }) {
  const [state, action] = useActionState<RenameTeamState, FormData>(renameTeamAction, {});
  const nameError = state.error === 'Invalid team name' ? state.error : undefined;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="teamId" value={teamId} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="team-name" size="sm">
            Team name
          </Label>
          <FieldError error={nameError}>
            {(activeNameError) => (
              <Input
                id="team-name"
                name="name"
                defaultValue={currentName}
                required
                maxLength={80}
                aria-invalid={activeNameError ? true : undefined}
                aria-describedby={activeNameError ? 'team-name-error' : undefined}
              />
            )}
          </FieldError>
        </div>
        <Submit label="Rename" variant="default" />
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
    <form action={action} className="space-y-3">
      <CopyableTextField
        id="team-inbound-email"
        label="Team email address"
        value={inboundEmail}
        copyLabel="Copy team email"
        description="Forward, CC, or BCC mail to this address to capture it on the timeline."
      />
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={enabled}
          className="size-4 rounded-sm border-input accent-signal transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        Enable sender whitelist
      </label>
      <div className="space-y-1.5">
        <Label htmlFor="inbound-email-senders" size="sm">
          Allowed senders
        </Label>
        <FieldError error={sendersError}>
          {(activeSendersError) => (
            <Textarea
              id="inbound-email-senders"
              name="senders"
              defaultValue={senders.join(', ')}
              placeholder="alice@example.com, vendor@example.net"
              className="min-h-24"
              aria-invalid={activeSendersError ? true : undefined}
              aria-describedby={activeSendersError ? 'inbound-email-senders-error' : undefined}
            />
          )}
        </FieldError>
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
    <form action={action} className="space-y-3">
      <label className="flex min-h-9 items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="dailyDigestEnabled"
          defaultChecked={enabled}
          className="mt-0.5 size-4 rounded-sm border-input accent-signal transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onChange={(event) => {
            event.currentTarget.form?.requestSubmit();
          }}
        />
        <span>
          <span className="block font-medium">Send me a personal daily digest</span>
          <span className="mt-0.5 block text-xs text-fg-dim">
            Email or bot DMs configured for this workspace. Shared Slack or Telegram chats still
            receive the team digest. Individual inbox notifications are not emailed.
          </span>
        </span>
      </label>
      <FormFeedback
        toastId="digest-preference"
        error={state.error}
        success={state.ok ? 'Digest setting updated' : undefined}
      />
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="invite-email" size="sm">
            Email
          </Label>
          <FieldError error={emailError}>
            {(activeEmailError) => (
              <Input
                id="invite-email"
                name="email"
                type="email"
                placeholder="teammate@example.com"
                required
                aria-invalid={activeEmailError ? true : undefined}
                aria-describedby={activeEmailError ? 'invite-error' : undefined}
              />
            )}
          </FieldError>
        </div>
        <div className="space-y-1.5 sm:w-32">
          <Label htmlFor="invite-role" size="sm">
            Role
          </Label>
          <NativeSelect id="invite-role" name="role" defaultValue="member">
            <option value="member">Member</option>
            {canInviteAdmin ? <option value="admin">Admin</option> : null}
          </NativeSelect>
        </div>
        <Submit label="Create invite" pendingLabel="Creating invite…" variant="default" />
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
        <div className="space-y-2 border-t border-border pt-3 text-xs">
          <p className="font-medium">Invite link (copy and share):</p>
          <code className="block break-all font-mono text-[12px] text-fg-muted">
            {state.inviteUrl}
          </code>
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
  return (
    <div className="space-y-3">
      <RedirectActionToast id="team-export:download" error={downloadErrorMessage} />
      <form
        action={action}
        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-fg-muted">
            Builds a 24-hour archive of team data you are already allowed to see.
          </p>
          <FormFeedback
            toastId="team-export"
            error={state.error}
            success={state.ok ? 'Export queued' : undefined}
          />
        </div>
        <Submit label="Start export" variant="default" />
      </form>

      {exports.length > 0 ? (
        <ul>
          {exports.map((row) => (
            <li key={row.id}>
              <CollectionRow>
                <CollectionRow.Title>
                  <CollectionStatus value={row.status} />
                </CollectionRow.Title>
                <CollectionRow.Metadata>
                  <>
                    <RelativeTimestamp prefix="Created" value={row.createdAt} />
                    {row.expiresAt ? (
                      <RelativeTimestamp prefix="Expires" value={row.expiresAt} />
                    ) : null}
                  </>
                </CollectionRow.Metadata>
                <CollectionRow.Actions>
                  {row.status === 'ready' ? (
                    <form action={downloadTeamExportAction}>
                      <input type="hidden" name="exportId" value={row.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Download
                      </Button>
                    </form>
                  ) : null}
                </CollectionRow.Actions>
              </CollectionRow>
              {row.error ? (
                <div className="space-y-2 px-3 pb-3">
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
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
