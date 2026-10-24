import { signOut } from 'next-auth/react';

import { clearAllFloatingChatSessionIds } from '@/lib/floating-chat-session-storage';

export async function signOutAfterClearingLocalSession(
  storage: Storage = window.localStorage,
  assign: (url: string) => void = (url) => {
    window.location.assign(url);
  },
): Promise<void> {
  try {
    clearAllFloatingChatSessionIds(storage);
  } catch {
    // Private mode and some browser policies throw on Storage access.
  }
  await signOut({ redirect: false, redirectTo: '/sign-in' });
  assign('/sign-in');
}
