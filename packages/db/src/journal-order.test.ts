import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
/**
 * Drizzle applies a migration only when its journal `when` is greater than the
 * newest `drizzle.__drizzle_migrations.created_at`. It does not match hashes,
 * and it does not revisit a timestamp that is already behind that high-water
 * mark. These tests replay that rule.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../drizzle');
/** origin/main `0077_mcp_health_schedule`, applied by #444. */
const MAIN_LAST_WHEN = 1_795_654_980_000;

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function readJournal(): JournalEntry[] {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return journal.entries;
}

function readSql(tag: string): string {
  return readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8');
}

async function applySql(pg: PGlite, sql: string): Promise<void> {
  const statements = sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && statement !== 'SELECT 1;');
  for (const statement of statements) await pg.exec(statement);
}

async function drizzleMigrate(pg: PGlite, entries: { when: number; sql: string }[]): Promise<void> {
  await pg.exec(`
    CREATE SCHEMA IF NOT EXISTS drizzle;
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `);
  const lastRows = await pg.query<{ created_at: string | number | null }>(
    `SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
  );
  const last = lastRows.rows[0] ? Number(lastRows.rows[0].created_at) : null;
  for (const entry of entries) {
    if (last !== null && !(last < entry.when)) continue;
    await applySql(pg, entry.sql);
    await pg.exec(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('test', ${String(entry.when)})`,
    );
  }
}

async function columnNames(pg: PGlite, table: string): Promise<string[]> {
  const rows = await pg.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return rows.rows.map((row) => row.column_name);
}

