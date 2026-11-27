import { boardImportLinks, boardImportRules, boards, rawEvents, type Db } from '@timeline/db';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';

import { rawEventIsActive } from '#src/visibility.js';

export interface ImportSource {
  id: string;
  field: string;
  state: string;
  provider: string;
  url: string | null;
  canManage: boolean;
}
export async function visibleImportSources(
  db: Pick<Db, 'select'>,
  teamId: string,
  userId: string,
  role: string,
  target: 'item' | 'entity',
  ids: string[],
) {
  if (!ids.length) return [];
  const rows = await db
    .select({
      id: boardImportLinks.id,
      field: boardImportLinks.field,
      state: boardImportLinks.state,
      provider: boardImportRules.provider,
      url: boardImportLinks.sourceUrl,
      eventId: boardImportLinks.sourceEventId,
      itemId: boardImportLinks.itemId,
      entityId: boardImportLinks.entityId,
    })
    .from(boardImportLinks)
    .innerJoin(boardImportRules, eq(boardImportRules.id, boardImportLinks.ruleId))
    .innerJoin(boards, eq(boards.id, boardImportRules.boardId))
    .innerJoin(rawEvents, eq(rawEvents.id, boardImportLinks.sourceEventId))
    .where(
      and(
        eq(boardImportLinks.teamId, teamId),
        eq(rawEvents.teamId, teamId),
        eq(rawEvents.visibility, 'team'),
        rawEventIsActive(),
        or(eq(boards.isShared, true), eq(boards.createdBy, userId)),
        inArray(boardImportLinks.state, ['active', 'paused']),
        inArray(target === 'item' ? boardImportLinks.itemId : boardImportLinks.entityId, ids),
      ),
    )
    .orderBy(
      desc(sql`${boardImportLinks.state}='active'`),
      desc(sql`${boardImportLinks.field}<>'reference'`),
      boardImportLinks.id,
    );
  return rows.map((row) => ({
    ...row,
    canManage: role === 'owner' || role === 'admin',
    url: row.url?.startsWith(
      row.provider === 'github' ? 'https://github.com/' : 'https://app.hubspot.com/',
    )
      ? row.url
      : null,
  }));
}
