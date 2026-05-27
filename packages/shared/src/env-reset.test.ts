import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  type S3Client,
} from '@aws-sdk/client-s3';
import { postgresResetStatements } from '@timeline/db';
import { describe, expect, it, vi } from 'vitest';

import {
  assertResetNodeEnv,
  configuredBuckets,
  deleteAllQdrantCollections,
  emptyBucket,
  versionedBuckets,
} from './env-reset.js';

describe('env reset helpers', () => {
  it('requires NODE_ENV to be explicitly development or test', () => {
    expect(assertResetNodeEnv('development')).toBe('development');
    expect(assertResetNodeEnv('test')).toBe('test');
    expect(() => assertResetNodeEnv(undefined)).toThrow(/NODE_ENV/);
    expect(() => assertResetNodeEnv('production')).toThrow(/NODE_ENV/);
    expect(() => assertResetNodeEnv('')).toThrow(/NODE_ENV/);
  });

  it('deduplicates configured buckets and excludes empty values', () => {
    const env = {
      S3_BUCKET_AUDIO: 'timeline-audio',
      S3_BUCKET_ATTACHMENTS: 'timeline-attachments',
      S3_BUCKET_DOCUMENTS: 'timeline-audio',
      S3_BUCKET_EXPORTS: '',
    };

    expect(configuredBuckets(env)).toEqual(['timeline-audio', 'timeline-attachments']);
    expect(versionedBuckets(env)).toEqual(['timeline-audio', 'timeline-attachments']);
  });

  it('deletes all qdrant collections', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      calls.push(init ? { url, init } : { url });
      if (url.endsWith('/collections') && !init?.method) {
        return Promise.resolve(
          response({ result: { collections: [{ name: 'events' }, { name: 'events_v2' }] } }),
        );
      }
      return Promise.resolve(response({}));
    }) as unknown as typeof fetch;

    await expect(
      deleteAllQdrantCollections({
        url: 'http://qdrant:6333/',
        apiKey: 'dev-key',
        fetcher,
      }),
    ).resolves.toEqual(['events', 'events_v2']);

    expect(calls).toMatchObject([
      { url: 'http://qdrant:6333/collections' },
      {
        url: 'http://qdrant:6333/collections/events',
        init: { method: 'DELETE', headers: { 'api-key': 'dev-key' } },
      },
      {
        url: 'http://qdrant:6333/collections/events_v2',
        init: { method: 'DELETE', headers: { 'api-key': 'dev-key' } },
      },
    ]);
  });

  it('empties versioned buckets including delete markers', async () => {
    const sent: unknown[] = [];
    const client = fakeS3((command) => {
      sent.push(command);
      if (command instanceof ListObjectVersionsCommand) {
        return Promise.resolve({
          IsTruncated: false,
          Versions: [{ Key: 'a.txt', VersionId: 'v1' }],
          DeleteMarkers: [{ Key: 'b.txt', VersionId: 'v2' }],
        });
      }
      return Promise.resolve({});
    });

    await expect(emptyBucket(client, 'bucket')).resolves.toBe(2);
    const deleteCommand = sent.find((command) => command instanceof DeleteObjectsCommand);
    if (!(deleteCommand instanceof DeleteObjectsCommand)) {
      throw new Error('expected DeleteObjectsCommand');
    }
    expect(deleteCommand.input).toMatchObject({
      Bucket: 'bucket',
      Delete: {
        Objects: [
          { Key: 'a.txt', VersionId: 'v1' },
          { Key: 'b.txt', VersionId: 'v2' },
        ],
      },
    });
  });

  it('falls back to unversioned bucket listing when versions are unsupported', async () => {
    const sent: unknown[] = [];
    const client = fakeS3((command) => {
      sent.push(command);
      if (command instanceof ListObjectVersionsCommand)
        return Promise.reject(
          Object.assign(new Error('not implemented'), { name: 'NotImplemented' }),
        );
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({ IsTruncated: false, Contents: [{ Key: 'a.txt' }] });
      }
      return Promise.resolve({});
    });

    await expect(emptyBucket(client, 'bucket')).resolves.toBe(1);
    expect(sent.some((command) => command instanceof ListObjectsV2Command)).toBe(true);
  });

  it('does not fall back when versioned object deletion fails', async () => {
    const client = fakeS3((command) => {
      if (command instanceof ListObjectVersionsCommand) {
        return Promise.resolve({
          IsTruncated: false,
          Versions: [{ Key: 'a.txt', VersionId: 'v1' }],
        });
      }
      if (command instanceof DeleteObjectsCommand) {
        return Promise.reject(new Error('delete failed'));
      }
      return Promise.resolve({});
    });

    await expect(emptyBucket(client, 'bucket')).rejects.toThrow(/delete failed/);
  });

  it('builds postgres reset statements without dropping the database', () => {
    const statements = postgresResetStatements();
    expect(statements.join('\n')).toContain('pg_terminate_backend');
    expect(statements).toContain('DROP SCHEMA IF EXISTS public CASCADE');
    expect(statements).toContain('DROP SCHEMA IF EXISTS drizzle CASCADE');
    expect(statements).toContain('CREATE SCHEMA public');
    expect(statements.join('\n')).not.toMatch(/DROP DATABASE/i);
  });
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeS3(send: (command: unknown) => Promise<unknown>): S3Client {
  return { send } as unknown as S3Client;
}
