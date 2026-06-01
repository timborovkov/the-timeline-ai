'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { signInAction, signUpAction, type SignInState, type SignUpState } from '@/app/actions/auth';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function SubmitButton({ disabled = false, label }: { disabled?: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} className="w-full">
      {pending ? 'Working…' : label}
    </Button>
  );
}

export function SignInForm({ callbackUrl }: { callbackUrl?: string }) {
  const [state, action] = useActionState<SignInState, FormData>(signInAction, {});
  return (
    <form action={action} className="space-y-4">
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <SubmitButton label="Sign in" />
    </form>
  );
}

export function SignUpForm({
  inviteToken,
  requiresTurnstile,
  turnstileSiteKey,
}: {
  inviteToken?: string;
  requiresTurnstile: boolean;
  turnstileSiteKey?: string;
}) {
  const [state, action] = useActionState<SignUpState, FormData>(signUpAction, {});
  return (
    <form action={action} className="space-y-4">
      {inviteToken ? <input type="hidden" name="inviteToken" value={inviteToken} /> : null}
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" autoComplete="name" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <label className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
        <input
          type="checkbox"
          name="legalAccepted"
          required
          className="mt-1 size-4 rounded-sm border-border"
        />
        <span>
          I agree to the{' '}
          <Link href="/terms" className="text-primary hover:underline">
            Terms of Use
          </Link>{' '}
          and acknowledge the{' '}
          <Link href="/privacy" className="text-primary hover:underline">
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      {turnstileSiteKey ? (
        <TurnstileWidget action="signup" siteKey={turnstileSiteKey} />
      ) : requiresTurnstile ? (
        <p className="text-sm text-destructive">Account creation protection is not configured.</p>
      ) : null}
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <SubmitButton label="Create account" disabled={requiresTurnstile && !turnstileSiteKey} />
    </form>
  );
}
