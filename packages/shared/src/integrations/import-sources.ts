import { boardImportLinks, boardImportRules, boards, rawEvents, type Db } from '@timeline/db';
import {
  isBoardImportProvider,
  type BoardImportProvider,
} from '@timeline/db/integration-providers';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';

import { rawEventIsActive } from '#src/visibility.js';

// Acquire before reading or changing an import target or its source visibility.
export function lockBoardImports(db: Pick<Db, 'execute'>, teamId: string) {
  return db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'board-import:' + teamId},0))`,
  );
}

const sourceUrlPrefixes = {
  github: 'https://github.com/',
  hubspot: 'https://app.hubspot.com/',
  linear: 'https://linear.app/',
} satisfies Record<BoardImportProvider, string>;

export interface ImportSource {
  id: string;
  field: string;
  state: string;
  provider: string;
  url: string | null;
  canManage: boolean;
}
async function readImportSources(
  db: Pick<Db, 'select'>,
  teamId: string,
  userId: string,
  role: string,
  target: 'item' | 'entity' | 'status',
  ids: string[],
) {
  if (!ids.length) return [];
  const readable = readableImportSource(userId);
  const rows = await db
    .select({
      readable: sql<boolean>`${readable}`,
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
        target === 'status'
          ? and(eq(boardImportLinks.field, 'status'), eq(boardImportLinks.state, 'active'))
          : and(readable, inArray(boardImportLinks.state, ['active', 'paused'])),
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
    url:
      isBoardImportProvider(row.provider) && row.url?.startsWith(sourceUrlPrefixes[row.provider])
        ? row.url
        : null,
  }));
}

export function readableImportSource(userId: string) {
  return and(
    eq(rawEvents.visibility, 'team'),
    rawEventIsActive(),
    or(eq(boards.isShared, true), eq(boards.createdBy, userId)),
  );
}

export function visibleImportSources(
  db: Pick<Db, 'select'>,
  teamId: string,
  userId: string,
  role: string,
  target: 'item' | 'entity',
  ids: string[],
) {
  return readImportSources(db, teamId, userId, role, target, ids);
}

export async function taskStatusSources(
  db: Pick<Db, 'select'>,
  teamId: string,
  userId: string,
  role: string,
  ids: string[],
) {
  const rows = await readImportSources(db, teamId, userId, role, 'status', ids);
  return new Map(rows.map((row) => [row.entityId, row.readable ? row : ('locked' as const)]));
}
