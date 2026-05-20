import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface PutObjectInput {
  bucket: string;
  key: string;
  body: Buffer | Uint8Array;
  contentType?: string;
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
 */
export async function getObjectBuffer(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<{ body: Buffer; contentType?: string }> {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const stream = res.Body;
  if (!stream) throw new Error(`S3 object empty: ${bucket}/${key}`);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
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
