/* eslint-disable no-console -- operational status output during worker startup */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const silenceNotices = (): void => undefined;

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

interface WaitForMigrationsOptions {
  url?: string;
  /** Total time to wait before giving up. Default 5 minutes. */
  timeoutMs?: number;
  /** Time between polls. Default 2 seconds. */
  intervalMs?: number;
  /** Override the journal path (mostly for tests). */
  journalPath?: string;
}

/**
 * Block until the running database has applied at least as many migrations as
 * the journal bundled with this image expects. Workers should call this at
 * startup so they don't race the web service's preDeployCommand on Railway.
 *
 * The check is intentionally count-based (not hash-based): drizzle's migration
 * table stores SHA-256 hashes of the SQL files at apply-time, which means a
 * worker built from commit X cannot reliably re-derive those hashes to
 * cross-check. Counting catches the common race (worker boots before
 * migrations run) without trying to be a general consistency oracle.
 */
export async function waitForMigrations(options: WaitForMigrationsOptions = {}): Promise<void> {
  const url = options.url ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const here = dirname(fileURLToPath(import.meta.url));
  const journalPath = options.journalPath ?? resolve(here, '../drizzle/meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
  const expected = journal.entries.length;

  if (expected === 0) {
    console.log('[db] journal has no migrations, skipping wait');
    return;
  }

  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  const client = postgres(url, { max: 1, onnotice: silenceNotices });
  let applied = 0;
  try {
    for (;;) {
      try {
        const rows = await client<{ count: string }[]>`
          SELECT COUNT(*)::text AS count FROM drizzle.__drizzle_migrations
        `;
        applied = Number(rows[0]?.count ?? 0);
      } catch (err: unknown) {
        // 42P01 = undefined_table. Means the migrate script hasn't run yet
        // even once; keep waiting. Any other error is real, surface it.
        const code = (err as { code?: string } | null)?.code;
        if (code !== '42P01') throw err;
        console.log('[db] migrations table not yet created, waiting…');
      }

      if (applied >= expected) {
        console.log(`[db] migrations ready (${applied}/${expected} applied)`);
        return;
      }

      if (applied > 0) {
        console.log(`[db] waiting for migrations: ${applied}/${expected} applied`);
      }

      if (Date.now() > deadline) {
        throw new Error(
          `[db] timed out waiting for migrations after ${timeoutMs}ms (${applied}/${expected} applied)`,
        );
      }
      await new Promise<void>((r) => setTimeout(r, intervalMs));
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}
