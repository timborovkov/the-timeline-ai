import { timingSafeEqual } from 'node:crypto';

export const operatorProbeHeaders = { 'Cache-Control': 'no-store' };

export function authorizeOperatorProbe(request: Request, secret: string | undefined) {
  if (!secret) return probeUnavailable();
  const authorization = request.headers.get('authorization');
  const bearer = /^Bearer ([^\s]+)$/i.exec(authorization ?? '')?.[1];
  if (bearer) {
    const supplied = Buffer.from(bearer);
    const expected = Buffer.from(secret);
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return null;
  }
  return Response.json({ ok: false }, { status: 401, headers: operatorProbeHeaders });
}

export function probeUnavailable() {
  return Response.json({ ok: false }, { status: 503, headers: operatorProbeHeaders });
}

export async function boundedProbe<T>(inspect: () => Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('operator_probe_timeout'));
      }, ms);
    });
    return await Promise.race([inspect(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
