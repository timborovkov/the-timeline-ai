import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S3 object wrapper tests. These cover the command shapes and memory safety
 * boundaries around uploads, downloads, metadata reads, and signed URLs.
 */

const fakes = vi.hoisted(() => ({
  signedUrlCalls: [] as { command: unknown; options: unknown }[],
}));

class FakeCommand {
  input: unknown;
  constructor(input: unknown) {
    this.input = input;
  }
}

class GetObjectCommand extends FakeCommand {}
class HeadObjectCommand extends FakeCommand {}
class PutObjectCommand extends FakeCommand {}
class DeleteObjectCommand extends FakeCommand {}

vi.mock('@aws-sdk/client-s3', () => ({
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn((_client: unknown, command: unknown, options: unknown) => {
    fakes.signedUrlCalls.push({ command, options });
    return Promise.resolve('https://signed.example.test/url');
  }),
}));

interface SentCommand {
  input: Record<string, unknown>;
  constructor: { name: string };
}

function makeClient(handler: (command: SentCommand) => unknown): {
  send: (command: unknown) => unknown;
} {
  return {
    send(command: unknown) {
      return handler(command as SentCommand);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.signedUrlCalls = [];
});

describe('S3 object helpers', () => {
  it('heads objects with content metadata and uploads with content type', async () => {
    const { deleteObject, headObject, putObject } = await import('./objects.js');
    const sent: SentCommand[] = [];
    const client = makeClient((command) => {
      sent.push(command);
      if (command.constructor.name === 'HeadObjectCommand') {
        return { ContentLength: 123, ContentType: 'text/plain' };
      }
      return {};
    });

    await expect(headObject(client as never, 'bucket', 'key.txt')).resolves.toEqual({
      contentLength: 123,
      contentType: 'text/plain',
    });
    await putObject(client as never, {
      bucket: 'bucket',
      key: 'key.txt',
      body: Buffer.from('hello'),
      contentType: 'text/plain',
    });

    expect(sent[0]).toBeInstanceOf(HeadObjectCommand);
    expect(sent[0]?.input).toEqual({ Bucket: 'bucket', Key: 'key.txt' });
    expect(sent[1]).toBeInstanceOf(PutObjectCommand);
    expect(sent[1]?.input).toMatchObject({
      Bucket: 'bucket',
      Key: 'key.txt',
      ContentType: 'text/plain',
    });

    await deleteObject(client as never, 'bucket', 'key.txt');
    expect(sent[2]).toBeInstanceOf(DeleteObjectCommand);
    expect(sent[2]?.input).toEqual({ Bucket: 'bucket', Key: 'key.txt' });
  });

  it('reads object bodies, preserves content type, and rejects empty or oversize bodies', async () => {
    const { getObjectBuffer } = await import('./objects.js');
    const okClient = makeClient(() => ({
      Body: Readable.from([Buffer.from('hello'), Buffer.from(' world')]),
      ContentType: 'audio/webm',
    }));

    await expect(getObjectBuffer(okClient as never, 'audio', 'memo.webm', 32)).resolves.toEqual({
      body: Buffer.from('hello world'),
      contentType: 'audio/webm',
    });

    const emptyClient = makeClient(() => ({}));
    await expect(getObjectBuffer(emptyClient as never, 'audio', 'missing.webm')).rejects.toThrow(
      'S3 object empty: audio/missing.webm',
    );

    const largeClient = makeClient(() => ({ Body: Readable.from([Buffer.alloc(10)]) }));
    await expect(getObjectBuffer(largeClient as never, 'audio', 'huge.webm', 5)).rejects.toThrow(
      'exceeds 5 bytes',
    );
  });

  it('signs GET and PUT commands with the requested TTL and content type', async () => {
    const { getSignedGetObjectUrl, getSignedPutObjectUrl } = await import('./objects.js');
    const client = makeClient(() => ({}));

    await expect(getSignedGetObjectUrl(client as never, 'bucket', 'file.txt', 90)).resolves.toBe(
      'https://signed.example.test/url',
    );
    await expect(
      getSignedPutObjectUrl(client as never, 'bucket', 'file.txt', 'text/plain', 120),
    ).resolves.toBe('https://signed.example.test/url');

    expect(fakes.signedUrlCalls[0]).toMatchObject({
      command: { input: { Bucket: 'bucket', Key: 'file.txt' } },
      options: { expiresIn: 90 },
    });
    expect(fakes.signedUrlCalls[1]).toMatchObject({
      command: { input: { Bucket: 'bucket', Key: 'file.txt', ContentType: 'text/plain' } },
      options: { expiresIn: 120 },
    });
  });
});
