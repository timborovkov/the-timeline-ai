'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import type { FirstRunPhase } from '@timeline/shared/onboarding/first-run';

import { setFirstRunPhaseAction } from '@/app/actions/first-run';
import { Button } from '@/components/ui/button';

export function GuidedContinue({
  phase,
  href,
  label,
  hint,
}: {
  phase: FirstRunPhase;
  href: string;
  label: string;
  hint?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(() => {
            void setFirstRunPhaseAction(phase).then(() => {
              router.push(href);
            });
          });
        }}
      >
        {label}
      </Button>
      {hint ? <span className="text-xs text-fg-dim">{hint}</span> : null}
    </div>
  );
}
