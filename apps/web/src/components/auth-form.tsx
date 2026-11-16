'use client';

import Link from 'next/link';
import { useActionState, useReducer } from 'react';
import { useFormStatus } from 'react-dom';

import { signInAction, signUpAction, type SignInState, type SignUpState } from '@/app/actions/auth';
import { LastUsedBadge } from '@/components/last-used-badge';
import { SupportMailto } from '@/components/support-email-provider';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';

function SubmitButton({ disabled = false, label }: { disabled?: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} className="w-full">
      {pending ? 'Working…' : label}
    </Button>
  );
}

export function SignInForm({
  callbackUrl,
  lastUsed = false,
}: {
  callbackUrl?: string;
  lastUsed?: boolean;
}) {
  const [state, action] = useActionState<SignInState, FormData>(signInAction, {});
  return (
    <form action={action} className="space-y-4">
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="email">Email</Label>
          {lastUsed ? <LastUsedBadge /> : null}
        </div>
        <Input
          className="text-base sm:text-sm"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-sm text-primary underline underline-offset-4"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          className="text-base sm:text-sm"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <SubmitButton label="Sign in" />
    </form>
  );
}

export function SignUpForm({
  callbackUrl,
  inviteToken,
  legalPublicationReady = true,
  requiresTurnstile,
  turnstileSiteKey,
  lastUsed = false,
}: {
  callbackUrl?: string;
  inviteToken?: string;
  legalPublicationReady?: boolean;
  requiresTurnstile: boolean;
  turnstileSiteKey?: string;
  lastUsed?: boolean;
}) {
  const [state, action] = useActionState<SignUpState, FormData>(signUpAction, {});
  const [identity, updateIdentity] = useReducer(
    (
      current: { name: string; email: string },
      update: Partial<{ name: string; email: string }>,
    ) => ({ ...current, ...update }),
    { name: '', email: '' },
  );
  if (!legalPublicationReady) {
    return (
      <p role="status" className="text-sm leading-6 text-muted-foreground">
        New account creation is paused until the Terms are published. Existing users can still sign
        in.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-4">
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
      {inviteToken ? <input type="hidden" name="inviteToken" value={inviteToken} /> : null}
      <input type="hidden" name="termsVersion" value={TERMS_VERSION} />
      <input type="hidden" name="privacyVersion" value={PRIVACY_VERSION} />
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          className="text-base sm:text-sm"
          id="name"
          name="name"
          autoComplete="name"
          value={identity.name}
          onChange={(event) => {
            updateIdentity({ name: event.target.value });
          }}
          required
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="email">Email</Label>
          {lastUsed ? <LastUsedBadge /> : null}
        </div>
        <Input
          className="text-base sm:text-sm"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={identity.email}
          onChange={(event) => {
            updateIdentity({ email: event.target.value });
          }}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          className="text-base sm:text-sm"
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          aria-describedby="signup-password-hint"
          required
        />
        <p id="signup-password-hint" className="text-xs text-muted-foreground">
          Use at least 8 characters. A longer, unique password is safer.
        </p>
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
          <Link href="/terms" className="text-primary underline underline-offset-4">
            Terms of Use
          </Link>{' '}
          and acknowledge the{' '}
          <Link href="/privacy" className="text-primary underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      {turnstileSiteKey ? (
        <TurnstileWidget action="signup" siteKey={turnstileSiteKey} />
      ) : requiresTurnstile ? (
        <p role="alert" className="text-sm text-destructive">
          Account creation is temporarily unavailable. Try again later or email{' '}
          <SupportMailto className="underline underline-offset-4" /> for help.
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <SubmitButton label="Create account" disabled={requiresTurnstile && !turnstileSiteKey} />
    </form>
  );
}
