import { PGlite } from '@electric-sql/pglite';
import { type Db, entities } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import {
  enqueueByUpdatedAt,
  listReembedEntitiesPage,
  PAGE_SIZE,
} from '#src/scripts/reembed-pages.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const teamId = '11111111-1111-4111-8111-111111111111';
const otherTeamId = '22222222-2222-4222-8222-222222222222';
const rowId = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

// Object and entity embedding must traverse the same active team rows without losing timestamp ties.
describe('reembed candidate pages', () => {
  it('pages tied timestamps and excludes merged and foreign-team entities', async () => {
    const pg = new PGlite();
    try {
      await applyDbMigrations(pg);
      await pg.exec(`INSERT INTO teams (id, slug, name) VALUES
        ('${teamId}', 'reembed', 'Reembed'), ('${otherTeamId}', 'other-reembed', 'Other')`);
      const db = drizzle(pg) as unknown as Db;
      const updatedAt = new Date('2026-07-01T00:00:00Z');
      await db.insert(entities).values(
        Array.from({ length: PAGE_SIZE + 1 }, (_, n) => ({
          id: rowId(n),
          teamId,
          type: 'other' as const,
          canonicalName: `Entity ${n}`,
          updatedAt,
        })),
      );
      await db.insert(entities).values([
        {
          id: rowId(PAGE_SIZE + 1),
          teamId,
          type: 'other',
          canonicalName: 'Merged',
          mergedIntoId: rowId(0),
          updatedAt,
        },
        {
          id: rowId(PAGE_SIZE + 2),
          teamId: otherTeamId,
          type: 'other',
          canonicalName: 'Other team',
          updatedAt,
        },
      ]);
      const first = await listReembedEntitiesPage(db, teamId, null);
      expect(first).toHaveLength(PAGE_SIZE);
      const second = await listReembedEntitiesPage(db, teamId, first.at(-1)!);
      expect(second.map((row) => row.id)).toEqual([rowId(PAGE_SIZE)]);
      expect(await listReembedEntitiesPage(db, teamId, second[0]!)).toEqual([]);
    } finally {
      await pg.close();
    }
  });

  it('honors the remaining global budget and dry-run without enqueuing', async () => {
    const enqueued: string[] = [];
    const rows = Array.from({ length: PAGE_SIZE }, (_, n) => ({
      id: rowId(n),
      updatedAt: new Date('2026-07-01T00:00:00Z'),
    }));
    const input = {
      budget: 2,
      dryRun: true,
      fetchPage: () => Promise.resolve(rows),
      enqueueRow: (id: string) => {
        enqueued.push(id);
        return Promise.resolve();
      },
    };
    expect(await enqueueByUpdatedAt(input)).toEqual({ scanned: 2, enqueued: 2 });
    expect(enqueued).toEqual([]);
    expect(await enqueueByUpdatedAt({ ...input, dryRun: false })).toEqual({
      scanned: 2,
      enqueued: 2,
    });
    expect(enqueued).toEqual([rowId(0), rowId(1)]);
    expect(
      await enqueueByUpdatedAt({
        ...input,
        budget: 0,
        fetchPage: () => Promise.reject(new Error('budget exhausted')),
      }),
    ).toEqual({ scanned: 0, enqueued: 0 });
  });
});
