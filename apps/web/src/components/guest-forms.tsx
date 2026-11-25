'use client';

import { useActionState } from 'react';

import { resendEmailVerificationAction } from '@/app/actions/auth';
import { askGuestWork, inviteGuest, type GuestSelection } from '@/app/actions/guests';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHydrated } from '@/lib/use-hydrated';

export function AcceptGuestForm({ action }: { action: () => Promise<void> }) {
  const hydrated = useHydrated();
  return (
    <form action={action}>
      <Button type="submit" disabled={!hydrated}>
        Accept guest access
      </Button>
    </form>
  );
}

export function GuestVerificationForm({ invitation }: { invitation: string }) {
  const [state, action, pending] = useActionState(resendEmailVerificationAction, {});
  const hydrated = useHydrated();
  return (
    <form action={action} className="space-y-2">
      <p>Verify your email address before accepting guest access.</p>
      <input type="hidden" name="callbackUrl" value={invitation} />
      <Button type="submit" variant="outline" disabled={!hydrated || pending}>
        {pending ? 'Sending…' : 'Resend verification email'}
      </Button>
      <div aria-live="polite">
        {state.ok ? <p>Check your email for a verification link.</p> : null}
        {state.error ? <p>{state.error}</p> : null}
      </div>
    </form>
  );
}

export function InviteGuestForm({ teamId }: { teamId: string }) {
  const hydrated = useHydrated();
  const [state, action, pending] = useActionState(inviteGuest.bind(null, teamId), {});
  return (
    <form action={action} className="space-y-3">
      <label className="block max-w-sm">
        <span className="text-sm font-medium">Guest email</span>
        <Input name="email" type="email" required maxLength={254} />
      </label>
      <Button type="submit" disabled={!hydrated || pending}>
        Create invitation link
      </Button>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.url ? (
        <label className="block max-w-md">
          <span className="text-sm font-medium">Invitation link</span>
          <Input value={state.url} readOnly />
        </label>
      ) : null}
    </form>
  );
}

export function AskGuestWorkForm({
  teamId,
  selection,
}: {
  teamId: string;
  selection: GuestSelection | null;
}) {
  const hydrated = useHydrated();
  const [state, action, pending] = useActionState(askGuestWork.bind(null, teamId, selection), {});
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium">
            {selection?.kind === 'note'
              ? 'Question about this note'
              : selection
                ? 'Question about this record'
                : 'Question about shared work'}
          </span>
          <Input name="question" required maxLength={2000} />
        </label>
        <Button type="submit" disabled={!hydrated || pending}>
          {pending ? 'Asking…' : 'Ask'}
        </Button>
      </form>
      <div aria-live="polite">
        {state.error ? <p>{state.error}</p> : null}
        {state.answer ? <p className="whitespace-pre-wrap">{state.answer}</p> : null}
        {state.citations?.length ? (
          <ul className="mt-2 flex flex-wrap gap-x-4">
            {state.citations.map((source) => (
              <li key={`${source.kind}:${source.id}`}>
                <a className="underline" href={`/guest/${teamId}?${source.kind}=${source.id}`}>
                  {source.kind === 'note' ? 'Shared note' : 'Shared record'} {source.reference}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
