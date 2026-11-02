'use client';

import { useSyncExternalStore } from 'react';

export type PublicSession =
  | { status: 'unknown' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; name?: string | null; email?: string | null };

const UNKNOWN: PublicSession = { status: 'unknown' };
const SIGNED_OUT: PublicSession = { status: 'signed-out' };

let snapshot: PublicSession = UNKNOWN;
let inflight: Promise<PublicSession> | null = null;
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

function ensurePublicSessionLoad() {
  inflight ??= fetchPublicSession().then((next) => {
    snapshot = next;
    emit();
    return next;
  });
}

function subscribePublicSession(listener: () => void): () => void {
  listeners.add(listener);
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
  return useSyncExternalStore(
    subscribePublicSession,
    getPublicSessionSnapshot,
    getPublicSessionServerSnapshot,
  );
}

export function resetPublicSessionCache() {
  snapshot = UNKNOWN;
  inflight = null;
  emit();
}

export function setPublicSessionCache(next: PublicSession) {
  snapshot = next;
  inflight = Promise.resolve(next);
  emit();
}
