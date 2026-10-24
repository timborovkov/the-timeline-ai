import { bucketAnalyticsCount } from '@timeline/shared/analytics';
import { getEnv } from '@timeline/shared/env';
import { getAudioBucket, getDocumentsBucket, getS3Client, putObject } from '@timeline/shared/s3';

import type * as slack from '@timeline/shared/slack';

import { trackProductEventBestEffort } from '@/lib/analytics';
import { requireRedisQueue } from '@/lib/queue';

export function slackIngestDeps() {
  const env = getEnv();
  const s3Ready = Boolean(
    env.S3_ENDPOINT &&
    env.S3_REGION &&
    env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY &&
    env.REDIS_URL,
  );
  const audioReady = s3Ready && Boolean(env.S3_BUCKET_AUDIO);
  const documentsReady = s3Ready && Boolean(env.S3_BUCKET_DOCUMENTS);
  return {
    agentDeps: {
      onApprovalDecision: ({ teamId, userId, decision, itemCount, isBulk }) => {
        trackProductEventBestEffort(
          { kind: 'user', userId, teamId },
          'approval_decision_submitted',
          {
            decision,
            itemCountBucket: bucketAnalyticsCount(itemCount),
            isBulk,
          },
        );
      },
    },
    audio: audioReady
      ? {
          async upload(input: { key: string; body: Buffer; contentType: string }) {
            await putObject(getS3Client(), {
              bucket: getAudioBucket(),
              key: input.key,
              body: input.body,
              contentType: input.contentType,
            });
          },
          async enqueueTranscribe(input: { rawEventId: string; teamId: string; audioKey: string }) {
            const queue = await requireRedisQueue();
            await queue.enqueueTranscribeJob(input);
          },
          buildAudioKey(input: {
            teamId: string;
            conversationId: string;
            messageTs: string;
            fileId: string;
            extension: string;
          }) {
            return `teams/${input.teamId}/slack/${input.conversationId}/${input.messageTs}-${input.fileId}.${input.extension}`;
          },
        }
      : undefined,
    documents: documentsReady
      ? {
          async upload(input: { key: string; body: Buffer; contentType: string }) {
            await putObject(getS3Client(), {
              bucket: getDocumentsBucket(),
              key: input.key,
              body: input.body,
              contentType: input.contentType,
            });
          },
          async enqueueExtract(input: { documentVersionId: string; teamId: string }) {
            const queue = await requireRedisQueue();
            await queue.enqueueDocumentExtractJob(input);
          },
        }
      : undefined,
    extract: env.REDIS_URL
      ? {
          async enqueueExtract(input: { rawEventId: string; teamId: string }) {
            const queue = await requireRedisQueue();
            await queue.enqueueExtractJob(input);
          },
        }
      : undefined,
    embed: env.REDIS_URL
      ? {
          async enqueueEmbed(input: { rawEventId: string; teamId: string }) {
            const queue = await requireRedisQueue();
            await queue.enqueueEmbedJob(input);
          },
        }
      : undefined,
    suggestions: env.REDIS_URL
      ? {
          async enqueueSuggestion(input: { rawEventId: string; teamId: string }) {
            const queue = await requireRedisQueue();
            await queue.enqueueSuggestionJob(input);
          },
        }
      : undefined,
  } satisfies Omit<slack.SlackIngestDeps, 'db'>;
}
