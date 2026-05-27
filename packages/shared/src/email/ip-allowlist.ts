/**
 * IPv4 CIDR allowlist. Parses `1.2.3.4/24` (or bare `1.2.3.4` ≡ `/32`) and
 * tests whether an IP address falls inside any entry. IPv6 deferred —
 * Postmark publishes IPv4 webhook sources today.
 */

interface Cidr {
  /** Network address as a 32-bit unsigned int. */
  network: number;
  /** Prefix length 0-32. */
  prefix: number;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    acc = (acc * 256 + n) >>> 0;
  }
  return acc >>> 0;
}

export function parseCidrList(input: string): Cidr[] {
  const out: Cidr[] = [];
  for (const raw of input.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const [ipPart, prefixPart] = trimmed.split('/');
    const prefix = prefixPart === undefined ? 32 : Number(prefixPart);
    if (!ipPart || !Number.isFinite(prefix) || prefix < 0 || prefix > 32) continue;
    const network = ipv4ToInt(ipPart);
    if (network === null) continue;
    out.push({ network, prefix });
  }
  return out;
}

export function isIpAllowed(ip: string | null | undefined, cidrs: Cidr[]): boolean {
  if (!ip) return false;
  const addr = ipv4ToInt(ip);
  if (addr === null) return false;
  for (const c of cidrs) {
    if (c.prefix === 0) return true;
    const mask = c.prefix === 32 ? 0xffffffff : (0xffffffff << (32 - c.prefix)) >>> 0;
    if ((addr & mask) >>> 0 === (c.network & mask) >>> 0) return true;
  }
  return false;
}

/** Extract the client IP from common proxy headers. Prefer Cloudflare, then first entry of XFF. */
export function clientIpFromHeaders(headers: Headers): string | null {
  const cf = headers.get('cf-connecting-ip');
  if (cf) {
    const trimmed = cf.trim();
    if (trimmed) return trimmed;
  }
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  return null;
}