describe('drizzle journal order', () => {
  it('keeps billing timestamps strictly after main and after replay corrections', () => {
    const entries = readJournal();
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      expect(current?.when, `${current?.tag} after ${previous?.tag}`).toBeGreaterThan(
        previous?.when ?? 0,
      );
    }
    expect(entries[73]).toMatchObject({
      idx: 73,
      when: 1_795_654_740_000,
      tag: '0073_legal_acceptance_history',
    });
    expect(entries[74]).toMatchObject({
      idx: 74,
      when: 1_795_654_800_000,
      tag: '0074_recall_join_metadata_minimization',
    });
    expect(entries[75]).toMatchObject({
      idx: 75,
      when: 1_795_654_860_000,
      tag: '0075_mcp_oauth_server',
    });
    expect(entries[76]).toMatchObject({
      idx: 76,
      when: 1_795_654_920_000,
      tag: '0076_integration_health_pause',
    });
    expect(entries[77]).toMatchObject({
      idx: 77,
      when: MAIN_LAST_WHEN,
      tag: '0077_mcp_health_schedule',
    });
    expect(entries[78]).toMatchObject({
      idx: 78,
      tag: '0073_billing_foundation',
    });
    expect(
      entries.some((entry) => entry.tag.startsWith('0083_') || entry.tag.startsWith('0084_')),
    ).toBe(false);
    const foundationIndex = entries.findIndex((entry) => entry.tag === '0073_billing_foundation');
    const freeGrantIndex = entries.findIndex(
      (entry) => entry.tag === '0075_billing_free_grant_backfill',
    );
    expect(foundationIndex).toBeGreaterThan(77);
    expect(freeGrantIndex).toBeGreaterThan(foundationIndex);

    const byTag = new Map(entries.map((entry) => [entry.tag, entry.when]));
    const mainBoundary = MAIN_LAST_WHEN;
    for (const tag of [
      '0073_billing_foundation',
      '0074_billing_usage_alert_intent',
      '0075_billing_free_grant_backfill',
      '0078_billing_operator_controls',
      '0079_billing_unbilled_alerts',
      '0080_billing_replay_corrections',
      '0082_billing_enterprise_platform_fee',
      '0085_billing_cancel_effective_at',
      '0086_billing_plan_history_baseline',
      '0087_billing_cap_eligible_spend',
      '0088_billing_reservation_admitted_plan',
    ]) {
      expect(byTag.get(tag), tag).toBeGreaterThan(mainBoundary);
    }
    const replay = byTag.get('0080_billing_replay_corrections') ?? 0;
    expect(byTag.get('0078_billing_operator_controls')).toBeGreaterThan(replay);
    expect(byTag.get('0079_billing_unbilled_alerts')).toBeGreaterThan(
      byTag.get('0078_billing_operator_controls') ?? 0,
    );
    expect(byTag.get('0082_billing_enterprise_platform_fee')).toBeGreaterThan(
      byTag.get('0079_billing_unbilled_alerts') ?? 0,
    );
  });

  it('applies billing migrations on a database already migrated to main', async () => {
    const pg = new PGlite();
    try {
      const entries = readJournal();
      const shared = entries.filter((entry) => entry.when <= MAIN_LAST_WHEN);
      expect(shared.at(-2)?.tag).toBe('0076_integration_health_pause');
      expect(shared.at(-1)?.tag).toBe('0077_mcp_health_schedule');
      await drizzleMigrate(
        pg,
        shared.map((entry) => ({ when: entry.when, sql: readSql(entry.tag) })),
      );
      expect(await columnNames(pg, 'team_billing_accounts')).toEqual([]);
      expect(await columnNames(pg, 'billing_free_grants')).toEqual([]);
      expect(await columnNames(pg, 'legal_acceptances')).toContain('source');
      expect(await columnNames(pg, 'mcp_servers')).toContain('next_health_check_at');
      expect(await columnNames(pg, 'mcp_servers')).toContain('health_failures');

      await drizzleMigrate(
        pg,
        entries.map((entry) => ({ when: entry.when, sql: readSql(entry.tag) })),
      );
      const billing = await columnNames(pg, 'team_billing_accounts');
      expect(billing).toContain('price_override');
      expect(billing).toContain('enterprise_platform_fee_cents');
      expect(billing).toContain('cancel_effective_at');
      expect(await columnNames(pg, 'billing_free_grants')).toContain('user_id');
      expect(await columnNames(pg, 'billing_usage_counters')).toContain(
        'cap_eligible_charge_cents',
      );
      expect(await columnNames(pg, 'billing_usage_reservations')).toContain('admitted_plan_id');
      expect(await columnNames(pg, 'legal_acceptances')).toContain('terms_version');
      const tables = await pg.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'billing_plan_history'`,
      );
      expect(tables.rows).toEqual([{ tablename: 'billing_plan_history' }]);
    } finally {
      await pg.close();
    }
  });

  it('adds MCP health columns to an already migrated billing-branch database', async () => {
    const pg = new PGlite();
    try {
      const entries = readJournal();
      const beforeMerge = entries.filter(
        (entry) => entry.tag !== '0077_mcp_health_schedule' && entry.when <= 1_795_655_800_000,
      );
      await drizzleMigrate(
        pg,
        beforeMerge.map((entry) => ({ when: entry.when, sql: readSql(entry.tag) })),
      );
      expect(await columnNames(pg, 'mcp_servers')).not.toContain('next_health_check_at');
      expect(await columnNames(pg, 'team_billing_accounts')).toContain('price_override');

      await drizzleMigrate(
        pg,
        entries.map((entry) => ({ when: entry.when, sql: readSql(entry.tag) })),
      );
      expect(await columnNames(pg, 'mcp_servers')).toContain('next_health_check_at');
      expect(await columnNames(pg, 'mcp_servers')).toContain('health_failures');
      expect(await columnNames(pg, 'team_billing_accounts')).toContain('price_override');
    } finally {
      await pg.close();
    }
  });

  it('applies operator controls after replay corrections were already stored', async () => {
    const pg = new PGlite();
    try {
      const entries = readJournal();
      const replayIndex = entries.findIndex(
        (entry) => entry.tag === '0080_billing_replay_corrections',
      );
      const walletBeforeOperator = entries
        .slice(0, replayIndex + 1)
        .map((entry) => ({ when: entry.when, sql: readSql(entry.tag) }));
      await drizzleMigrate(pg, walletBeforeOperator);
      expect(await columnNames(pg, 'team_billing_accounts')).not.toContain('price_override');

      await drizzleMigrate(
        pg,
        entries.map((entry) => ({ when: entry.when, sql: readSql(entry.tag) })),
      );
      const billing = await columnNames(pg, 'team_billing_accounts');
      expect(billing).toContain('price_override');
      expect(billing).toContain('enterprise_platform_fee_cents');
      expect(billing).toContain('pending_enterprise_terms');
    } finally {
      await pg.close();
    }
  });
});
