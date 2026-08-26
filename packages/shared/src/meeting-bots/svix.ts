import { createHmac, timingSafeEqual } from 'node:crypto';

// Minimal Recall.ai / Svix webhook signature verifier. Recall signs both
// dashboard status webhooks and per-bot realtime transcript endpoints with
// the documented v1 scheme:
//
//   signed_payload = `${svix_id}.${svix_timestamp}.${rawBody}`
//   signature      = base64( HMAC-SHA256(secret_bytes, signed_payload) )
//
// The header `svix-signature` (or its `webhook-signature` alias) holds
// one or more space-separated `v1,<base64>` entries; ANY match counts.
//
// Tolerance: requests older than `toleranceSec` are rejected to prevent
// replay; default 5 minutes matches the Svix SDK default.

const DEFAULT_TOLERANCE_SEC = 5 * 60;
const MIN_RECALL_WEBHOOK_SECRET_BYTES = 24;

interface SvixVerifyInput {
  body: string;
  /** Header bag — case-insensitive lookup. */
  headers: Headers;
  /** The configured Recall workspace or legacy Svix `whsec_` secret. */
  secret: string;
  /** Override clock for tests. */
  now?: () => Date;
  /** Override max age for tests. */
  toleranceSec?: number;
}

export interface SvixVerifyResult {
  ok: boolean;
  reason?:
    | 'missing_headers'
    | 'stale_timestamp'
    | 'bad_signature'
    | 'invalid_secret'
    | 'invalid_signature_format';
}

function decodeCanonicalBase64(value: string): Buffer | null {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    return null;
  }
  const decoded = Buffer.from(value, 'base64');
  return decoded.length > 0 && decoded.toString('base64') === value ? decoded : null;
}

function decodeSecret(secret: string): Buffer | null {
  if (!secret.startsWith('whsec_')) return null;
  const decoded = decodeCanonicalBase64(secret.slice('whsec_'.length));
  return decoded && decoded.length >= MIN_RECALL_WEBHOOK_SECRET_BYTES ? decoded : null;
}

/** Validate Recall/Svix signing secrets before accepting webhook traffic. */
export function isValidRecallWebhookSecret(secret: string): boolean {
  return decodeSecret(secret) !== null;
}

function header(headers: Headers, name: string): string | null {
  // Recall.ai sends both `svix-*` and `webhook-*` aliases per Svix spec.
  return headers.get(name) ?? headers.get(name.replace(/^svix-/, 'webhook-'));
}

export function verifySvixSignature(input: SvixVerifyInput): SvixVerifyResult {
  const svixId = header(input.headers, 'svix-id');
  const svixTs = header(input.headers, 'svix-timestamp');
  const svixSig = header(input.headers, 'svix-signature');
  if (!svixId || !svixTs || !svixSig) {
    return { ok: false, reason: 'missing_headers' };
  }
  if (!/^\d+$/.test(svixTs)) {
    return { ok: false, reason: 'invalid_signature_format' };
  }
  const ts = Number(svixTs);
  if (!Number.isSafeInteger(ts) || ts <= 0) {
    return { ok: false, reason: 'invalid_signature_format' };
  }
  const now = (input.now ?? (() => new Date()))();
  const tolerance = input.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  if (Math.abs(now.getTime() / 1000 - ts) > tolerance) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const secretBytes = decodeSecret(input.secret);
  if (!secretBytes) return { ok: false, reason: 'invalid_secret' };

  const signedPayload = `${svixId}.${svixTs}.${input.body}`;
  const expected = createHmac('sha256', secretBytes).update(signedPayload).digest();

  // Parse the comma/space-separated `v1,<base64>` list. ANY match accepted.
  const entries = svixSig.split(/\s+/).filter(Boolean);
  for (const entry of entries) {
    const [version, b64] = entry.split(',');
    if (version !== 'v1' || !b64) continue;
    const provided = decodeCanonicalBase64(b64);
    if (!provided) continue;
    if (provided.length !== expected.length) continue;
    if (timingSafeEqual(provided, expected)) return { ok: true };
  }
  return { ok: false, reason: 'bad_signature' };
}
