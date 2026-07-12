import type { ObjectListFilter, ObjectRow } from '@timeline/shared/objects/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_PRELOAD_LIMIT = 200;

type ListObjects = (filter: ObjectListFilter) => Promise<ObjectRow[]>;

export async function loadProjectFilterRows({
  listObjects,
  selected,
  includeArchivedSelected = false,
  preloadFilter = { type: 'project', archived: false, limit: PROJECT_PRELOAD_LIMIT },
}: {
  listObjects: ListObjects;
  selected: string;
  includeArchivedSelected?: boolean;
  preloadFilter?: ObjectListFilter;
}): Promise<ObjectRow[]> {
  const selectedIds = Array.from(
    new Set(
      selected
        .split(',')
        .map((id) => id.trim())
        .filter((id) => UUID_RE.test(id)),
    ),
  ).slice(0, PROJECT_PRELOAD_LIMIT);
  const [preloaded, selectedRows] = await Promise.all([
    listObjects(preloadFilter),
    selectedIds.length > 0
      ? listObjects({
          id: selectedIds,
          type: 'project',
          ...(!includeArchivedSelected ? { archived: false } : {}),
          limit: selectedIds.length,
        })
      : Promise.resolve([]),
  ]);
  const byId = new Map(preloaded.map((row) => [row.id, row] as const));
  for (const row of selectedRows) byId.set(row.id, row);
  return [...byId.values()];
}
