import type {
  DispatcherDeps,
  EmailAttachmentDeps,
  ExtractEnqueueDeps,
  EmbedEnqueueDeps,
  SuggestionEnqueueDeps,
  EmailDocumentDeps,
} from '#src/email/dispatcher.js';
import type { Db } from '@timeline/db';

import { getEnv } from '#src/env.js';
import * as queue from '#src/queue/index.js';
import {
  getAttachmentsBucket,
  getAudioBucket,
  getDocumentsBucket,
  getS3Client,
  putObject,
} from '#src/s3/index.js';

export function inboundDispatcherDeps(db: Db): DispatcherDeps {
  const env = getEnv();
  const attachmentsReady = Boolean(
    env.S3_ENDPOINT &&
    env.S3_REGION &&
    env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY &&
    env.S3_BUCKET_ATTACHMENTS &&
    env.S3_BUCKET_AUDIO,
  );
  const attachmentsDeps: EmailAttachmentDeps | undefined = attachmentsReady
    ? {
        async uploadAttachment(input) {
          await putObject(getS3Client(), {
            bucket: getAttachmentsBucket(),
            key: input.key,
            body: input.body,
            contentType: input.contentType,
          });
        },
        async uploadAudio(input) {
          await putObject(getS3Client(), {
            bucket: getAudioBucket(),
            key: input.key,
            body: input.body,
            contentType: input.contentType,
          });
        },
        async enqueueTranscribe(input) {
          await queue.enqueueTranscribeJob(input);
        },
        buildAttachmentKey({ teamId, messageId, filename }) {
          return `teams/${teamId}/email/${safeForKey(messageId)}/${safeForKey(filename)}`;
        },
        buildAudioKey({ teamId, messageId, filename }) {
          return `teams/${teamId}/email-audio/${safeForKey(messageId)}/${safeForKey(filename)}`;
        },
      }
    : undefined;

  const extractDeps: ExtractEnqueueDeps | undefined = env.REDIS_URL
    ? {
        async enqueueExtract(input) {
          await queue.enqueueExtractJob(input);
        },
      }
    : undefined;

  const embedDeps: EmbedEnqueueDeps | undefined = env.REDIS_URL
    ? {
        async enqueueEmbed(input) {
          await queue.enqueueEmbedJob(input);
        },
      }
    : undefined;

  const suggestionDeps: SuggestionEnqueueDeps | undefined = env.REDIS_URL
    ? {
        async enqueueSuggestion(input) {
          await queue.enqueueSuggestionJob(input);
        },
      }
    : undefined;

  const documentDeps: EmailDocumentDeps | undefined =
    attachmentsReady && env.S3_BUCKET_DOCUMENTS && env.REDIS_URL
      ? {
          async upload(input) {
            await putObject(getS3Client(), {
              bucket: getDocumentsBucket(),
              key: input.key,
              body: input.body,
              contentType: input.contentType,
            });
          },
          async enqueueExtract(input) {
            await queue.enqueueDocumentExtractJob(input);
          },
        }
      : undefined;

  return {
    db,
    ...(env.INBOUND_EMAIL_DOMAIN ? { inboundDomain: env.INBOUND_EMAIL_DOMAIN } : {}),
    ...(attachmentsDeps ? { attachments: attachmentsDeps } : {}),
    ...(documentDeps ? { documents: documentDeps } : {}),
    ...(extractDeps ? { extract: extractDeps } : {}),
    ...(embedDeps ? { embed: embedDeps } : {}),
    ...(suggestionDeps ? { suggestions: suggestionDeps } : {}),
  };
}
function safeForKey(input: string): string {
  return input.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 200);
}
