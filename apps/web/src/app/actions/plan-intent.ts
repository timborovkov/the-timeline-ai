'use server';

import { clearSignupPlanIntent } from '@/lib/signup-plan-intent';

/** Drop navigation-only pricing intent once Polar (or plan state) has caught up. */
export async function clearResolvedSignupPlanIntent(): Promise<void> {
  await clearSignupPlanIntent();
}
