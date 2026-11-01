import { z } from 'zod';

import { inboundEmailSchema, type InboundEmail } from '#src/email/inbound-schema.js';
import { getEnv } from '#src/env.js';
import { externalFetch, ExternalHttpError } from '#src/http/external-fetch.js';
import { validateMcpUrl } from '#src/mcp/auth.js';

export type EmailFetch = (
  ...args: Parameters<typeof globalThis.fetch>
) => ReturnType<typeof globalThis.fetch>;

export class ResendError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs = 0,
  ) {
    super(`Resend request failed: ${code}`);
    this.name = 'ResendError';
  }
}

export function retryAfterMilliseconds(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Math.max(0, Date.parse(value) - Date.now()) || 0;
}

/** Shared bounded transport. Provider errors never include message contents or signed URLs. */
export async function resendRequest(
  path: string,
  init: RequestInit = {},
  fetchImpl: EmailFetch = fetch,
): Promise<unknown> {
  const key = getEnv().RESEND_API_KEY;
  if (!key) throw new ResendError('not_configured', false);
  let response: Response;
  try {
    response = await fetchImpl(`https://api.resend.com${path}`, {
      ...init,
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...Object.fromEntries(new Headers(init.headers).entries()),
      },
    });
  } catch {
    throw new ResendError('network_error', true);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = z.object({ name: z.string() }).safeParse(body);
    const code = parsed.success ? parsed.data.name : `http_${response.status}`;
    throw new ResendError(
      code,
      response.status === 429 ||
        response.status >= 500 ||
        response.status === 408 ||
        code === 'concurrent_idempotent_requests',
      retryAfterMilliseconds(response.headers.get('retry-after')),
    );
  }
  if (body === null) throw new ResendError('invalid_response', true);
  return body;
}

const receivedSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.array(z.string()),
  cc: z.array(z.string()).default([]),
  bcc: z.array(z.string()).default([]),
  received_for: z.array(z.string()).default([]),
  subject: z.string().nullable(),
  text: z.string().nullable(),
  html: z.string().nullable(),
  created_at: z.string(),
  message_id: z.string().nullable(),
  headers: z.record(z.string(), z.string()).default({}),
  authentication: z
    .object({ spf: z.string(), dkim: z.string(), dmarc: z.string() })
    .nullable()
    .optional(),
});
const attachmentSchema = z.object({
  id: z.string(),
  filename: z.string().nullable(),
  content_type: z.string(),
  size: z.number().nonnegative(),
  content_id: z.string().nullable().optional(),
  download_url: z.string(),
});
const attachmentPageSchema = z.object({
  data: z.array(attachmentSchema),
  has_more: z.boolean().default(false),
});
const MAX_BYTES = 25 * 1024 * 1024;

function address(value: string): { email: string; name: string } {
  const match = /^(.*?)\s*<([^>]+)>\s*$/.exec(value);
  return {
    email: (match?.[2] ?? value).trim().toLowerCase(),
    name: (match?.[1] ?? '').trim().replace(/^"|"$/g, ''),
  };
}

async function downloadAttachment(
  url: string,
  remaining: number,
  fetchImpl: EmailFetch,
): Promise<Buffer | null> {
  const invalid = validateMcpUrl(url);
  if (invalid || new URL(url).protocol !== 'https:')
    throw new ResendError('unsafe_attachment_url', false);
  let response: Response;
  try {
    response =
      fetchImpl === globalThis.fetch
        ? await externalFetch(
            url,
            { redirect: 'error' },
            { timeoutMs: 30_000, maxResponseBytes: remaining },
          )
        : await fetchImpl(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
  } catch (error) {
    if (error instanceof ExternalHttpError && error.code === 'response_too_large') return null;
    if (
      error instanceof ExternalHttpError &&
      ['blocked_address', 'invalid_url'].includes(error.code)
    )
      throw new ResendError('unsafe_attachment_url', false);
    throw new ResendError('attachment_download_failed', true);
  }
  if (!response.ok || !response.body)
    throw new ResendError(
      'attachment_download_failed',
      true,
      retryAfterMilliseconds(response.headers.get('retry-after')),
    );
  if (Number(response.headers.get('content-length')) > remaining) {
    await response.body.cancel();
    return null;
  }
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > remaining) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    throw new ResendError('attachment_download_failed', true);
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function retrieveInboundEmail(
  emailId: string,
  fetchImpl: EmailFetch = fetch,
): Promise<InboundEmail> {
  const path = `/emails/receiving/${encodeURIComponent(emailId)}`;
  const email = receivedSchema.parse(await resendRequest(`${path}?html_format=cid`, {}, fetchImpl));
  if (email.id !== emailId) throw new ResendError('email_id_mismatch', false);
  const headers = Object.entries(email.headers).map(([name, value]) => ({ name, value }));
  if (email.message_id) {
    const existing = headers.find((h) => h.name.toLowerCase() === 'message-id');
    if (existing) existing.value = email.message_id;
    else headers.push({ name: 'Message-ID', value: email.message_id });
  }
  const normalized = inboundEmailSchema.parse({
    providerId: email.id,
    sentAt: email.headers.date ?? email.created_at,
    subject: email.subject ?? '',
    from: address(email.from).email,
    fromAddress: address(email.headers.from ?? email.from),
    toAddresses: email.to.map(address),
    ccAddresses: email.cc.map(address),
    bccAddresses: email.bcc.map(address),
    receivedFor: email.received_for,
    text: email.text ?? '',
    html: email.html ?? '',
    headers,
    authentication: email.authentication ?? null,
  });
  let cursor: string | undefined;
  let total = 0;
  const seen = new Set<string>();
  do {
    const page = attachmentPageSchema.parse(
      await resendRequest(
        `${path}/attachments${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`,
        {},
        fetchImpl,
      ),
    );
    for (const attachment of page.data) {
      if (seen.has(attachment.id)) throw new ResendError('attachment_pagination_loop', false);
      seen.add(attachment.id);
      const name = attachment.filename?.trim()
        ? attachment.filename
        : `attachment-${attachment.id}`;
      if (attachment.size > MAX_BYTES - total) {
        normalized.attachmentsDropped.push({ filename: name, reason: 'total_size_cap_exceeded' });
        continue;
      }
      const content = await downloadAttachment(
        attachment.download_url,
        MAX_BYTES - total,
        fetchImpl,
      );
      if (!content) {
        normalized.attachmentsDropped.push({ filename: name, reason: 'total_size_cap_exceeded' });
        continue;
      }
      total += content.length;
      normalized.attachments.push({
        id: attachment.id,
        name,
        content,
        size: content.length,
        contentType: attachment.content_type,
        contentId: attachment.content_id ?? '',
      });
    }
    cursor = page.has_more ? page.data.at(-1)?.id : undefined;
    if (page.has_more && !cursor) throw new ResendError('invalid_attachment_page', false);
  } while (cursor);
  return normalized;
}
