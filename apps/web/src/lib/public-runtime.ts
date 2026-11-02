'use client';

import { useSyncExternalStore } from 'react';

import { DEFAULT_SUPPORT_EMAIL } from '@/lib/support-links';

export type PublicRuntime =
  | { status: 'unknown' }
  | {
      status: 'ready';
      supportEmail: string;
      turnstileSiteKey?: string;
      requiresTurnstile: boolean;
      taskCategoriesEnabled: boolean;
    };

const UNKNOWN: PublicRuntime = { status: 'unknown' };
const READY_FALLBACK: PublicRuntime = {
  status: 'ready',
  supportEmail: DEFAULT_SUPPORT_EMAIL,
  requiresTurnstile: true,
  taskCategoriesEnabled: true,
};

let snapshot: PublicRuntime = UNKNOWN;
let inflight: Promise<PublicRuntime> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function applyTaskCategoryDataset(enabled: boolean) {
  if (typeof document === 'undefined') return;
  document.body.dataset.taskCategoriesEnabled = enabled ? 'true' : 'false';
}

function parsePublicRuntime(payload: unknown): PublicRuntime {
  if (!payload || typeof payload !== 'object') return READY_FALLBACK;
  const record = payload as Record<string, unknown>;
  const supportEmail = readNonEmptyString(record.supportEmail) ?? DEFAULT_SUPPORT_EMAIL;
  const ready: PublicRuntime = {
    status: 'ready',
    supportEmail,
    turnstileSiteKey: readNonEmptyString(record.turnstileSiteKey),
    requiresTurnstile: record.requiresTurnstile !== false,
    taskCategoriesEnabled: record.taskCategoriesEnabled !== false,
  };
  return ready;
}

async function fetchPublicRuntime(): Promise<PublicRuntime> {
  try {
    const response = await fetch('/api/public/runtime', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return READY_FALLBACK;
    return parsePublicRuntime(await response.json());
  } catch {
    return READY_FALLBACK;
  }
}

function ensurePublicRuntimeLoad() {
  inflight ??= fetchPublicRuntime().then((next) => {
    snapshot = next;
    if (next.status === 'ready') applyTaskCategoryDataset(next.taskCategoriesEnabled);
    emit();
    return next;
  });
}

function subscribePublicRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePublicRuntime(enabled = true): PublicRuntime {
  const current = useSyncExternalStore(
    subscribePublicRuntime,
    () => snapshot,
    () => UNKNOWN,
  );
  if (!enabled) return READY_FALLBACK;
  ensurePublicRuntimeLoad();
  return current;
}

export function resetPublicRuntimeCache() {
  snapshot = UNKNOWN;
  inflight = null;
  emit();
}
