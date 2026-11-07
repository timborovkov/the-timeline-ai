import { type Db, entities } from '@timeline/db';
import { and, asc, eq, gt, isNull, or, type SQL, sql } from 'drizzle-orm';

export const PAGE_SIZE = 500;

type EntityCursor = { updatedAt: Date; id: string };

export function listReembedEntitiesPage(db: Db, teamId: string, cursor: EntityCursor | null) {
  const conditions: SQL[] = [eq(entities.teamId, teamId), isNull(entities.mergedIntoId)];
  if (cursor) {
    const after = or(
      sql`${entities.updatedAt} > ${cursor.updatedAt.toISOString()}::timestamptz`,
      and(
        sql`${entities.updatedAt} = ${cursor.updatedAt.toISOString()}::timestamptz`,
        gt(entities.id, cursor.id),
      ),
    );
    if (after) conditions.push(after);
  }
  return db
    .select({ id: entities.id, updatedAt: entities.updatedAt })
    .from(entities)
    .where(and(...conditions))
    .orderBy(asc(entities.updatedAt), asc(entities.id))
    .limit(PAGE_SIZE);
}

export async function enqueueByUpdatedAt(args: {
  budget: number;
  dryRun: boolean;
  fetchPage: (
    cursor: { updatedAt: Date; id: string } | null,
  ) => Promise<{ id: string; updatedAt: Date }[]>;
  enqueueRow: (id: string) => Promise<void>;
}): Promise<{ scanned: number; enqueued: number }> {
  if (args.budget <= 0) return { scanned: 0, enqueued: 0 };
  let cursor: { updatedAt: Date; id: string } | null = null;
  let enqueued = 0;
  let scanned = 0;
  while (enqueued < args.budget) {
    const page = await args.fetchPage(cursor);
    if (page.length === 0) break;
    for (const row of page) {
      scanned += 1;
      if (!args.dryRun) await args.enqueueRow(row.id);
      enqueued += 1;
      if (enqueued >= args.budget) break;
    }
    const last = page[page.length - 1];
    if (!last) break;
    cursor = { updatedAt: last.updatedAt, id: last.id };
    if (page.length < PAGE_SIZE) break;
  }
  return { scanned, enqueued };
}
