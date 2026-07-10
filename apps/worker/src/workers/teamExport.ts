import { auditLog, teamExports, type Db } from '@timeline/db';
import {
  type BuildTeamExportArchiveInput,
  type BuildTeamExportArchiveResult,
  buildTeamExportArchive,
  buildTeamExportObjectKey,
  childLogger,
  deleteObject,
  getAttachmentsBucket,
  getAudioBucket,
  getDocumentsBucket,
  getExportsBucket,
  getS3Client,
  getS3PresignClient,
  getSignedGetObjectUrl,
  putObject,
  queue,
} from '@timeline/shared';
import { Worker } from 'bullmq';
import { and, eq } from 'drizzle-orm';

import { captureWorkerJobFailure } from '#src/monitoring.js';

const log = childLogger('worker:team-export');

interface TeamExportWorkerDeps {
  db: Db;
  io?: TeamExportWorkerIO;
}

export interface TeamExportWorkerIO {
  buildArchive: (input: BuildTeamExportArchiveInput) => Promise<BuildTeamExportArchiveResult>;
  putArchive: (input: {
    bucket: string;
    key: string;
    body: Buffer;
    contentType: string;
  }) => Promise<void>;
  deleteArchive: (input: { bucket: string; key: string }) => Promise<void>;
  getBuckets: () => { attachments: string; audio: string; documents: string; exports: string };
  signFileUrl: (input: { bucket: string; key: string; ttlSec: number }) => Promise<string>;
}

function defaultTeamExportIO(): TeamExportWorkerIO {
  return {
    buildArchive: buildTeamExportArchive,
    async putArchive(input) {
      await putObject(getS3Client(), input);
    },
    async deleteArchive(input) {
      await deleteObject(getS3Client(), input.bucket, input.key);
    },
    getBuckets() {
      return {
        attachments: getAttachmentsBucket(),
        audio: getAudioBucket(),
        documents: getDocumentsBucket(),
        exports: getExportsBucket(),
      };
    },
    signFileUrl(input) {
      return getSignedGetObjectUrl(getS3PresignClient(), input.bucket, input.key, input.ttlSec);
    },
  };
}

export async function processTeamExportJob(
  deps: TeamExportWorkerDeps,
  data: queue.TeamExportJobData,
): Promise<void> {
  const io = deps.io ?? defaultTeamExportIO();
  const rows = await deps.db
    .select()
    .from(teamExports)
    .where(and(eq(teamExports.id, data.teamExportId), eq(teamExports.teamId, data.teamId)))
    .limit(1);
  const exportRow = rows[0];
  if (!exportRow || exportRow.status === 'ready' || exportRow.status === 'expired') return;

  await deps.db
    .update(teamExports)
    .set({ status: 'running', startedAt: new Date(), error: null })
    .where(eq(teamExports.id, data.teamExportId));

  const buckets = io.getBuckets();
  const objectKey = buildTeamExportObjectKey(data.teamId, data.teamExportId);
  let shouldDeleteArchive = false;
  try {
    const built = await io.buildArchive({
      db: deps.db,
      teamExportId: data.teamExportId,
      teamId: data.teamId,
      requestedByUserId: data.requestedByUserId,
      buckets: {
        attachments: buckets.attachments,
        audio: buckets.audio,
        documents: buckets.documents,
      },
      signFileUrl: io.signFileUrl,
    });
    await io.putArchive({
      bucket: buckets.exports,
      key: objectKey,
      body: built.archive,
      contentType: 'application/zip',
    });
    shouldDeleteArchive = true;

    const completedAt = new Date();
    const expiresAt = new Date(built.manifest.expires_at);
    await deps.db.transaction(async (tx) => {
      await tx
        .update(teamExports)
        .set({
          status: 'ready',
          objectKey,
          manifest: built.manifest,
          omissions: built.omissions,
          completedAt,
          expiresAt,
          error: null,
        })
        .where(eq(teamExports.id, data.teamExportId));
      await tx.insert(auditLog).values({
        teamId: data.teamId,
        actorUserId: data.requestedByUserId,
        action: 'team_export.file_urls_signed',
        targetType: 'team_export',
        targetId: data.teamExportId,
        metadata: {
          signed_file_count: built.signedFileCount,
          expires_at: built.manifest.expires_at,
        },
      });
      await tx.insert(auditLog).values({
        teamId: data.teamId,
        actorUserId: data.requestedByUserId,
        action: 'team_export.ready',
        targetType: 'team_export',
        targetId: data.teamExportId,
        metadata: {
          object_key: objectKey,
          archive_expires_at: expiresAt.toISOString(),
          omissions: built.omissions,
        },
      });
    });
    shouldDeleteArchive = false;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown export error';
    log.error({ err, teamExportId: data.teamExportId }, 'team export failed');
    if (shouldDeleteArchive) {
      try {
        await io.deleteArchive({ bucket: buckets.exports, key: objectKey });
      } catch (deleteErr) {
        log.error(
          { err: deleteErr, teamExportId: data.teamExportId, objectKey },
          'failed to delete partial team export archive',
        );
      }
    }
    await deps.db
      .update(teamExports)
      .set({ status: 'failed', error: message.slice(0, 1000), completedAt: new Date() })
      .where(eq(teamExports.id, data.teamExportId));
    throw err;
  }
}

export function startTeamExportWorker(deps: TeamExportWorkerDeps): Worker<queue.TeamExportJobData> {
  const worker = new Worker<queue.TeamExportJobData>(
    queue.QUEUE_NAMES.teamExport,
    async (job) => processTeamExportJob(deps, job.data),
    { connection: queue.getRedisConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'team export job failed');
    captureWorkerJobFailure(err, job);
  });
  return worker;
}
