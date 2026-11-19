export const REQUEST_BODY_LIMITS = {
  chat: 4 * 1024 * 1024,
  globalSearch: 16 * 1024,
  integrationWebhook: 1024 * 1024,
  mcpServer: 256 * 1024,
  recallTranscript: 2 * 1024 * 1024,
  slackCommand: 256 * 1024,
} as const;

export type CappedBinaryBody = { tooLarge: false; body: Uint8Array } | { tooLarge: true };
export type CappedTextBody = { tooLarge: false; text: string } | { tooLarge: true };

export function hasOversizedContentLength(req: Request, maxBytes: number): boolean {
  const declaredLength = Number(req.headers.get('content-length'));
  return Number.isFinite(declaredLength) && declaredLength > maxBytes;
}

/** Stops reading as soon as the streamed body exceeds maxBytes. */
export async function readCappedBinaryBody(
  req: Request,
  maxBytes: number,
): Promise<CappedBinaryBody> {
  if (hasOversizedContentLength(req, maxBytes)) return { tooLarge: true };
  if (!req.body) return { tooLarge: false, body: new Uint8Array() };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Stream chunks are ordered and must be bounded before the next chunk is retained.
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { tooLarge: false, body };
}

/** Decodes the body after the streaming byte limit has been checked. */
export async function readCappedTextBody(req: Request, maxBytes: number): Promise<CappedTextBody> {
  const capped = await readCappedBinaryBody(req, maxBytes);
  if (capped.tooLarge) return { tooLarge: true };
  return { tooLarge: false, text: new TextDecoder().decode(capped.body) };
}

export function payloadTooLargeResponse(): Response {
  return Response.json({ ok: false, reason: 'payload_too_large' }, { status: 413 });
}
