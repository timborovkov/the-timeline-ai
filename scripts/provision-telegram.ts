import { parseArgs } from 'node:util';

import { provisionTelegramBot } from '../apps/web/src/lib/telegram-bot-provision';

try {
  const { values } = parseArgs({
    options: {
      environment: { type: 'string' },
      'bot-id': { type: 'string' },
      origin: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  });
  if (!values.environment || !values['bot-id'] || !values.origin) {
    throw new Error(
      'Usage: telegram:provision --environment <name> --bot-id <id> --origin <https-origin> [--apply]',
    );
  }
  const result = await provisionTelegramBot({
    environment: values.environment,
    expectedBotId: /^\d+$/.test(values['bot-id']) ? Number(values['bot-id']) : NaN,
    origin: values.origin,
    apply: values.apply,
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    configuredOrigin: process.env.AUTH_URL?.trim() || process.env.NEXTAUTH_URL?.trim(),
  });
  console.log(JSON.stringify(result));
} catch (error) {
  let message = error instanceof Error ? error.message : 'Telegram provisioning failed';
  for (const value of [process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_WEBHOOK_SECRET]) {
    if (value?.trim()) message = message.replaceAll(value.trim(), '<redacted>');
  }
  console.error(message);
  process.exitCode = 1;
}
