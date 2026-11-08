'use client';

import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';

import { createBrowserResourceStore } from '@/lib/browser-resource-store';
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

const store = createBrowserResourceStore<PublicRuntime>({
  initial: UNKNOWN,
  async load(previous) {
    const result = await fetchPublicRuntime();
    return result.ok ? result.runtime : previous.status === 'unknown' ? READY_FALLBACK : previous;
  },
  onChange(runtime) {
    if (runtime.status === 'ready') applyTaskCategoryDataset(runtime.taskCategoriesEnabled);
  },
});

export const refreshPublicRuntime = store.refresh;
export const resetPublicRuntimeCache = store.reset;

export function usePublicRuntime(enabled = true): PublicRuntime {
  const pathname = usePathname();
  const current = useSyncExternalStore(
    enabled ? store.subscribe : store.subscribeIdle,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  if (!enabled) return READY_FALLBACK;
  if (pathname) store.reportPathname(pathname);
  store.ensureLoaded();
  return current;
}
