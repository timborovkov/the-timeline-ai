import { createHash } from 'node:crypto';

import { rawEvents } from '@timeline/db';
import * as ingestWebhooks from '@timeline/shared/ingest-webhooks';
import { childLogger } from '@timeline/shared/logger';
import * as rateLimit from '@timeline/shared/rate-limit';
import { normalizeRawEventsToEvidence } from '@timeline/shared/reconciliation/normalization';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';
import { reportCaughtError } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TEXT_BYTES = 1024 * 1024;
const log = childLogger('web:api:ingest-webhook');

const SENSITIVE_HEADER_RE = /authorization|cookie|secret|signature|token|key/i;
const TEXTUAL_CONTENT_TYPES = [
  'application/json',
  'application/xml',
  'application/x-www-form-urlencoded',
  'application/csv',
  'application/x-ndjson',
  'application/yaml',
  'application/graphql',
  'text/',
];

export async function GET(req: Request): Promise<Response> {
  return handleGet(req);
}

// react-doctor-disable-next-line react-doctor/webhook-signature-risk -- Generic ingest webhooks authenticate with Timeline-issued high-entropy bearer/URL credentials, not provider signatures.
export async function POST(req: Request): Promise<Response> {
  return handlePost(req);
}

export async function handleGet(req: Request, pathToken?: string): Promise<Response> {
  const token = tokenFromRequest(req, pathToken);
  if (!token) return Response.json({ ok: false, reason: 'missing_credential' }, { status: 401 });
  const resolved = await ingestWebhooks.resolveCredential(db, token);
  if (!resolved) {
    const authLimit = await checkInvalidCredentialLimit(req);
    if (!authLimit.ok) {
      return Response.json({ ok: false, reason: 'rate_limited' }, { status: 429 });
    }
    return Response.json({ ok: false, reason: 'invalid_credential' }, { status: 401 });
  }
  return Response.json({
    ok: true,
    name: resolved.name,
    visibilityDefault: resolved.visibilityDefault,
    proposalGenerationEnabled: resolved.proposalGenerationEnabled,
  });
}

export async function handlePost(req: Request, pathToken?: string): Promise<Response> {
  const token = tokenFromRequest(req, pathToken);
  if (!token) return Response.json({ ok: false, reason: 'missing_credential' }, { status: 401 });

  const resolved = await ingestWebhooks.resolveCredential(db, token);
  if (!resolved) {
    const authLimit = await checkInvalidCredentialLimit(req);
    if (!authLimit.ok) {
      return Response.json({ ok: false, reason: 'rate_limited' }, { status: 429 });
    }
    return Response.json({ ok: false, reason: 'invalid_credential' }, { status: 401 });
  }

  const ingestLimit = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('ingest_webhook', 'credential', resolved.credentialId),
    ...rateLimit.RATE_LIMITS.ingestWebhook,
  });
  if (!ingestLimit.ok) {
    return Response.json({ ok: false, reason: 'rate_limited' }, { status: 429 });
  }

  const contentLength = req.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_TEXT_BYTES) {
    return Response.json({ ok: false, reason: 'payload_too_large' }, { status: 413 });
  }
  const contentType = normalizeContentType(req.headers.get('content-type'));
  if (!isTextualContentType(contentType)) {
    return Response.json({ ok: false, reason: 'unsupported_media_type' }, { status: 415 });
  }

  const bodyResult = await readCappedTextBody(req, MAX_TEXT_BYTES);
  if (bodyResult.tooLarge) {
    return Response.json({ ok: false, reason: 'payload_too_large' }, { status: 413 });
  }
  const body = bodyResult.text;
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const receivedAt = new Date();
  const dedupKey = dedupKeyFor(resolved.webhookId, bodyHash, receivedAt);
  const contentText = renderWebhookContent({
    webhookName: resolved.name,
    contentType,
    body,
  });
  const sourceMetadata = {
    ingest_webhook_id: resolved.webhookId,
    ingest_webhook_credential_id: resolved.credentialId,
    ingest_webhook_name: resolved.name,
    ingest_webhook_body_sha256: bodyHash,
    ingest_webhook_dedup_key: dedupKey,
    content_type: contentType,
    method: 'POST',
    received_at: receivedAt.toISOString(),
    request_headers: redactedHeaders(req.headers),
    proposal_generation_enabled: resolved.proposalGenerationEnabled,
  };
  const visibility = ingestVisibilityFor(resolved.visibilityDefault, resolved.ownerUserId);

  const rows = await db
    .insert(rawEvents)
    .values({
      teamId: resolved.teamId,
      authorUserId: null,
      visibilityOwnerUserId: visibility.ownerUserId,
      source: 'ingest_webhook',
      contentText,
      occurredAt: receivedAt,
      visibility: visibility.value,
      sourceMetadata,
    })
    .onConflictDoNothing()
    .returning({ id: rawEvents.id, teamId: rawEvents.teamId });
  const event = rows[0];
  if (!event) {
    const duplicate = await findDedupedEvent(resolved.teamId, dedupKey);
    if (duplicate) {
      await enqueueProcessing(duplicate, resolved.proposalGenerationEnabled);
    }
    return Response.json(
      { ok: true, status: 'duplicate', rawEventId: duplicate?.id ?? null },
      { status: 200 },
    );
  }

  await normalizeRawEventEvidence(event);
  await enqueueProcessing(event, resolved.proposalGenerationEnabled);
  return Response.json({ ok: true, status: 'accepted', rawEventId: event.id }, { status: 202 });
}

