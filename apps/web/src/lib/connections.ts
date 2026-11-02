export const CONNECTIONS_HREF = '/app/sources';

export function providerLogoSrc(provider: string): string {
  return `/connectors/${provider.replaceAll('_', '-')}.svg`;
}

export function connectionsHref(
  query?: Record<string, string | string[] | undefined> | URLSearchParams,
): string {
  const qs = query instanceof URLSearchParams ? query : new URLSearchParams();
  if (!(query instanceof URLSearchParams) && query) {
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string') qs.append(key, value);
      else if (Array.isArray(value)) {
        for (const item of value) qs.append(key, item);
      }
    }
  }
  const suffix = qs.toString();
  return suffix ? `${CONNECTIONS_HREF}?${suffix}` : CONNECTIONS_HREF;
}
