const TURNSTILE = 'https://challenges.cloudflare.com';
const POSTHOG_INGEST = ['https://m.thetimeline.cc', 'https://eu.i.posthog.com'];
export const baseContentSecurityPolicy = {
  key: 'Content-Security-Policy',
  value: "frame-ancestors 'none'; base-uri 'self'",
};

function publicStorageOrigin(raw: string | undefined): string | undefined {
  if (!raw) return;
  try {
    const url = new URL(raw);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      !url.username &&
      !url.password &&
      (url.protocol === 'https:' || (local && url.protocol === 'http:'))
    ) {
      return url.origin;
    }
  } catch {
    // A malformed origin cannot add a CSP source.
  }
}

export function contentSecurityPolicyHeaders(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== 'production') return [];

  const publicEndpoint = env.S3_PUBLIC_ENDPOINT?.trim();
  const storage = publicStorageOrigin(publicEndpoint ? publicEndpoint : env.S3_ENDPOINT);
  const storageSource = storage ? ` ${storage}` : '';
  const policy = [
    baseContentSecurityPolicy.value,
    "default-src 'self'",
    // Statically rendered Next.js pages include inline hydration and theme scripts.
    `script-src 'self' 'unsafe-inline' ${TURNSTILE}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${TURNSTILE} ${POSTHOG_INGEST.join(' ')}${storageSource}`,
    `frame-src 'self' ${TURNSTILE} blob:${storageSource}`,
    `img-src 'self' data: blob:${storageSource}`,
    "font-src 'self' data:",
    `media-src 'self' blob:${storageSource}`,
    "worker-src 'self' blob:",
    // The document preview embeds a signed PDF with an object and an iframe fallback.
    `object-src ${storage ?? "'none'"}`,
  ].join('; ');

  return env.WEB_CSP_MODE === 'enforce'
    ? [{ ...baseContentSecurityPolicy, value: policy }]
    : [{ key: 'Content-Security-Policy-Report-Only', value: policy }];
}
