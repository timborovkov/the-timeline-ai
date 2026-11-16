import {
  getRedisConnection as getConnection,
  closeRedisConnection as closeConnection,
} from '#src/redis/connection.js';

export function getRedisConnection() {
  return getConnection('queue');
}

export function closeRedisConnection(): Promise<void> {
  return closeConnection('queue');
}
