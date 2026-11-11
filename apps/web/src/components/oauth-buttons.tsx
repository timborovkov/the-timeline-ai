import type { LoginMethod } from '@/lib/last-login-method';

import { GitHubSignInButton } from '@/components/github-button';
import { GoogleSignInButton } from '@/components/google-button';
import { Separator } from '@/components/ui/separator';

export function OAuthSignInButtons({
  callbackUrl,
  inviteToken,
  google,
  github,
  lastLoginMethod,
}: {
  callbackUrl?: string;
  inviteToken?: string;
  google: boolean;
  github: boolean;
  lastLoginMethod?: LoginMethod | null;
}) {
  if (!google && !github) return null;

  return (
    <>
      <div className="space-y-2">
        {google ? (
          <GoogleSignInButton
            lastUsed={lastLoginMethod === 'google'}
            callbackUrl={callbackUrl}
            inviteToken={inviteToken}
          />
        ) : null}
        {github ? (
          <GitHubSignInButton
            lastUsed={lastLoginMethod === 'github'}
            callbackUrl={callbackUrl}
            inviteToken={inviteToken}
          />
        ) : null}
      </div>
      {inviteToken ? (
        <p className="text-xs text-muted-foreground">
          After you sign in we&rsquo;ll send you to the invite; accept it from there using the same
          email the invite was sent to.
        </p>
      ) : null}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" />
        <span>or</span>
        <Separator className="flex-1" />
      </div>
    </>
  );
}
