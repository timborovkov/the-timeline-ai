'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import {
  requestPasswordResetAction,
  resetPasswordAction,
  type RecoveryState,
} from '@/app/actions/password-recovery';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<RecoveryState, FormData>(
    requestPasswordResetAction,
    {},
  );
  return (
    <form action={action} className="space-y-4">
      {state.ok ? (
        <p role="status" className="text-sm text-muted-foreground">
          If an account with a password exists for that email, we’ll send a reset link. Check your
          inbox and spam folder. You can request another link below.
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>
      <p className="text-sm text-muted-foreground">
        If you use Google or GitHub to sign in, continue with that provider on the sign-in page.
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<RecoveryState, FormData>(resetPasswordAction, {});
  if (state.ok)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Your password has been reset and all previous sessions have been signed out. Sign in below
        with your new password.
      </p>
    );
  if (state.invalidToken)
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
        <Link href="/forgot-password" className="text-sm text-primary hover:underline">
          Request a new reset link
        </Link>
      </div>
    );
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={200}
          required
          aria-describedby="password-help"
        />
        <p id="password-help" className="text-xs text-muted-foreground">
          Use 8–200 characters.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmation">Confirm new password</Label>
        <Input
          id="confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={200}
          required
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Resetting…' : 'Reset password'}
      </Button>
    </form>
  );
}
