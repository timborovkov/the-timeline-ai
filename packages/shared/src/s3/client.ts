import { S3Client } from '@aws-sdk/client-s3';

import { getEnv } from '../env.js';

let _client: S3Client | undefined;

/**
 * Memoised S3 client configured for RustFS (and any S3-compatible store via
 * env). Path-style addressing is the default — RustFS does not support
 * virtual-hosted-style URLs against arbitrary hostnames.
 */
export function getS3Client(): S3Client {
  if (_client) return _client;
  const env = getEnv();
  if (!env.S3_ENDPOINT || !env.S3_REGION || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error(
      'S3 not configured: S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY required',
    );
  }
  _client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: env.S3_FORCE_PATH_STYLE ?? true,
  });
  return _client;
}

export function getAudioBucket(): string {
  const env = getEnv();
  if (!env.S3_BUCKET_AUDIO) throw new Error('S3_BUCKET_AUDIO is required');
  return env.S3_BUCKET_AUDIO;
}

export function getAttachmentsBucket(): string {
  const env = getEnv();
  if (!env.S3_BUCKET_ATTACHMENTS) throw new Error('S3_BUCKET_ATTACHMENTS is required');
  return env.S3_BUCKET_ATTACHMENTS;
}
