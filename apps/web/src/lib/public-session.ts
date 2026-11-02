'use client';

import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';

export type PublicSession =
  | { status: 'unknown' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; name?: string | null; email?: string | null };

const UNKNOWN: PublicSession = { status: 'unknown' };
const SIGNED_OUT: PublicSession = { status: 'signed-out' };

let snapshot: PublicSession = UNKNOWN;
let inflight: Promise<PublicSession> | null = null;
let loadId = 0;
let fetchPending = false;
let currentPathname: string | null = null;
let browserRefreshBound = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

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

export function refreshPublicSession(): Promise<PublicSession> {
  if (fetchPending && inflight) return inflight;
  const id = ++loadId;
  fetchPending = true;
  const request = fetchPublicSession().then((next) => {
    fetchPending = false;
    if (id !== loadId) return snapshot;
    snapshot = next;
    emit();
    return next;
  });
  inflight = request;
  return request;
}

function ensurePublicSessionLoad() {
  inflight ??= refreshPublicSession();
}

function bindBrowserSessionRefresh() {
  if (browserRefreshBound || typeof window === 'undefined') return;
  browserRefreshBound = true;
  const onVisible = () => {
    void refreshPublicSession();
  };
  window.addEventListener('focus', onVisible);
  window.addEventListener('pageshow', onVisible);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onVisible();
  });
}

function reportPublicSessionPathname(pathname: string) {
  if (currentPathname === pathname) return;
  const first = currentPathname === null;
  currentPathname = pathname;
  if (first) return;
  void refreshPublicSession();
}

function subscribePublicSession(listener: () => void): () => void {
  listeners.add(listener);
  bindBrowserSessionRefresh();
  ensurePublicSessionLoad();
  return () => {
    listeners.delete(listener);
  };
}

function getPublicSessionSnapshot(): PublicSession {
  return snapshot;
}

function getPublicSessionServerSnapshot(): PublicSession {
  return UNKNOWN;
}

export function usePublicSession(): PublicSession {
  const pathname = usePathname();
  if (pathname) reportPublicSessionPathname(pathname);
  return useSyncExternalStore(
    subscribePublicSession,
    getPublicSessionSnapshot,
    getPublicSessionServerSnapshot,
  );
}

export function resetPublicSessionCache() {
  loadId++;
  fetchPending = false;
  snapshot = UNKNOWN;
  inflight = null;
  currentPathname = null;
  emit();
}

export function setPublicSessionCache(next: PublicSession) {
  loadId++;
  fetchPending = false;
  snapshot = next;
  inflight = Promise.resolve(next);
  emit();
}
