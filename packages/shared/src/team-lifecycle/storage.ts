import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  ListObjectVersionsCommand,
} from '@aws-sdk/client-s3';
import { Queue } from 'bullmq';

import { QUEUE_NAMES } from '#src/queue/queues.js';
import { getRedisConnection } from '#src/redis/connection.js';
import {
  getS3Client,
  getAudioBucket,
  getAttachmentsBucket,
  getDocumentsBucket,
  getExportsBucket,
} from '#src/s3/client.js';

/** Exact path component matching, never substring matching across tenants. */
export function teamOwnsStorageKey(key: string, teamId: string) {
  const [root, owner] = key.split('/');
  return (
    root === teamId ||
    (['teams', 'team-exports', 'drive-transient'].includes(root ?? '') && owner === teamId)
  );
}

/** Bounded pages under exact owned prefixes; repeating the stage drains later pages. */
export async function purgeTeamObjects(teamId: string): Promise<boolean> {
  const client = getS3Client();
  let complete = true;
  for (const Bucket of new Set([
    getAudioBucket(),
    getAttachmentsBucket(),
    getDocumentsBucket(),
    getExportsBucket(),
  ])) {
    for (const Prefix of [
      `${teamId}/`,
      `teams/${teamId}/`,
      `team-exports/${teamId}/`,
      `drive-transient/${teamId}/`,
    ]) {
      const page = await client.send(
        new ListObjectVersionsCommand({ Bucket, Prefix, MaxKeys: 500 }),
      );
      const Objects = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].flatMap((object) =>
        object.Key && teamOwnsStorageKey(object.Key, teamId)
          ? [
              {
                Key: object.Key,
                ...(object.VersionId ? { VersionId: object.VersionId } : {}),
              },
            ]
          : [],
      );
      if (Objects.length) {
        const result = await client.send(
          new DeleteObjectsCommand({ Bucket, Delete: { Objects, Quiet: true } }),
        );
        if (result.Errors?.length) throw new Error('object_deletion_incomplete');
      }
      const uploads = await client.send(
        new ListMultipartUploadsCommand({ Bucket, Prefix, MaxUploads: 500 }),
      );
      for (const upload of uploads.Uploads ?? []) {
        if (upload.Key && teamOwnsStorageKey(upload.Key, teamId))
          await client.send(
            new AbortMultipartUploadCommand({ Bucket, Key: upload.Key, UploadId: upload.UploadId }),
          );
      }
      const remaining = await client.send(
        new ListObjectVersionsCommand({ Bucket, Prefix, MaxKeys: 1 }),
      );
      if (remaining.Versions?.length || remaining.DeleteMarkers?.length || uploads.IsTruncated)
        complete = false;
    }
  }
  return complete;
}

export async function purgeTeamQueues(teamId: string): Promise<boolean> {
  let active = false;
  for (const name of Object.values(QUEUE_NAMES)) {
    const queue = new Queue(name, { connection: getRedisConnection('queue') });
    try {
      // Scan from the tail: removing jobs must not shift unvisited offsets.
      const counts = await queue.getJobCounts(
        'wait',
        'active',
        'delayed',
        'failed',
        'completed',
        'waiting-children',
        'prioritized',
      );
      const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
      for (let end = total - 1; end >= 0; end -= 100) {
        const jobs = await queue.getJobs(
          ['wait', 'active', 'delayed', 'failed', 'completed', 'waiting-children', 'prioritized'],
          Math.max(0, end - 99),
          end,
        );
        for (const job of jobs) {
          const data = job.data as { teamId?: string; billingContext?: { teamId?: string } };
          if (data.teamId !== teamId && data.billingContext?.teamId !== teamId) continue;
          if (await job.isActive()) {
            active = true;
            continue;
          }
          await job.remove();
        }
      }
    } finally {
      await queue.close();
    }
  }
  const redis = getRedisConnection();
  let cursor = '0';
  do {
    const page = await redis.scan(cursor, 'MATCH', `*${teamId}*`, 'COUNT', 500);
    cursor = page[0];
    // BullMQ owns its own data structures; only remove application cache keys here.
    const keys = page[1].filter((key) => !key.startsWith('bull:'));
    if (keys.length) await redis.unlink(...keys);
  } while (cursor !== '0');
  return !active;
}
