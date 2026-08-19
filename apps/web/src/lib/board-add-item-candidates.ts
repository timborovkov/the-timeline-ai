import {
  OBJECT_TYPES,
  type ObjectListFilter,
  type ObjectRow,
  type ObjectType,
} from '@timeline/shared/objects/types';

const BOARD_ADD_ITEM_CANDIDATE_LIMIT = 200;
const MIN_PER_RECOMMENDED_TYPE = 24;

type ListObjects = (filter: ObjectListFilter) => Promise<ObjectRow[]>;
type SelectableObjectType = (typeof OBJECT_TYPES)[number];

function isSelectableObjectType(type: ObjectType): type is SelectableObjectType {
  return (OBJECT_TYPES as readonly ObjectType[]).includes(type);
}

export function boardAddItemTypeOptions(
  recommendedTypes: readonly ObjectType[],
): SelectableObjectType[] {
  const seen = new Set<SelectableObjectType>();
  const ordered: SelectableObjectType[] = [];
  for (const type of [...recommendedTypes, ...OBJECT_TYPES]) {
    if (!isSelectableObjectType(type) || seen.has(type)) continue;
    seen.add(type);
    ordered.push(type);
  }
  return ordered;
}

export async function loadBoardAddItemCandidates({
  listObjects,
  recommendedTypes,
  limit = BOARD_ADD_ITEM_CANDIDATE_LIMIT,
}: {
  listObjects: ListObjects;
  recommendedTypes: readonly ObjectType[];
  limit?: number;
}): Promise<ObjectRow[]> {
  const types = boardAddItemTypeOptions(recommendedTypes).filter((type) =>
    recommendedTypes.includes(type),
  );
  if (types.length === 0) {
    return listObjects({ archived: false, limit });
  }

  const perType = Math.max(MIN_PER_RECOMMENDED_TYPE, Math.ceil(limit / types.length));
  const groups = await Promise.all(
    types.map((type) => listObjects({ type, archived: false, limit: perType })),
  );
  const byId = new Map<string, ObjectRow>();
  const typeRank = new Map<string, number>(types.map((type, index) => [type, index]));
  for (const group of groups) {
    for (const row of group) {
      if (!row.archivedAt) byId.set(row.id, row);
    }
  }
  return [...byId.values()]
    .sort((a, b) => {
      const rankA = typeRank.get(a.type) ?? Number.MAX_SAFE_INTEGER;
      const rankB = typeRank.get(b.type) ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    })
    .slice(0, limit);
}
