import { schema, teams, type Db } from '@timeline/db';
import { eq, is, sql, Table } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { PURGED_TEAM_TABLES } from '#src/team-lifecycle/inventory.js';
import { lifecycleRows } from '#src/team-lifecycle/result.js';

/** Only invoked by the explicit maintenance scope. Never use a client-supplied table name. */
export async function purgeTeamRows(db: Db, teamId: string): Promise<boolean> {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team?.deletionStartedAt) throw new Error('Permanent deletion has not started');
  // Legacy history must go before deleting any parent: ON DELETE SET NULL
  // would also revalidate its old NOT VALID provenance constraints.
  let legacyRemaining = false;
  for (const history of ['board_item_changes', 'object_changes']) {
    const deleted = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('timeline.lifecycle_cleanup', 'on', true)`);
      return tx.execute(sql`DELETE FROM ${sql.identifier(history)} WHERE ctid IN
        (SELECT ctid FROM ${sql.identifier(history)} WHERE team_id = ${teamId}::uuid
         AND source_event_id IS NOT NULL LIMIT 500) RETURNING 1`);
    });
    if (lifecycleRows(deleted).length) legacyRemaining = true;
  }
  if (legacyRemaining) return false;
  let remaining = false;
  for (const tableName of PURGED_TEAM_TABLES) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('timeline.lifecycle_cleanup', 'on', true)`);
      // Nullable cross-links can otherwise form cycles between purge-owned rows.
      const table = Object.values(schema).find(
        (value) => is(value, Table) && getTableConfig(value).name === tableName,
      );
      if (!table || !is(table, Table)) throw new Error('Unclassified deletion table');
      // Historical rows can predate NOT VALID provenance checks. Delete history
      // directly: unrelated FK updates would revalidate those old pointers.
      const history = tableName === 'board_item_changes' || tableName === 'object_changes';
      for (const fk of history ? [] : getTableConfig(table).foreignKeys) {
        const reference = fk.reference();
        if (reference.columns.length !== 1) continue;
        const column = reference.columns[0];
        const target = getTableConfig(reference.foreignTable).name;
        // A merge marker excludes the old name from the active-name unique index.
        // Preserve it and delete merge descendants before their survivor instead.
        if (tableName === 'entities' && column?.name === 'merged_into_id') continue;
        if (tableName === 'documents' && column?.name === 'folder_id') continue;
        if (tableName === 'folders' && column?.name === 'parent_folder_id') continue;
        if (column && !column.notNull && PURGED_TEAM_TABLES.some((name) => name === target)) {
          await tx.execute(
            sql`UPDATE ${sql.identifier(tableName)} SET ${sql.identifier(column.name)} = NULL WHERE ctid IN (SELECT ctid FROM ${sql.identifier(tableName)} WHERE team_id = ${teamId}::uuid AND ${sql.identifier(column.name)} IS NOT NULL LIMIT 500)`,
          );
        }
      }
      // Keep unlinked nullable references even when a child still prevents deletion.
      const noDependants =
        tableName === 'entities'
          ? sql`AND NOT EXISTS (SELECT 1 FROM entities child WHERE child.merged_into_id = entities.id)`
          : tableName === 'folders'
            ? sql`AND NOT EXISTS (SELECT 1 FROM folders child WHERE child.parent_folder_id = folders.id) AND NOT EXISTS (SELECT 1 FROM documents child WHERE child.folder_id = folders.id)`
            : sql``;
      try {
        const deleted = await tx.transaction((deleteTx) =>
          deleteTx.execute(
            sql`DELETE FROM ${sql.identifier(tableName)} WHERE ctid IN (SELECT ctid FROM ${sql.identifier(tableName)} WHERE team_id = ${teamId}::uuid ${noDependants} LIMIT 500) RETURNING 1`,
          ),
        );
        if (lifecycleRows(deleted).length) remaining = true;
      } catch (error) {
        const code =
          (error as { code?: string; cause?: { code?: string } }).code ??
          (error as { cause?: { code?: string } }).cause?.code;
        if (code !== '23503') throw error;
        remaining = true;
      }
    });
  }
  return !remaining;
}

export async function verifyTeamRows(db: Db, teamId: string) {
  for (const table of PURGED_TEAM_TABLES) {
    const rows = await db.execute(
      sql`SELECT 1 FROM ${sql.identifier(table)} WHERE team_id = ${teamId}::uuid LIMIT 1`,
    );
    if (lifecycleRows(rows).length) throw new Error(`Team cleanup pending: ${table}`);
  }
}
