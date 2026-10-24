/**
 * Same-origin Sentry envelope tunnel.
 *
 * Next.js 16.3+ `tunnelRoute` implements the tunnel as a rewrite through
 * `proxyRequest` / httpxy. That path registers enough `ServerResponse`
 * `close` listeners (plus compression and APM) to trip Node's default
 * MaxListeners warning of 11. This handler forwards to the configured DSN
 * ingest URL instead, and never attaches `close` listeners to the Node
 * response.
 */

const SENTRY_TUNNEL_MAX_BODY_BYTES = 10 * 1024 * 1024;
const SENTRY_TUNNEL_TIMEOUT_MS = 10_000;

export interface SentryIngestTarget {
  url: string;
  host: string;
  projectId: string;
}

export function sentryIngestTargetFromDsn(dsn: string | undefined): SentryIngestTarget | null {
  if (!dsn) return null;
  let parsed: URL;
  try {
    parsed = new URL(dsn);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!parsed.username) return null;
  const projectId = parsed.pathname.replace(/^\//u, '').split('/')[0];
  if (!projectId || !/^[a-zA-Z0-9]+$/u.test(projectId)) return null;
  if (!parsed.hostname) return null;
  const url = new URL(`https://${parsed.host}/api/${projectId}/envelope/`);
  url.searchParams.set('sentry_key', parsed.username);
  url.searchParams.set('sentry_version', '7');
  return { url: url.toString(), host: parsed.host, projectId };
}

async function readCappedRequestBody(
  req: Request,
  maxBytes = SENTRY_TUNNEL_MAX_BODY_BYTES,
): Promise<{ ok: true; body: Uint8Array } | { ok: false; reason: 'too_large' }> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too_large' };
  if (!req.body) return { ok: true, body: new Uint8Array() };
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > maxBytes) return { ok: false, reason: 'too_large' };
  return { ok: true, body };
}

export async function forwardSentryTunnelEnvelope(input: {
  dsn: string | undefined;
  req: Request;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  const target = sentryIngestTargetFromDsn(input.dsn);
  if (!target) {
    return Response.json({ ok: false, reason: 'tunnel_disabled' }, { status: 503 });
  }
  const capped = await readCappedRequestBody(input.req);
  if (!capped.ok) {
    return Response.json({ ok: false, reason: 'payload_too_large' }, { status: 413 });
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const contentType = input.req.headers.get('content-type') ?? 'application/x-sentry-envelope';
  try {
    const upstream = await fetchImpl(target.url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: Buffer.from(capped.body),
      signal: AbortSignal.any([input.req.signal, AbortSignal.timeout(SENTRY_TUNNEL_TIMEOUT_MS)]),
      redirect: 'error',
    });
    const responseHeaders = new Headers();
    const retryAfter = upstream.headers.get('retry-after');
    const rateLimits = upstream.headers.get('x-sentry-rate-limits');
    if (retryAfter) responseHeaders.set('retry-after', retryAfter);
    if (rateLimits) responseHeaders.set('x-sentry-rate-limits', rateLimits);
    return new Response(null, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ ok: false, reason: 'upstream_unreachable' }, { status: 502 });
  }
}
