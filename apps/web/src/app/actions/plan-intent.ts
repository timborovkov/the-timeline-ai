'use server';

import { runSentryServerAction } from '@/lib/sentry-action';
import { clearSignupPlanIntent } from '@/lib/signup-plan-intent';

/** Drop navigation-only pricing intent once Polar (or plan state) has caught up. */
export async function clearResolvedSignupPlanIntent(): Promise<void> {
  return runSentryServerAction('clear_resolved_signup_plan_intent', async () => {
    await clearSignupPlanIntent();
  });
}
