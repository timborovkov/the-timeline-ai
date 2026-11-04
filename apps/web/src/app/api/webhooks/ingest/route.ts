import * as ingestWebhooks from '@timeline/shared/ingest-webhooks';
import { childLogger } from '@timeline/shared/logger';
import * as rateLimit from '@timeline/shared/rate-limit';

import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';
import { readCappedTextBody } from '@/lib/request-body';
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
    eventClass: resolved.eventClass,
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
  const receivedAt = new Date();
  const visibility = ingestVisibilityFor(resolved.visibilityDefault, resolved.ownerUserId);

  let enqueue: ingestWebhooks.IngestEvidenceEnqueue | undefined;
  let queueUnavailable: unknown;
  try {
    enqueue = await requireRedisQueue();
  } catch (err) {
    queueUnavailable = err;
    log.error({ err, teamId: resolved.teamId }, 'ingest webhook queue unavailable');
    reportCaughtError(err, { surface: 'api', operation: 'ingest_webhook_enqueue_queue' });
  }

  const accepted = await ingestWebhooks.acceptIngestWebhookEvidence({
    db,
    teamId: resolved.teamId,
    webhookId: resolved.webhookId,
    webhookName: resolved.name,
    credentialId: resolved.credentialId,
    contentType,
    body,
    eventClass: resolved.eventClass,
    visibility: visibility.value,
    visibilityOwnerUserId: visibility.ownerUserId,
    authorUserId: null,
    proposalGenerationEnabled: resolved.proposalGenerationEnabled,
    receivedAt,
    requestHeaders: redactedHeaders(req.headers),
    ...(enqueue ? { enqueue } : {}),
    ...(queueUnavailable !== undefined ? { queueUnavailable } : {}),
  });

  if (accepted.status === 'duplicate') {
    return Response.json(
      { ok: true, status: 'duplicate', rawEventId: accepted.rawEventId },
      { status: 200 },
    );
  }
  return Response.json(
    { ok: true, status: 'accepted', rawEventId: accepted.rawEventId },
    { status: 202 },
  );
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

function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded ?? headers.get('x-real-ip') ?? 'unknown';
}
