'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import type { PaidSignupPlanId } from '@/lib/signup-plan';

function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener('storage', listener);
  };
}

function dismissalKey(teamId: string, planId: PaidSignupPlanId): string {
  return `tl_plan_intent_dismissed:${teamId}:${planId}`;
}

/** Dismissible reminder after paid-plan signup. Never activates a plan by itself. */
export function PlanIntentPrompt({
  teamId,
  planId,
  title,
  body,
  ctaLabel,
  href,
}: {
  teamId: string;
  planId: PaidSignupPlanId;
  title: string;
  body: string;
  ctaLabel: string;
  href: string;
}) {
  const storageKey = dismissalKey(teamId, planId);
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
      data-plan-intent-prompt={planId}
      aria-label={title}
      className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-2 px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="mt-1 text-sm text-fg-muted">{body}</p>
      </div>
      <Button asChild size="sm">
        <Link href={href}>{ctaLabel}</Link>
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
