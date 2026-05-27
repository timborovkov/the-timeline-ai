import { childLogger, type onboarding, type TeamScope } from '@timeline/shared';

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
