import { cacheKey, cachedJson } from '@timeline/shared/cache';

import type { OnboardingChecklistState, OnboardingStep } from '@timeline/shared/onboarding';

export const ONBOARDING_CHECKLIST_CACHE_TTL_SECONDS = 30;

const ONBOARDING_STEP_LABELS: Record<OnboardingStep, string> = {
  first_note: 'Capture one timeline event',
  invite_teammate: 'Invite a teammate',
  telegram: 'Link Telegram',
  slack: 'Install or link Slack',
  email_forwarding: 'Forward email into the timeline',
  first_document: 'Upload a document',
  first_ask: 'Ask the agent a question',
  first_meeting: 'Invite the agent to a call',
  review_proposal: 'Review a proposal',
  daily_digest: 'Set up daily digests',
  first_integration: 'Connect a source, webhook, or MCP',
};

export interface OnboardingChecklistView {
  dismissed: boolean;
  items: { key: string; label: string; completed: boolean }[];
}

export function onboardingChecklistCacheKey(teamId: string, userId: string): string {
  return cacheKey(['onboarding', teamId, userId]);
}

export function toOnboardingChecklistView(
  state: OnboardingChecklistState,
): OnboardingChecklistView {
  return {
    dismissed: state.dismissed,
    items: state.steps.map((step) => ({
      key: step.step,
      label: ONBOARDING_STEP_LABELS[step.step],
      completed: step.completed,
    })),
  };
}

export async function loadOnboardingChecklistView(input: {
  teamId: string;
  userId: string;
  getChecklistState: () => Promise<OnboardingChecklistState>;
}): Promise<OnboardingChecklistView> {
  return cachedJson(
    onboardingChecklistCacheKey(input.teamId, input.userId),
    ONBOARDING_CHECKLIST_CACHE_TTL_SECONDS,
    async () => toOnboardingChecklistView(await input.getChecklistState()),
  );
}
