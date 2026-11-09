'use client';

import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';

import { createBrowserResourceStore } from '@/lib/browser-resource-store';

export type PublicSession =
  | { status: 'unknown' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; name?: string | null; email?: string | null };

const UNKNOWN: PublicSession = { status: 'unknown' };
const SIGNED_OUT: PublicSession = { status: 'signed-out' };

function readSessionPayload(payload: unknown): PublicSession {
  if (!payload || typeof payload !== 'object') return SIGNED_OUT;
  const user = 'user' in payload ? payload.user : undefined;
  if (!user || typeof user !== 'object') return SIGNED_OUT;
  const record = user as { name?: unknown; email?: unknown };
  return {
    status: 'signed-in',
    name: typeof record.name === 'string' ? record.name : null,
    email: typeof record.email === 'string' ? record.email : null,
  };
}

async function fetchPublicSession(): Promise<PublicSession> {
  try {
    const response = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return SIGNED_OUT;
    return readSessionPayload(await response.json());
  } catch {
    return SIGNED_OUT;
  }
}

const store = createBrowserResourceStore<PublicSession>({
  initial: UNKNOWN,
  load: fetchPublicSession,
});

export const refreshPublicSession = store.refresh;
export const resetPublicSessionCache = store.reset;
export const setPublicSessionCache = store.set;

export function usePublicSession(): PublicSession {
  const pathname = usePathname();
  if (pathname) store.reportPathname(pathname);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
