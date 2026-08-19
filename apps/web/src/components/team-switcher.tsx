'use client';

import { Check, ChevronsUpDown, Mail, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { TeamMembership } from '@/lib/active-team';

import { acceptRecipientInviteAction, declineInviteAction } from '@/app/actions/invites';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { CreateTeamForm } from '@/components/team-forms';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { initials } from '@/lib/initials';
import { cn } from '@/lib/utils';

export interface RecipientInvite {
  id: string;
  teamName: string;
  role: 'admin' | 'member';
  expiresAt: string;
  invitedBy: string;
}

interface Props {
  active: TeamMembership;
  memberships: TeamMembership[];
  recipientInvites?: RecipientInvite[];
  /**
   * - `full` (default): wide button suitable for the mobile sheet.
   * - `rail`: 36px square trigger for the 56px desktop rail.
   */
  variant?: 'full' | 'rail';
  /**
   * Keeps the modal in a native dialog's top-layer subtree when the trigger
   * lives inside one (the mobile navigation sheet).
   */
  portalContainer?: HTMLElement | null;
}

const EMPTY_RECIPIENT_INVITES: RecipientInvite[] = [];

function TeamSwitchForm({
  activeTeamId,
  membership,
}: {
  activeTeamId: string;
  membership: TeamMembership;
}) {
  const [switching, setSwitching] = useState(false);
  const isActive = membership.teamId === activeTeamId;

  return (
    <>
      <output className="sr-only" aria-live="polite">
        {switching ? `Opening ${membership.teamName}` : ''}
      </output>
      <form
        action={`/app/team/switch/${membership.teamId}`}
        method="post"
        aria-busy={switching}
        onSubmit={() => {
          setSwitching(true);
        }}
      >
        <button
          type="submit"
          disabled={isActive || switching}
          aria-disabled={switching || undefined}
          aria-current={isActive ? 'true' : undefined}
          className={cn(
            'group flex w-full items-center justify-between rounded-sm border px-4 py-3 text-left transition-colors',
            isActive
              ? 'border-signal/40 bg-signal-soft text-fg'
              : 'border-border bg-surface hover:border-border-strong hover:bg-surface-2',
          )}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-sm border border-border bg-bg text-xs font-semibold text-fg">
              {initials(membership.teamName)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{membership.teamName}</span>
              <span className="block text-xs capitalize text-fg-dim">{membership.role}</span>
            </span>
          </span>
          {isActive ? (
            <span className="flex items-center gap-2 text-xs font-medium text-signal">
              Active <Check aria-hidden="true" className="size-4" />
            </span>
          ) : switching ? (
            <span className="text-xs text-fg-muted">Opening…</span>
          ) : (
            <ChevronsUpDown
              aria-hidden="true"
              className="size-4 rotate-90 text-fg-dim transition-colors group-hover:text-fg"
            />
          )}
        </button>
      </form>
    </>
  );
}

function RecipientInviteActionButton({
  label,
  pendingLabel,
  variant,
}: {
  label: string;
  pendingLabel: string;
  variant: 'accept' | 'decline';
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <output className="sr-only" aria-live="polite">
        {pending ? pendingLabel : ''}
      </output>
      <button
        type="submit"
        disabled={pending}
        className={cn(
          'inline-flex h-9 w-full items-center justify-center gap-2 rounded-sm border px-3 text-sm font-medium sm:w-auto',
          variant === 'accept'
            ? 'border-signal/40 bg-signal-soft text-signal hover:bg-signal/20'
            : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg',
        )}
      >
        {variant === 'accept' ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <X aria-hidden="true" className="size-4" />
        )}
        {pending ? pendingLabel : label}
      </button>
    </>
  );
}

export function TeamSwitcher({
  active,
  memberships,
  recipientInvites = EMPTY_RECIPIENT_INVITES,
  variant = 'full',
  portalContainer,
}: Props) {
  const monogram = initials(active.teamName);
  const hasInvites = recipientInvites.length > 0;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Switch team — current: ${active.teamName}`}
          className={cn(
            'rounded-sm border border-border bg-surface text-left transition-colors hover:border-border-strong',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
            variant === 'rail'
              ? 'grid size-9 place-items-center text-xs font-semibold text-fg'
              : 'flex w-full items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2',
          )}
          title={variant === 'rail' ? `Team · ${active.teamName}` : undefined}
        >
          {variant === 'rail' ? (
            <span aria-hidden="true">{monogram}</span>
          ) : (
            <>
              <span className="grid size-7 shrink-0 place-items-center rounded-sm border border-border bg-bg font-mono text-[11px] font-semibold text-fg">
                {monogram}
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-sm font-medium text-fg">{active.teamName}</span>
                <span className="truncate text-xs text-fg-dim">Active team</span>
              </span>
              <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-fg-dim" />
            </>
          )}
        </button>
      </DialogTrigger>
      <DialogContent
        portalContainer={portalContainer}
        className="max-h-[min(720px,calc(100vh-2rem))] overflow-y-auto border-border bg-bg p-0 sm:max-w-2xl"
      >
        <div className="border-b border-border px-6 py-5">
          <DialogHeader>
            <DialogTitle className="text-xl tracking-tight">Teams</DialogTitle>
            <DialogDescription className="sr-only">
              Team workspace switcher, invitations, and team creation.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid gap-6 px-6 py-5">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-fg">Your teams</h2>
              <span className="font-mono text-[11px] text-fg-dim">{memberships.length}</span>
            </div>
            <p className="text-xs text-fg-muted">
              Your current team stays active until another workspace opens.
            </p>
            <div className="grid gap-2">
              {memberships.map((membership) => (
                <TeamSwitchForm
                  key={membership.teamId}
                  activeTeamId={active.teamId}
                  membership={membership}
                />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-fg">Invites sent to you</h2>
              {hasInvites ? (
                <span className="rounded-sm bg-signal-soft px-2 py-0.5 font-mono text-[11px] text-signal">
                  {recipientInvites.length} pending
                </span>
              ) : null}
            </div>
            {hasInvites ? (
              <div className="grid gap-2">
                {recipientInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="border-b border-border/80 px-3 py-2 last:border-b-0"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Mail className="size-4 shrink-0 text-signal" />
                          <p className="truncate text-sm font-medium">{invite.teamName}</p>
                        </div>
                        <p className="mt-1 break-words text-xs text-fg-dim">
                          {invite.role} · invited by {invite.invitedBy} · expires{' '}
                          <RelativeTimestamp value={invite.expiresAt} />
                        </p>
                      </div>
                      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                        <form action={acceptRecipientInviteAction}>
                          <input type="hidden" name="inviteId" value={invite.id} />
                          <RecipientInviteActionButton
                            label="Accept"
                            pendingLabel="Accepting invite…"
                            variant="accept"
                          />
                        </form>
                        <form action={declineInviteAction}>
                          <input type="hidden" name="inviteId" value={invite.id} />
                          <RecipientInviteActionButton
                            label="Decline"
                            pendingLabel="Declining invite…"
                            variant="decline"
                          />
                        </form>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-fg-dim">No pending invites for your account.</p>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Plus className="size-4 text-fg-dim" />
              <h2 className="text-base font-semibold text-fg">Create team</h2>
            </div>
            <CreateTeamForm id={`new-team-name-${variant}`} />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
