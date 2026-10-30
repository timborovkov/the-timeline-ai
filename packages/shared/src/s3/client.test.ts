import { expect } from '@timeline/test-support';
import { vi, freshModuleUrl } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

import type * as TestModule1 from '#src/s3/client.js';
/**
 * S3 client contract tests. RustFS/S3 config is env-driven; these tests make
 * sure missing config fails early and browser-facing presign clients use the
 * public endpoint when one is configured.
 */

const fakes = vi.hoisted(() => ({
  clients: [] as FakeS3Client[],
}));

class FakeS3Client {
  config: Record<string, unknown>;
  constructor(config: Record<string, unknown>) {
    this.config = config;
    fakes.clients.push(this);
  }
}

await vi.mock(
  import.meta.resolve('@aws-sdk/client-s3'),
  () => ({
    S3Client: FakeS3Client,
  }),
  () => import('@aws-sdk/client-s3'),
);

function setBaseEnv(): void {
  process.env.AUTH_SECRET = 'test-secret-at-least-sixteen-characters';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.S3_ENDPOINT = 'http://private-rustfs:9000';
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_ACCESS_KEY_ID = 'timeline';
  process.env.S3_SECRET_ACCESS_KEY = 'secret';
  process.env.S3_BUCKET_AUDIO = 'audio';
  process.env.S3_BUCKET_ATTACHMENTS = 'attachments';
  process.env.S3_BUCKET_DOCUMENTS = 'documents';
  process.env.S3_BUCKET_EXPORTS = 'exports';
  delete process.env.S3_PUBLIC_ENDPOINT;
}

async function importClient() {
  return import(freshModuleUrl(import.meta.resolve('./client.js'))) as Promise<typeof TestModule1>;
}

beforeEach(() => {
  vi.resetModules();
  fakes.clients = [];
  setBaseEnv();
});

describe('S3 client config', () => {
  it('rejects missing base S3 config and exposes bucket accessors', async () => {
    delete process.env.S3_ENDPOINT;
    const s3 = await importClient();

    expect(() => s3.getS3Client()).toThrow('S3 not configured');

    process.env.S3_ENDPOINT = 'http://private-rustfs:9000';
    expect(s3.getAudioBucket()).toBe('audio');
    expect(s3.getAttachmentsBucket()).toBe('attachments');
    expect(s3.getDocumentsBucket()).toBe('documents');
    expect(s3.getExportsBucket()).toBe('exports');
  });

  it('uses private endpoint for worker clients and public endpoint for browser presign clients', async () => {
    process.env.S3_PUBLIC_ENDPOINT = 'https://public-rustfs.example.test';
    const s3 = await importClient();

    const workerClient = s3.getS3Client();
    const presignClient = s3.getS3PresignClient();

    expect(workerClient).toBe(fakes.clients[0]);
    expect(presignClient).toBe(fakes.clients[1]);
    expect(fakes.clients[0]?.config).toMatchObject({
      endpoint: 'http://private-rustfs:9000',
      region: 'us-east-1',
      forcePathStyle: true,
    });
    expect(fakes.clients[1]?.config).toMatchObject({
      endpoint: 'https://public-rustfs.example.test',
      region: 'us-east-1',
      forcePathStyle: true,
    });
  });

  it('falls back to the worker client for presigning when no public endpoint is configured', async () => {
    const s3 = await importClient();

    expect(s3.getS3PresignClient()).toBe(s3.getS3Client());
    expect(fakes.clients).toHaveLength(1);
  });
});
