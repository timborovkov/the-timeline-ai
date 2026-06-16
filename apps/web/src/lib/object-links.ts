export function objectDetailHref(objectId: string, returnTo?: string | null): string {
  if (!returnTo) return `/app/objects/${objectId}`;
  const params = new URLSearchParams({ returnTo });
  return `/app/objects/${objectId}?${params.toString()}`;
}
