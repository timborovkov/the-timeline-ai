import { decryptJson } from '@timeline/shared/crypto';
import { childLogger } from '@timeline/shared/logger';
import { QUEUE_NAMES, getRedisConnection, type ChatDeliveryJobData } from '@timeline/shared/queue';
import { SlackApi } from '@timeline/shared/slack';
import { HttpTelegramApi } from '@timeline/shared/telegram';
import { DelayedError, Worker, type Job } from 'bullmq';
import { z } from 'zod';

const log = childLogger('worker:chat-delivery');
const deliverySchema = z.object({
  provider: z.enum(['slack', 'telegram']),
  token: z.string().min(1),
  accountId: z.string().optional(),
  method: z.enum(['send', 'edit']),
  body: z.record(z.string(), z.unknown()),
});

export async function processChatDelivery(data: ChatDeliveryJobData): Promise<void> {
  const delivery = deliverySchema.parse(
    decryptJson({
      ciphertext: Buffer.from(data.ciphertext, 'base64'),
      iv: Buffer.from(data.iv, 'base64'),
      tag: Buffer.from(data.tag, 'base64'),
    }),
  );
  if (delivery.provider === 'slack') {
    if (delivery.method !== 'send') throw new Error('Unsupported Slack delivery method');
    const body = z
      .object({
        channel: z.string(),
        text: z.string(),
        thread_ts: z.string().optional(),
        response_url: z.string().optional(),
        response_type: z.enum(['ephemeral', 'in_channel']).optional(),
        blocks: z.array(z.unknown()).optional(),
      })
      .parse(delivery.body);
    await new SlackApi(delivery.token, delivery.accountId, false).postMessage(
      body as Parameters<SlackApi['postMessage']>[0],
    );
  } else {
    const api = new HttpTelegramApi(delivery.token, 10_000, false);
    if (delivery.method === 'edit') {
      const body = z
        .object({
          chat_id: z.number(),
          message_id: z.number(),
          text: z.string(),
          reply_markup: z.unknown().optional(),
        })
        .parse(delivery.body);
      await api.editMessageText(body);
    } else {
      const body = z
        .object({
          chat_id: z.number(),
          text: z.string(),
          parse_mode: z.enum(['HTML', 'MarkdownV2']).optional(),
          reply_to_message_id: z.number().optional(),
          reply_parameters: z
            .object({ message_id: z.number(), allow_sending_without_reply: z.boolean().optional() })
            .optional(),
          reply_markup: z.unknown().optional(),
        })
        .parse(delivery.body);
      await api.sendMessage(body as Parameters<HttpTelegramApi['sendMessage']>[0]);
    }
  }
}

export function startChatDeliveryWorker(): Worker<ChatDeliveryJobData> {
  const worker = new Worker<ChatDeliveryJobData>(
    QUEUE_NAMES.chatDelivery,
    async (job: Job<ChatDeliveryJobData>, token?: string) => {
      try {
        await processChatDelivery(job.data);
      } catch (error) {
        if (error instanceof Error && 'retryAt' in error && error.retryAt instanceof Date) {
          await job.moveToDelayed(Math.max(Date.now() + 1000, error.retryAt.getTime()), token);
          throw new DelayedError();
        }
        // One attempt: ambiguous writes are never automatically replayed.
        throw new Error('Chat delivery failed; automatic replay suppressed');
      }
    },
    { connection: getRedisConnection(), concurrency: 2 },
  );
  worker.on('failed', (job) => {
    log.warn({ jobId: job?.id }, 'chat delivery requires attention');
  });
  return worker;
}
