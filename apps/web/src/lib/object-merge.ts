export const MAX_OBJECT_MERGE_SELECTION = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseObjectMergeIds(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '');
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => UUID_RE.test(part)),
    ),
  );
}

export function parseSingleObjectMergeId(value: string | string[] | undefined): string | undefined {
  const ids = parseObjectMergeIds(value);
  return ids.length === 1 ? ids[0] : undefined;
}

export function objectMergeHref(selectedIds: string[]): string {
  const params = new URLSearchParams({ ids: selectedIds.join(',') });
  return `/app/objects/merge?${params.toString()}`;
}
