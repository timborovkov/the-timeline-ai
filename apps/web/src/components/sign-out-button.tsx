'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { signOutAfterClearingLocalSession } from '@/lib/sign-out-session';

export function SignOutButton({
  callbackUrl,
  label = 'Sign out',
}: {
  callbackUrl?: string;
  label?: string;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setFailed(false);
          void signOutAfterClearingLocalSession(undefined, undefined, callbackUrl).catch(() => {
            setPending(false);
            setFailed(true);
          });
        }}
      >
        {pending ? 'Signing out…' : label}
      </Button>
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          Could not sign out. Check your connection and try again.
        </p>
      ) : null}
    </div>
  );
}
