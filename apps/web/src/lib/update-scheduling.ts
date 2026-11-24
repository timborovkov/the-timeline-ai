import { nextScheduledUpdateRecipientJob } from '@timeline/shared/messaging';

import { requireRedisQueue } from '@/lib/queue';

export async function enqueueNextConfiguredUpdate(
  recipient: Parameters<typeof nextScheduledUpdateRecipientJob>[0],
  preference: Parameters<typeof nextScheduledUpdateRecipientJob>[1],
): Promise<boolean> {
  const next = nextScheduledUpdateRecipientJob(recipient, preference);
  if (!next) return false;
  const queue = await requireRedisQueue();
  await queue.enqueueDailyDigestRecipientJob(next.data, next.delayMs);
  return true;
}
