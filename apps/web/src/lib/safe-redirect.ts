function resolveAllowedOrigin(): string | null {
  const originInput = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  try {
    return new URL(originInput).origin;
  } catch {
    return null;
  }
}

// Whitelist callbackUrl to same-origin destinations to prevent open redirect.
// Defense: parse with a base origin so URL normalization handles protocol-
// relative and backslash variants before final path validation.
export function safeSameOriginPath(input: string | undefined, fallback: string): string {
  if (!input) return fallback;
  const allowedOrigin = resolveAllowedOrigin();
  if (!allowedOrigin) return fallback;

  let path: string;
  try {
    const target = new URL(input, allowedOrigin);
    if (target.origin !== allowedOrigin) return fallback;
    path = `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }

  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    return fallback;
  }
  return path;
}
