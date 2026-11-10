import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { encryptJson } from '#src/crypto/secrets.js';
import { getEnv } from '#src/env.js';
import { requestBudgetIdentity } from '#src/integrations/request-budget.js';

interface ChatDeliveryPrincipal {
  teamId: string;
  userId?: string;
}
const principalStorage = new AsyncLocalStorage<ChatDeliveryPrincipal>();

/** Keep recipient authorization attached through provider rate-limit deferral. */
export function withChatDeliveryPrincipal<T>(
  principal: ChatDeliveryPrincipal,
  send: () => Promise<T>,
): Promise<T> {
  return principalStorage.run(principal, send);
}

/** Sending workspace attached to the current outbound chat delivery, if any. */
export function getChatDeliveryPrincipal(): ChatDeliveryPrincipal | undefined {
  return principalStorage.getStore();
}

export interface DeferredChatDelivery {
  provider: 'slack' | 'telegram';
  token: string;
  accountId?: string;
  method: 'send' | 'edit';
  body: Record<string, unknown>;
}

/** Persist only encrypted credentials/content; telemetry never includes the delivery body. */
export async function deferChatDelivery(
  input: DeferredChatDelivery,
  error: unknown,
): Promise<boolean> {
  if (
    !getEnv().REDIS_URL ||
    !(error instanceof Error) ||
    !('retryAt' in error) ||
    !(error.retryAt instanceof Date)
  )
    return false;
  const principal = principalStorage.getStore();
  const encrypted = encryptJson({ ...input, ...(principal ? { principal } : {}) });
  const { getChatDeliveryQueue } = await import('#src/queue/queues.js');
  const delay = Math.max(1000, error.retryAt.getTime() - Date.now());
  const chat = input.body.chat_id ?? input.body.channel;
  const message = input.body.message_id;
  const chatKey = typeof chat === 'string' || typeof chat === 'number' ? String(chat) : '';
  const messageKey =
    typeof message === 'string' || typeof message === 'number' ? String(message) : '';
  const identity = requestBudgetIdentity(input.provider, `${input.token}:${chatKey}:${messageKey}`);
  await getChatDeliveryQueue().add(
    'deliver',
    {
      ...principal,
      ciphertext: encrypted.ciphertext.toString('base64'),
      iv: encrypted.iv.toString('base64'),
      tag: encrypted.tag.toString('base64'),
    },
    {
      jobId: randomUUID(),
      delay,
      ...(input.method === 'edit'
        ? { deduplication: { id: identity, ttl: delay, extend: true, replace: true } }
        : {}),
    },
  );
  return true;
}
