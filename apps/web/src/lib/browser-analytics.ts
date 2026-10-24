import type { CaptureResult } from 'posthog-js';

export function sanitizeBrowserAnalyticsEvent(
  event: CaptureResult,
  publicPaths: ReadonlySet<string>,
): CaptureResult | null {
  if (event.event === '$snapshot') return null;
  if (event.event === '$pageview' || event.event === '$pageleave') {
    const url = parseUrl(event.properties.$current_url);
    if (!url || !publicPaths.has(url.pathname)) return null;
  }

  function sanitize(properties: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(properties).flatMap(([key, value]) => {
        if (/title|search_keyword|ph_keyword|utm_|gclid|fbclid|msclkid|dclid|srsltid/i.test(key))
          return [];
        if ((key === '$set' || key === '$set_once') && value && typeof value === 'object') {
          return [[key, sanitize(value as Record<string, unknown>)]];
        }
        if (key.endsWith('referrer')) {
          return [[key, parseUrl(value)?.origin ?? '$direct']];
        }
        if (key.endsWith('url')) {
          const url = parseUrl(value);
          return [
            [key, url ? url.origin + (publicPaths.has(url.pathname) ? url.pathname : '/') : ''],
          ];
        }
        if (key.endsWith('pathname')) {
          return [[key, typeof value === 'string' && publicPaths.has(value) ? value : '/']];
        }
        return [[key, value]];
      }),
    );
  }

  return {
    ...event,
    properties: sanitize(event.properties),
    ...(event.$set ? { $set: sanitize(event.$set) } : {}),
    ...(event.$set_once ? { $set_once: sanitize(event.$set_once) } : {}),
  };
}

function parseUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}
