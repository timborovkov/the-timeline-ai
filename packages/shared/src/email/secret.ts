import { timingSafeEqual } from 'node:crypto';

/**
 * Verify the inbound Postmark webhook is authentic.
 *
 * Postmark offers Basic Auth on the inbound URL: the server sends
 * `Authorization: Basic <base64(user:pass)>` on every request. We treat the
 * concatenated `user:pass` as the shared secret so the dashboard config is
 * flexible (either `postmark:<secret>` or `:<secret>` works).
 *
 * Constant-time compare on the decoded credential string, mirroring the
 * Telegram webhook's `verifyWebhookSecret`. Returns false on any malformed
 * input — never throws.
 */
export function verifyPostmarkBasicAuth(
  authorizationHeader: string | null | undefined,
  expectedSecret: string | null | undefined,
): boolean {
  if (!authorizationHeader || !expectedSecret) return false;
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/.exec(authorizationHeader);
  if (!match?.[1]) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return false;
  }
  // Split into user:pass. Postmark sends `postmark:<secret>` by default; we
  // accept either side carrying the secret so deployments can choose. The
  // expected secret is the full <secret> value, not a `user:pass` string.
  const sepIdx = decoded.indexOf(':');
  const pass = sepIdx === -1 ? decoded : decoded.slice(sepIdx + 1);
  const user = sepIdx === -1 ? '' : decoded.slice(0, sepIdx);
  // Accept the secret in either position — some users will configure
  // `<secret>:` and others `:<secret>`.
  return constantEq(pass, expectedSecret) || constantEq(user, expectedSecret);
}

function constantEq(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
