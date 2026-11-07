// Queue shutdown must not disconnect request caching or admission clients.
import { expect, vi } from '@timeline/test-support';
import { afterEach, it } from 'bun:test';

import { resetEnvForTests } from '#src/env.js';
import {
  closeRedisConnection as closeQueue,
  getRedisConnection as getQueue,
} from '#src/queue/connection.js';
import {
  closeAllRedisConnections,
  closeRedisConnection,
  getRedisConnection,
} from '#src/redis/connection.js';

const originalUrl = process.env.REDIS_URL;
afterEach(async () => {
  await closeAllRedisConnections();
  if (originalUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalUrl;
  resetEnvForTests();
});

it('keeps request clients alive across queue shutdown and closes both at process shutdown', async () => {
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  resetEnvForTests();
  const request = getRedisConnection();
  const queue = getQueue();
  const requestQuit = vi.spyOn(request, 'quit').mockResolvedValue('OK');
  const queueQuit = vi.spyOn(queue, 'quit').mockResolvedValue('OK');
  expect(queue).not.toBe(request);
  expect(getQueue()).toBe(queue);
  expect(queue.options.maxRetriesPerRequest).toBeNull();
  expect(request.options.maxRetriesPerRequest).toBeNull();
  expect(request.status).toBe('wait');
  await closeQueue();
  expect(queueQuit).toHaveBeenCalledTimes(1);
  expect(requestQuit).not.toHaveBeenCalled();
  expect(getRedisConnection()).toBe(request);
  await closeAllRedisConnections();
  expect(requestQuit).toHaveBeenCalledTimes(1);
  await closeRedisConnection();
  expect(requestQuit).toHaveBeenCalledTimes(1);
});
