'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';

function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener('storage', listener);
  };
}

/** A per-user/team suggestion; never replaces billing warnings or restrictions. */
export function PaygValueNudge({ storageKey }: { storageKey: string }) {
  const [dismissed, setDismissed] = useState(false);
  const storedDismissal = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(storageKey) === 'dismissed';
      } catch {
        return false;
      }
    },
    () => true,
  );
  if (dismissed || storedDismissal) return null;
  return (
    <aside
      aria-label="Pay as you go suggestion"
      className="flex flex-wrap items-center gap-3 border-t border-border pt-5"
    >
      <div className="min-w-0 w-full">
        <p className="text-sm font-medium">Keep going when your Free allowance runs out</p>
        <p className="mt-2 text-xs leading-5 text-fg-muted">
          Pay as you go keeps your Free allowances, with no platform fee. Extra usage is metered
          under a €25 monthly default cap; extra members and tax may add charges.
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/app/team?section=billing&plan=payg#change-plan">Explore Pay as you go</Link>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(storageKey, 'dismissed');
            window.dispatchEvent(new Event('storage'));
          } catch {
            /* Dismiss for this visit even when storage is unavailable. */
          }
        }}
      >
        Not now
      </Button>
    </aside>
  );
}
