export const REQUEST_BODY_LIMITS = {
  integrationWebhook: 1024 * 1024,
  recallTranscript: 2 * 1024 * 1024,
  slackCommand: 256 * 1024,
} as const;

export type CappedTextBody = { tooLarge: false; text: string } | { tooLarge: true };

/** Reads a request body without ever retaining more than maxBytes in memory. */
export async function readCappedTextBody(req: Request, maxBytes: number): Promise<CappedTextBody> {
  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return { tooLarge: true };
  if (!req.body) return { tooLarge: false, text: '' };

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
  return { tooLarge: false, text: new TextDecoder().decode(body) };
}

export function payloadTooLargeResponse(): Response {
  return Response.json({ ok: false, reason: 'payload_too_large' }, { status: 413 });
}