async function normalizeRawEventEvidence(event: { id: string; teamId: string }): Promise<void> {
  try {
    await normalizeRawEventsToEvidence({ db, teamId: event.teamId, rawEventIds: [event.id] });
  } catch (err) {
    log.warn(
      { err, teamId: event.teamId, rawEventId: event.id },
      'ingest webhook reconciliation evidence normalization failed',
    );
  }
}

async function findDedupedEvent(
  teamId: string,
  dedupKey: string,
): Promise<{ id: string; teamId: string } | null> {
  const rows = await db
    .select({ id: rawEvents.id, teamId: rawEvents.teamId })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, teamId),
        eq(rawEvents.source, 'ingest_webhook'),
        sql`${rawEvents.sourceMetadata} ->> 'ingest_webhook_dedup_key' = ${dedupKey}`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function tokenFromRequest(req: Request, pathToken?: string): string | null {
  const url = new URL(req.url);
  return (
    pathToken ??
    url.searchParams.get('key') ??
    url.searchParams.get('token') ??
    ingestWebhooks.extractBearerToken(req.headers.get('authorization'))
  );
}

function normalizeContentType(value: string | null): string {
  return (value ?? 'text/plain').split(';')[0]?.trim().toLowerCase() ?? 'text/plain';
}

function isTextualContentType(contentType: string): boolean {
  if (contentType === 'application/octet-stream') return false;
  if (contentType.startsWith('multipart/')) return false;
  if (contentType.endsWith('+json') || contentType.endsWith('+xml')) return true;
  return TEXTUAL_CONTENT_TYPES.some((prefix) =>
    prefix.endsWith('/') ? contentType.startsWith(prefix) : contentType === prefix,
  );
}

function redactedHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    if (SENSITIVE_HEADER_RE.test(name)) {
      result[name] = '[redacted]';
    } else {
      result[name] = value.slice(0, 500);
    }
  }
  return result;
}

function renderWebhookContent(input: {
  webhookName: string;
  contentType: string;
  body: string;
}): string {
  return [
    `Ingest webhook: ${input.webhookName}`,
    `Content-Type: ${input.contentType}`,
    '',
    input.body.length > 0 ? input.body : '[empty payload]',
  ].join('\n');
}

async function readCappedTextBody(
  req: Request,
  maxBytes: number,
): Promise<{ tooLarge: false; text: string } | { tooLarge: true }> {
  if (!req.body) return { tooLarge: false, text: '' };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  async function readNext(total: number): Promise<number | null> {
    const { done, value } = await reader.read();
    if (done) return total;
    const nextTotal = total + value.byteLength;
    if (nextTotal > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
    return readNext(nextTotal);
  }

  const total = await readNext(0);
  if (total === null) return { tooLarge: true };

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { tooLarge: false, text: new TextDecoder().decode(body) };
}

function dedupKeyFor(webhookId: string, bodyHash: string, receivedAt: Date): string {
  return `${webhookId}:${receivedAt.toISOString().slice(0, 10)}:${bodyHash}`;
}

function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded ?? headers.get('x-real-ip') ?? 'unknown';
}

function ingestVisibilityFor(
  visibilityDefault: 'private' | 'team' | 'specific_users',
  ownerUserId: string | null,
): { value: 'private' | 'team' | 'specific_users'; ownerUserId: string | null } {
  if (visibilityDefault === 'private' && !ownerUserId) {
    return { value: 'team', ownerUserId: null };
  }
  return { value: visibilityDefault, ownerUserId };
}

async function checkInvalidCredentialLimit(req: Request): Promise<{ ok: boolean }> {
  const clientIp = clientIpFromHeaders(req.headers);
  return rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('ingest_webhook', 'auth_ip', clientIp),
    ...rateLimit.RATE_LIMITS.ingestWebhookAuth,
  });
}

async function enqueueProcessing(
  event: { id: string; teamId: string },
  proposalGenerationEnabled: boolean,
): Promise<void> {
  let queueModule: Awaited<ReturnType<typeof requireRedisQueue>>;
  try {
    queueModule = await requireRedisQueue();
  } catch (err) {
    await markProcessingFailure(event.id, 'queue', err);
    return;
  }
  await Promise.all([
    queueModule
      .enqueueExtractJob({ rawEventId: event.id, teamId: event.teamId })
      .catch((err: unknown) => markProcessingFailure(event.id, 'extraction', err)),
    queueModule
      .enqueueEmbedJob({ rawEventId: event.id, teamId: event.teamId })
      .catch((err: unknown) => markProcessingFailure(event.id, 'embedding', err)),
    proposalGenerationEnabled
      ? queueModule
          .enqueueSuggestionJob({ rawEventId: event.id, teamId: event.teamId })
          .catch((err: unknown) => markProcessingFailure(event.id, 'suggestions', err))
      : Promise.resolve(),
  ]);
}

async function markProcessingFailure(
  rawEventId: string,
  stage: 'queue' | 'extraction' | 'embedding' | 'suggestions',
  err: unknown,
): Promise<void> {
  log.error({ err, rawEventId, stage }, 'ingest webhook processing enqueue failed');
  reportCaughtError(err, { surface: 'api', operation: `ingest_webhook_enqueue_${stage}` });
  const patch = JSON.stringify({
    [`${stage}_failed_at`]: new Date().toISOString(),
    [`${stage}_error`]: `enqueue failed: ${
      err instanceof Error ? err.message.slice(0, 480) : 'unknown'
    }`,
  });
  await db
    .update(rawEvents)
    .set({
      sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
    })
    .where(sql`${rawEvents.id} = ${rawEventId}`)
    .catch((markErr: unknown) => {
      log.error({ err: markErr, rawEventId, stage }, 'failed to mark ingest webhook failure');
    });
}
