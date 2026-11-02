'use client';

import { usePathname } from 'next/navigation';
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

type FetchResult = { ok: true; runtime: PublicRuntime } | { ok: false };

let snapshot: PublicRuntime = UNKNOWN;
let inflight: Promise<PublicRuntime> | null = null;
let loadId = 0;
let fetchPending = false;
let currentPathname: string | null = null;
let browserRefreshBound = false;
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
  return {
    status: 'ready',
    supportEmail,
    turnstileSiteKey: readNonEmptyString(record.turnstileSiteKey),
    requiresTurnstile: record.requiresTurnstile !== false,
    taskCategoriesEnabled: record.taskCategoriesEnabled !== false,
  };
}

async function fetchPublicRuntime(): Promise<FetchResult> {
  try {
    const response = await fetch('/api/public/runtime', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return { ok: false };
    return { ok: true, runtime: parsePublicRuntime(await response.json()) };
  } catch {
    return { ok: false };
  }
}

function applySuccessfulRuntime(runtime: PublicRuntime) {
  snapshot = runtime;
  if (runtime.status === 'ready') applyTaskCategoryDataset(runtime.taskCategoriesEnabled);
  emit();
}

function applyFailedRuntime() {
  inflight = null;
  if (snapshot.status !== 'unknown') return snapshot;
  applySuccessfulRuntime(READY_FALLBACK);
  inflight = null;
  return snapshot;
}

export function refreshPublicRuntime(): Promise<PublicRuntime> {
  if (fetchPending && inflight) return inflight;
  const id = ++loadId;
  fetchPending = true;
  const request = fetchPublicRuntime().then((result) => {
    fetchPending = false;
    if (id !== loadId) return snapshot;
    if (!result.ok) return applyFailedRuntime();
    applySuccessfulRuntime(result.runtime);
    return snapshot;
  });
  inflight = request;
  return request;
}

function ensurePublicRuntimeLoad() {
  if (snapshot.status !== 'unknown') return;
  void refreshPublicRuntime();
}

function bindBrowserRuntimeRefresh() {
  if (browserRefreshBound || typeof window === 'undefined') return;
  browserRefreshBound = true;
  const onVisible = () => {
    void refreshPublicRuntime();
  };
  window.addEventListener('focus', onVisible);
  window.addEventListener('pageshow', onVisible);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onVisible();
  });
}

function reportPublicRuntimePathname(pathname: string) {
  if (currentPathname === pathname) return;
  const first = currentPathname === null;
  currentPathname = pathname;
  if (first) return;
  void refreshPublicRuntime();
}

function subscribePublicRuntime(listener: () => void): () => void {
  listeners.add(listener);
  bindBrowserRuntimeRefresh();
  ensurePublicRuntimeLoad();
  return () => {
    listeners.delete(listener);
  };
}

function subscribeIdle(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getPublicRuntimeSnapshot(): PublicRuntime {
  return snapshot;
}

function getPublicRuntimeServerSnapshot(): PublicRuntime {
  return UNKNOWN;
}

export function usePublicRuntime(enabled = true): PublicRuntime {
  const pathname = usePathname();
  const current = useSyncExternalStore(
    enabled ? subscribePublicRuntime : subscribeIdle,
    getPublicRuntimeSnapshot,
    getPublicRuntimeServerSnapshot,
  );
  if (!enabled) return READY_FALLBACK;
  if (pathname) reportPublicRuntimePathname(pathname);
  ensurePublicRuntimeLoad();
  return current;
}

export function resetPublicRuntimeCache() {
  loadId++;
  fetchPending = false;
  snapshot = UNKNOWN;
  inflight = null;
  currentPathname = null;
  emit();
}
