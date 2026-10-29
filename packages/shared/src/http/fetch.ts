/** Standard request signature, without runtime-specific connection helpers. */
export type FetchRequest = (
  ...args: Parameters<typeof globalThis.fetch>
) => ReturnType<typeof globalThis.fetch>;

/** Preserve Bun's connection hint when an SDK types its transport as `typeof fetch`. */
export function asBunFetch(request: FetchRequest): typeof globalThis.fetch {
  return Object.assign((...args: Parameters<FetchRequest>) => request(...args), {
    preconnect: globalThis.fetch.preconnect,
  });
}
