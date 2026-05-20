import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface PutObjectInput {
  bucket: string;
  key: string;
  body: Buffer | Uint8Array;
  contentType?: string;
}

/**
 * HEAD an object to learn its size + content type without downloading the
 * body. Use this to bounds-check large inputs (the transcribe worker reads
 * the whole audio file into memory; oversize uploads would OOM the process).
 *
 * `contentLength` is intentionally `number | undefined` so callers can tell
 * "0-byte object" apart from "server didn't return a Content-Length header
 * at all" — the latter cannot be safely bounded and should be refused at
 * the call site rather than silently treated as 0. Throws if the object
 * doesn't exist.
 */
export async function headObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<{ contentLength: number | undefined; contentType?: string }> {
  const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const contentLength = typeof res.ContentLength === 'number' ? res.ContentLength : undefined;
  return res.ContentType ? { contentLength, contentType: res.ContentType } : { contentLength };
}

export async function putObject(client: S3Client, input: PutObjectInput): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}

/**
 * Phase 3 reads short voice memos fully into memory. Long-form audio (when it
 * lands) should stream straight from S3 to the transcription provider; revisit
 * then.
 *
 * `maxBytes` is a defense-in-depth cap that aborts mid-stream once the
 * accumulated body exceeds the limit. A trustworthy HEAD-based pre-check is
 * better (no body bytes wasted), but a server that hides Content-Length or
 * a body that grows past its advertised length still must not OOM us.
 */
export async function getObjectBuffer(
  client: S3Client,
  bucket: string,
  key: string,
  maxBytes?: number,
): Promise<{ body: Buffer; contentType?: string }> {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const stream = res.Body;
  if (!stream) throw new Error(`S3 object empty: ${bucket}/${key}`);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (typeof maxBytes === 'number' && total > maxBytes) {
      // The body iterator owns the underlying HTTP socket; abandoning it
      // here is safe — the SDK / Node will tear down the connection when
      // the iterator is garbage collected.
      throw new Error(`S3 object ${bucket}/${key} exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks);
  return res.ContentType ? { body, contentType: res.ContentType } : { body };
}

export function getSignedGetObjectUrl(
  client: S3Client,
  bucket: string,
  key: string,
  ttlSec = 3600,
): Promise<string> {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: ttlSec,
  });
}

export function getSignedPutObjectUrl(
  client: S3Client,
  bucket: string,
  key: string,
  contentType: string,
  ttlSec = 600,
): Promise<string> {
  return getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn: ttlSec },
  );
}
