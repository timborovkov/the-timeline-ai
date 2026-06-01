import type * as QueueModule from '@timeline/shared/queue';

export async function requireRedisQueue(): Promise<typeof QueueModule> {
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL is required for the job queue');
  }

  return import(/* webpackIgnore: true */ '@timeline/shared/queue');
}
