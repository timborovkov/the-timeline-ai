'use client';

import {
  GETTING_STARTED_STEPS,
  gettingStartedIndex,
  shouldShowGettingStartedStrip,
  type FirstRunPhase,
} from '@timeline/shared/onboarding/first-run';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTransition } from 'react';

import { hideGettingStartedGuideAction } from '@/app/actions/first-run';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STEP_HREFS: Record<(typeof GETTING_STARTED_STEPS)[number], string> = {
  capture: '/app/onboarding/record',
  ask: '/app/chat',
  approve: '/app/approvals',
  live: '/app/onboarding/live',
};

const STEP_LABELS = {
  capture: 'Capture',
  ask: 'Ask',
  approve: 'Approve',
  live: 'Go live',
} as const;

export function GettingStartedStrip({ phase, hidden }: { phase: FirstRunPhase; hidden: boolean }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  if (!shouldShowGettingStartedStrip({ phase, hidden, pathname })) {
    return null;
  }
  const active = gettingStartedIndex(phase);
  const mobileLabel = GETTING_STARTED_STEPS[Math.max(active, 0)] ?? 'capture';

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2 md:gap-4">
      <span className="text-xs text-fg-dim">Getting started</span>
      <span className="text-xs font-medium text-fg md:hidden">
        {Math.max(active, 0) + 1} of 4 · {STEP_LABELS[mobileLabel]}
      </span>
      <nav aria-label="Getting started" className="hidden flex-wrap items-center gap-4 md:flex">
        {GETTING_STARTED_STEPS.map((step, index) => (
          <Link
            key={step}
            href={STEP_HREFS[step]}
            className={cn(
              'text-xs',
              index === active ? 'font-semibold text-fg' : 'text-fg-dim hover:text-fg',
            )}
          >
            {index < active
              ? `✓ ${STEP_LABELS[step]}`
              : `${String(index + 1)} ${STEP_LABELS[step]}`}
          </Link>
        ))}
      </nav>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto h-7 text-xs text-fg-dim"
        disabled={pending}
        onClick={() => {
          startTransition(() => {
            void hideGettingStartedGuideAction();
          });
        }}
      >
        Hide guide
      </Button>
    </div>
  );
}
