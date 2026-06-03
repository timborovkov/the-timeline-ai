import { childLogger } from '@timeline/shared/logger';
import { type TeamScope } from '@timeline/shared/team-scope';

import type * as onboarding from '@timeline/shared/onboarding';

import { reportCaughtError } from '@/lib/sentry-report';

const log = childLogger('web:onboarding');

export async function safeMarkOnboardingStep(
  scope: Pick<TeamScope, 'onboarding'>,
  step: onboarding.OnboardingStep,
): Promise<boolean> {
  try {
    return await scope.onboarding.markStepComplete(step);
  } catch (err) {
    log.warn({ err, step }, 'onboarding_step_mark_failed');
    reportCaughtError(err, {
      surface: 'server_action',
      operation: 'onboarding_step_mark',
      tags: { step },
    });
    return false;
  }
}
