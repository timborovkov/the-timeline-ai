import { signOut } from 'next-auth/react';

import { clearAllFloatingChatSessionIds } from '@/lib/floating-chat-session-storage';
import { safeSameOriginPath } from '@/lib/safe-redirect';

export async function signOutAfterClearingLocalSession(
  storage?: Storage,
  assign: (url: string) => void = (url) => {
    window.location.assign(url);
  },
  callbackUrl?: string,
): Promise<void> {
  try {
    clearAllFloatingChatSessionIds(storage ?? window.localStorage);
  } catch {
    // Private mode and some browser policies throw on Storage access.
  }
  const continuation = safeSameOriginPath(callbackUrl, '', {
    blockedPaths: ['/sign-in', '/sign-up'],
  });
  const destination = continuation
    ? `/sign-in?callbackUrl=${encodeURIComponent(continuation)}`
    : '/sign-in';
  await signOut({ redirect: false, redirectTo: destination });
  assign(destination);
}
