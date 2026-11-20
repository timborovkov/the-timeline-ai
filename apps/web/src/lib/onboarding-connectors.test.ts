import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { resolveOnboardingConnectors } from '@/lib/onboarding-connectors';

const baseEnv = {
  SLACK_CLIENT_ID: undefined as string | undefined,
  SLACK_CLIENT_SECRET: undefined as string | undefined,
  SLACK_SIGNING_SECRET: undefined as string | undefined,
  TELEGRAM_BOT_TOKEN: undefined as string | undefined,
  TELEGRAM_WEBHOOK_SECRET: undefined as string | undefined,
  TELEGRAM_BOT_USERNAME: undefined as string | undefined,
};

describe('resolveOnboardingConnectors', () => {
  it('offers Slack when OAuth credentials are complete', () => {
    const result = resolveOnboardingConnectors({
      ...baseEnv,
      SLACK_CLIENT_ID: 'client',
      SLACK_CLIENT_SECRET: 'secret',
      SLACK_SIGNING_SECRET: 'signing',
    } as never);

    expect(result.connectors).toEqual(['slack']);
  });

  it('offers Telegram only when bot token and webhook secret are both set', () => {
    expect(
      resolveOnboardingConnectors({
        ...baseEnv,
        TELEGRAM_BOT_TOKEN: 'token',
        TELEGRAM_BOT_USERNAME: 'TimelineBot',
      } as never).connectors,
    ).toEqual([]);

    const withSecret = resolveOnboardingConnectors({
      ...baseEnv,
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
      TELEGRAM_BOT_USERNAME: 'TimelineBot',
    } as never);

    expect(withSecret.connectors).toEqual(['telegram']);
    expect(withSecret.telegramBotUsername).toBe('TimelineBot');
  });

  it('lists both connectors when Slack and Telegram are fully configured', () => {
    const result = resolveOnboardingConnectors({
      ...baseEnv,
      SLACK_CLIENT_ID: 'client',
      SLACK_CLIENT_SECRET: 'secret',
      SLACK_SIGNING_SECRET: 'signing',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
      TELEGRAM_BOT_USERNAME: 'TimelineBot',
    } as never);

    expect(result.connectors).toEqual(['slack', 'telegram']);
  });
});
