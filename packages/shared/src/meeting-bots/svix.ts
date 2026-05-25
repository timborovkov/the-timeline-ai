import { createHmac, timingSafeEqual } from 'node:crypto';

// Minimal Svix webhook signature verifier. Recall.ai's status webhook is
// Svix-signed; rather than pulling in the `svix` npm package we implement
// the documented v1 scheme inline. The signing format:
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

interface SvixVerifyInput {
  body: string;
  /** Header bag — case-insensitive lookup. */
  headers: Headers;
  /** The configured webhook secret. Either raw or `whsec_` prefixed. */
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

function decodeSecret(secret: string): Buffer {
  // Svix secrets are conventionally `whsec_<base64>` but raw base64 (or
  // even raw bytes) works too. Accept both.
  const stripped = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  try {
    return Buffer.from(stripped, 'base64');
  } catch {
    return Buffer.from(stripped, 'utf8');
  }
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
  const ts = Number(svixTs);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'invalid_signature_format' };
  }
  const now = (input.now ?? (() => new Date()))();
  const tolerance = input.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  if (Math.abs(now.getTime() / 1000 - ts) > tolerance) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  let secretBytes: Buffer;
  try {
    secretBytes = decodeSecret(input.secret);
  } catch {
    return { ok: false, reason: 'invalid_secret' };
  }
  if (secretBytes.length === 0) return { ok: false, reason: 'invalid_secret' };

  const signedPayload = `${svixId}.${svixTs}.${input.body}`;
  const expected = createHmac('sha256', secretBytes).update(signedPayload).digest();

  // Parse the comma/space-separated `v1,<base64>` list. ANY match accepted.
  const entries = svixSig.split(/\s+/).filter(Boolean);
  for (const entry of entries) {
    const [version, b64] = entry.split(',');
    if (version !== 'v1' || !b64) continue;
    let provided: Buffer;
    try {
      provided = Buffer.from(b64, 'base64');
    } catch {
      continue;
    }
    if (provided.length !== expected.length) continue;
    if (timingSafeEqual(provided, expected)) return { ok: true };
  }
  return { ok: false, reason: 'bad_signature' };
}
