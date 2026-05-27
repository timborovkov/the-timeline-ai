import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  PutBucketVersioningCommand,
  type ObjectIdentifier,
  type S3Client,
} from '@aws-sdk/client-s3';
import IORedis from 'ioredis';

type ResetNodeEnv = 'development' | 'test';

export function assertResetNodeEnv(value: string | undefined): ResetNodeEnv {
  if (value === 'development' || value === 'test') return value;
  throw new Error('env:reset requires NODE_ENV to be explicitly set to development or test');
}

interface ResetEnv {
  REDIS_URL?: string;
  QDRANT_URL?: string;
  QDRANT_API_KEY?: string;
  S3_BUCKET_AUDIO?: string;
  S3_BUCKET_ATTACHMENTS?: string;
  S3_BUCKET_DOCUMENTS?: string;
  S3_BUCKET_EXPORTS?: string;
}

export function configuredBuckets(env: ResetEnv): string[] {
  return [
    env.S3_BUCKET_AUDIO,
    env.S3_BUCKET_ATTACHMENTS,
    env.S3_BUCKET_DOCUMENTS,
    env.S3_BUCKET_EXPORTS,
  ].filter((bucket, index, buckets): bucket is string => {
    return typeof bucket === 'string' && bucket.length > 0 && buckets.indexOf(bucket) === index;
  });
}

export function versionedBuckets(env: ResetEnv): string[] {
  return [env.S3_BUCKET_AUDIO, env.S3_BUCKET_ATTACHMENTS, env.S3_BUCKET_DOCUMENTS].filter(
    (bucket, index, buckets): bucket is string =>
      typeof bucket === 'string' && bucket.length > 0 && buckets.indexOf(bucket) === index,
  );
}

export async function flushRedisAll(redisUrl: string): Promise<void> {
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  try {
    await redis.flushall();
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

interface QdrantResetOptions {
  url: string;
  apiKey?: string;
  fetcher?: typeof fetch;
}

interface QdrantCollectionsResponse {
  result?: {
    collections?: { name?: string }[];
  };
}

export async function deleteAllQdrantCollections(options: QdrantResetOptions): Promise<string[]> {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = options.url.replace(/\/$/, '');
  const headers: Record<string, string> = {};
  if (options.apiKey) headers['api-key'] = options.apiKey;

  const list = await fetcher(`${baseUrl}/collections`, { headers });
  if (!list.ok) {
    throw new Error(`Qdrant list collections failed: ${String(list.status)} ${await list.text()}`);
  }
  const json = (await list.json()) as QdrantCollectionsResponse;
  const names =
    json.result?.collections
      ?.map((collection) => collection.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0) ?? [];

  for (const name of names) {
    const res = await fetcher(`${baseUrl}/collections/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `Qdrant delete collection ${name} failed: ${String(res.status)} ${await res.text()}`,
      );
    }
  }
  return names;
}

export async function emptyBucket(client: S3Client, bucket: string): Promise<number> {
  if (!(await bucketExists(client, bucket))) return 0;

  try {
    return await emptyVersionedBucket(client, bucket);
  } catch (err) {
    if (err instanceof UnsupportedBucketVersionListingError) {
      return await emptyUnversionedBucket(client, bucket);
    }
    throw err;
  }
}

export async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  if (await bucketExists(client, bucket)) return;
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
}

export async function enableBucketVersioning(client: S3Client, bucket: string): Promise<void> {
  await client.send(
    new PutBucketVersioningCommand({
      Bucket: bucket,
      VersioningConfiguration: { Status: 'Enabled' },
    }),
  );
}

export function postgresResetStatements(): string[] {
  return [
    `SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()`,
    'DROP SCHEMA IF EXISTS public CASCADE',
    'CREATE SCHEMA public',
    'GRANT ALL ON SCHEMA public TO public',
    'GRANT ALL ON SCHEMA public TO CURRENT_USER',
  ];
}

async function bucketExists(client: S3Client, bucket: string): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch {
    return false;
  }
}

async function emptyVersionedBucket(client: S3Client, bucket: string): Promise<number> {
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  let deleted = 0;

  for (;;) {
    const res = await listObjectVersions(client, bucket, keyMarker, versionIdMarker);
    const objects = [
      ...(res.Versions ?? []).map((item) => objectIdentifier(item.Key, item.VersionId)),
      ...(res.DeleteMarkers ?? []).map((item) => objectIdentifier(item.Key, item.VersionId)),
    ].filter((item): item is ObjectIdentifier => item !== null);

    deleted += await deleteObjectBatch(client, bucket, objects);
    if (!res.IsTruncated) return deleted;
    keyMarker = res.NextKeyMarker;
    versionIdMarker = res.NextVersionIdMarker;
  }
}

async function listObjectVersions(
  client: S3Client,
  bucket: string,
  keyMarker: string | undefined,
  versionIdMarker: string | undefined,
) {
  try {
    return await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    );
  } catch (err) {
    if (isVersionListingUnsupported(err)) throw new UnsupportedBucketVersionListingError(err);
    throw err;
  }
}

async function emptyUnversionedBucket(client: S3Client, bucket: string): Promise<number> {
  let continuationToken: string | undefined;
  let deleted = 0;

  for (;;) {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
    );
    const objects = (res.Contents ?? [])
      .map((item) => objectIdentifier(item.Key))
      .filter((item): item is ObjectIdentifier => item !== null);

    deleted += await deleteObjectBatch(client, bucket, objects);
    if (!res.IsTruncated) return deleted;
    continuationToken = res.NextContinuationToken;
  }
}

function objectIdentifier(key: string | undefined, versionId?: string): ObjectIdentifier | null {
  if (!key) return null;
  return versionId ? { Key: key, VersionId: versionId } : { Key: key };
}

async function deleteObjectBatch(
  client: S3Client,
  bucket: string,
  objects: ObjectIdentifier[],
): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < objects.length; i += 1000) {
    const batch = objects.slice(i, i + 1000);
    if (batch.length === 0) continue;
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch } }));
    deleted += batch.length;
  }
  return deleted;
}

class UnsupportedBucketVersionListingError extends Error {
  constructor(cause: unknown) {
    super('bucket does not support listing object versions', { cause });
    this.name = 'UnsupportedBucketVersionListingError';
  }
}

function isVersionListingUnsupported(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as {
    name?: unknown;
    Code?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: number };
  };
  const reason = [candidate.name, candidate.Code, candidate.code]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return (
    /\b(NotImplemented|NotSupported|XNotImplemented)\b/i.test(reason) ||
    candidate.$metadata?.httpStatusCode === 501 ||
    candidate.$metadata?.httpStatusCode === 405
  );
}
