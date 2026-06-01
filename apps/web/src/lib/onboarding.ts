import { childLogger } from '@timeline/shared/logger';
import { type TeamScope } from '@timeline/shared/team-scope';

import type * as onboarding from '@timeline/shared/onboarding';

const log = childLogger('web:onboarding');

export async function safeMarkOnboardingStep(
  scope: Pick<TeamScope, 'onboarding'>,
  step: onboarding.OnboardingStep,
): Promise<void> {
  try {
    await scope.onboarding.markStepComplete(step);
  } catch (err) {
    log.warn({ err, step }, 'onboarding_step_mark_failed');
  }
}
