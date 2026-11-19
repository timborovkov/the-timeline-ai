import { getEnv } from '@timeline/shared/env';
import type { OnboardingSourceIntent } from '@timeline/shared/onboarding/first-run';

export interface OnboardingConnectorAvailability {
  connectors: OnboardingSourceIntent[];
  telegramBotUsername: string | null;
}

/** Only offer connectors that are configured and usable in this deployment. */
export function resolveOnboardingConnectors(
  env: ReturnType<typeof getEnv> = getEnv(),
): OnboardingConnectorAvailability {
  const connectors: OnboardingSourceIntent[] = [];
  if (env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_SIGNING_SECRET) {
    connectors.push('slack');
  }
  if (env.TELEGRAM_BOT_TOKEN) {
    connectors.push('telegram');
  }
  return {
    connectors,
    telegramBotUsername: env.TELEGRAM_BOT_USERNAME ?? null,
  };
}
