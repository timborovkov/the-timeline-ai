'use client';

import { useSyncExternalStore } from 'react';

export type PublicTurnstile = { status: 'unknown' } | { status: 'ready'; siteKey?: string };

const UNKNOWN: PublicTurnstile = { status: 'unknown' };
const READY_EMPTY: PublicTurnstile = { status: 'ready' };

let snapshot: PublicTurnstile = UNKNOWN;
let inflight: Promise<PublicTurnstile> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function readSiteKey(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || !('siteKey' in payload)) return undefined;
  const siteKey = payload.siteKey;
  return typeof siteKey === 'string' && siteKey.trim().length > 0 ? siteKey.trim() : undefined;
}

async function fetchPublicTurnstile(): Promise<PublicTurnstile> {
  try {
    const response = await fetch('/api/public/turnstile', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return READY_EMPTY;
    return { status: 'ready', siteKey: readSiteKey(await response.json()) };
  } catch {
    return READY_EMPTY;
  }
}

function ensurePublicTurnstileLoad() {
  inflight ??= fetchPublicTurnstile().then((next) => {
    snapshot = next;
    emit();
    return next;
  });
}

function subscribePublicTurnstile(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePublicTurnstile(enabled: boolean): PublicTurnstile {
  const current = useSyncExternalStore(
    subscribePublicTurnstile,
    () => snapshot,
    () => UNKNOWN,
  );
  if (!enabled) return READY_EMPTY;
  ensurePublicTurnstileLoad();
  return current;
}

export function resetPublicTurnstileCache() {
  snapshot = UNKNOWN;
  inflight = null;
  emit();
}
