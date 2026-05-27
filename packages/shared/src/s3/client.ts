import { S3Client } from '@aws-sdk/client-s3';

import { getEnv } from '../env.js';

let _client: S3Client | undefined;
let _presignClient: S3Client | undefined;

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

/**
 * S3 client whose endpoint matches the URL the *browser* will hit. Use this
 * for any signed URL handed to a client (PUT for uploads, GET for playback).
 * Signatures are bound to the host in the URL, so a URL signed against the
 * private endpoint is unusable from a browser even if we string-rewrite the
 * host. Falls back to the standard client when S3_PUBLIC_ENDPOINT is unset.
 */
export function getS3PresignClient(): S3Client {
  if (_presignClient) return _presignClient;
  const env = getEnv();
  if (!env.S3_PUBLIC_ENDPOINT) {
    _presignClient = getS3Client();
    return _presignClient;
  }
  if (!env.S3_REGION || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error(
      'S3 not configured: S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY required',
    );
  }
  _presignClient = new S3Client({
    endpoint: env.S3_PUBLIC_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: env.S3_FORCE_PATH_STYLE ?? true,
  });
  return _presignClient;
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

export function getDocumentsBucket(): string {
  const env = getEnv();
  if (!env.S3_BUCKET_DOCUMENTS) throw new Error('S3_BUCKET_DOCUMENTS is required');
  return env.S3_BUCKET_DOCUMENTS;
}

export function getExportsBucket(): string {
  const env = getEnv();
  if (!env.S3_BUCKET_EXPORTS) throw new Error('S3_BUCKET_EXPORTS is required');
  return env.S3_BUCKET_EXPORTS;
}
