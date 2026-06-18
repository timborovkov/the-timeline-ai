'use client';

import { X } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';

import { cn } from '@/lib/utils';

interface CoachmarkProps {
  /** Unique key for localStorage persistence. Prevents re-showing after dismiss. */
  storageKey: string;
  /** The hint content. Keep it to one sentence + an action word. */
  children: React.ReactNode;
  /** Optional className for positioning. */
  className?: string;
}

function subscribeToCoachmark(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (e: StorageEvent) => {
    if (e.key?.startsWith('tl-coachmark:')) onStoreChange();
  };
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener('storage', handler);
  };
}

function isVisible(storageKey: string): boolean {
  try {
    return localStorage.getItem(`tl-coachmark:${storageKey}`) !== 'dismissed';
  } catch {
    return true;
  }
}

function serverSnapshot(): boolean {
  return true;
}

/**
 * One-time, dismissible UI hint. Shows once per browser (persisted in
 * localStorage under `tl-coachmark:{storageKey}`). After dismiss, never
 * shows again. Used for the citation→inspector pointer on the timeline.
 *
 * Not a modal. Renders inline as a quiet signal-tinted strip with a close
 * button. Respects `prefers-reduced-motion` (no animation).
 */
export function Coachmark({ storageKey, children, className }: CoachmarkProps) {
  const [dismissed, setDismissed] = useState(false);
  const visible =
    useSyncExternalStore(subscribeToCoachmark, () => isVisible(storageKey), serverSnapshot) &&
    !dismissed;

  if (!visible) return null;

  return (
    <div
      role="note"
      className={cn(
        'flex items-start gap-2 rounded-sm border border-signal/30 bg-signal-soft px-3 py-2 text-sm text-fg',
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        aria-label="Dismiss hint"
        onClick={() => {
          try {
            localStorage.setItem(`tl-coachmark:${storageKey}`, 'dismissed');
          } catch {
            // localStorage unavailable (private mode); dismiss for this session
          }
          setDismissed(true);
        }}
        className="grid size-6 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-surface-2 hover:text-fg"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
