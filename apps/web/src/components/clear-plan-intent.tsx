'use client';

import { useEffect } from 'react';

import { clearResolvedSignupPlanIntent } from '@/app/actions/plan-intent';

/** Clears the host-only plan-intent cookie after a paid plan is confirmed. */
export function ClearPlanIntent({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    void clearResolvedSignupPlanIntent();
  }, [active]);
  return null;
}
