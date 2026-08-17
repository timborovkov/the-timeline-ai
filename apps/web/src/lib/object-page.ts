import { encodeCursor } from '@timeline/shared/pagination';

import type * as objects from '@timeline/shared/objects';

const OBJECTS_PAGE_SIZE = 48;
export const OBJECTS_SECTION_PREVIEW_SIZE = 8;

export interface ObjectListScope {
  listObjects(filter: objects.ObjectListFilter): Promise<objects.ObjectRow[]>;
}

export interface ObjectRowsPage {
  rows: objects.ObjectRow[];
  nextCursor: string | null;
}

export async function loadObjectRowsPage(
  objectScope: Pick<ObjectListScope, 'listObjects'>,
  cursor?: string | null,
  filter: objects.ObjectListFilter = {},
): Promise<ObjectRowsPage> {
  const rows = await objectScope.listObjects({
    ...filter,
    archived: false,
    limit: OBJECTS_PAGE_SIZE + 1,
    cursor,
  });
  const pageRows = rows.slice(0, OBJECTS_PAGE_SIZE);
  const last = pageRows.at(-1);
  return {
    rows: pageRows,
    nextCursor:
      rows.length > OBJECTS_PAGE_SIZE && last
        ? encodeCursor({ at: last.updatedAt.toISOString(), id: last.id })
        : null,
  };
}
