import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Database contract tests. These protect schema-level invariants that the app
 * and worker tests rely on: migrations boot, tenant rows cascade correctly,
 * partial unique indexes dedupe provider retries, and key enum/default
 * constraints fail before bad state reaches product code.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../drizzle');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ENTITY_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ENTITY_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

async function applyMigrationFile(pg: PGlite, file: string): Promise<void> {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && statement !== 'SELECT 1;');
  for (const statement of statements) await pg.exec(statement);
}

async function applyMigrations(pg: PGlite, opts: { throughFile?: string } = {}): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await applyMigrationFile(pg, file);
    if (opts.throughFile === file) break;
  }
}

async function seedBase(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name, inbound_email)
    VALUES
      ('${TEAM_ID}', 'core-db', 'Core DB', 'core-db@example.test'),
      ('${OTHER_TEAM_ID}', 'other-db', 'Other DB', 'other-db@example.test');
    INSERT INTO users (id, email, name)
    VALUES
      ('${OWNER_ID}', 'owner@example.test', 'Owner'),
      ('${MEMBER_ID}', 'member@example.test', 'Member');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${OWNER_ID}', 'owner');
  `);
}

let pg: PGlite;

beforeEach(async () => {
  pg = new PGlite();
  await applyMigrations(pg);
  await seedBase(pg);
});

afterEach(async () => {
  await pg.close();
});

describe('database schema contracts', () => {
  it('applies every migration to an empty database and exposes critical tables', async () => {
    const tables = await pg.query<{ tablename: string }>(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('teams', 'raw_events', 'entities', 'agent_suggestions')
      ORDER BY tablename
    `);

    expect(tables.rows.map((row) => row.tablename)).toEqual([
      'agent_suggestions',
      'entities',
      'raw_events',
      'teams',
    ]);
  });

  it('migrates pending linked relationship suggestion payloads to related', async () => {
    const migrationPg = new PGlite();
    try {
      await applyMigrations(migrationPg, { throughFile: '0034_boards_2.sql' });
      await seedBase(migrationPg);
      await migrationPg.exec(`
        INSERT INTO agent_suggestions (id, team_id, source, status, title, confidence, dedupe_key)
        VALUES (
          '11111111-1111-4111-8111-111111111113',
          '${TEAM_ID}',
          'background',
          'pending',
          'Remember a relationship',
          'high',
          'linked-proposal'
        );
      `);
      await migrationPg.query(
        `INSERT INTO agent_suggestion_items (
           id,
           suggestion_id,
           team_id,
           status,
           operation,
           target_kind,
           title,
           dedupe_key,
           proposed_payload
         )
         VALUES (
           '11111111-1111-4111-8111-111111111114',
           '11111111-1111-4111-8111-111111111113',
           $1,
           'pending',
           'create',
           'object_relationship',
           'Relate legacy objects',
           'linked-item',
           $2::jsonb
         )`,
        [
          TEAM_ID,
          JSON.stringify({
            fromEntityId: ENTITY_A,
            toEntityId: ENTITY_B,
            kind: 'linked',
          }),
        ],
      );

      await applyMigrationFile(migrationPg, '0036_related_relationships.sql');

      const rows = await migrationPg.query<{ kind: string }>(`
        SELECT proposed_payload ->> 'kind' AS kind
        FROM agent_suggestion_items
        WHERE id = '11111111-1111-4111-8111-111111111114'
      `);
      expect(rows.rows[0]?.kind).toBe('related');
    } finally {
      await migrationPg.close();
    }
  });

  it('migrates native integrations into provider connections and shared resources', async () => {
    const migrationPg = new PGlite();
    try {
      await applyMigrations(migrationPg, { throughFile: '0038_calendar_subscriptions.sql' });
      await seedBase(migrationPg);
      await migrationPg.exec(`
        INSERT INTO integrations (
          id,
          team_id,
          connected_by_user_id,
          provider,
          display_name,
          external_account_id,
          auth_secret_ciphertext,
          auth_secret_iv,
          auth_secret_tag
        )
        VALUES (
          '11111111-1111-4111-8111-111111111115',
          '${TEAM_ID}',
          '${OWNER_ID}',
          'github',
          'GitHub — owner',
          '42',
          decode('00', 'hex'),
          decode('01', 'hex'),
          decode('02', 'hex')
        );
        INSERT INTO integration_selections (
          integration_id,
          selection_kind,
          external_id,
          external_label
        )
        VALUES (
          '11111111-1111-4111-8111-111111111115',
          'github.repo',
          'acme/app',
          'acme/app'
        );
      `);

      await applyMigrationFile(migrationPg, '0039_provider_connections.sql');

      const rows = await migrationPg.query<{
        connection_count: number;
        share_count: number;
        provider_connection_id: string | null;
        resource_share_id: string | null;
      }>(`
        SELECT
          (SELECT count(*)::int FROM provider_connections) AS connection_count,
          (SELECT count(*)::int FROM team_provider_resource_shares) AS share_count,
          (SELECT provider_connection_id::text FROM integrations WHERE id = '11111111-1111-4111-8111-111111111115') AS provider_connection_id,
          (SELECT resource_share_id::text FROM integration_selections WHERE integration_id = '11111111-1111-4111-8111-111111111115') AS resource_share_id
      `);
      const row = rows.rows[0];
      expect(row?.connection_count).toBe(1);
      expect(row?.share_count).toBe(1);
      expect(row?.provider_connection_id).toBeTruthy();
      expect(row?.resource_share_id).toBeTruthy();
    } finally {
      await migrationPg.close();
    }
  });

  it('enforces member, invite, visibility-default, and enum invariants', async () => {
    await expect(
      pg.exec(`INSERT INTO team_members (team_id, user_id, role)
               VALUES ('${TEAM_ID}', '${OWNER_ID}', 'owner')`),
    ).rejects.toThrow();

    await pg.exec(`
      INSERT INTO team_invites (team_id, email, role, token, invited_by_user_id, expires_at)
      VALUES ('${TEAM_ID}', 'new@example.test', 'member', 'tok-1', '${OWNER_ID}', now() + interval '1 day')
    `);
    await expect(
      pg.exec(`INSERT INTO team_invites (team_id, email, role, token, invited_by_user_id, expires_at)
               VALUES ('${OTHER_TEAM_ID}', 'new@example.test', 'member', 'tok-1', '${OWNER_ID}', now() + interval '1 day')`),
    ).rejects.toThrow();

    await pg.exec(`
      INSERT INTO team_visibility_defaults (team_id, source, visibility, updated_by_user_id)
      VALUES ('${TEAM_ID}', 'web', 'private', '${OWNER_ID}')
    `);
    await expect(
      pg.exec(`INSERT INTO team_visibility_defaults (team_id, source, visibility, updated_by_user_id)
               VALUES ('${TEAM_ID}', 'web', 'team', '${OWNER_ID}')`),
    ).rejects.toThrow();
    await expect(
      pg.exec(`INSERT INTO team_visibility_defaults (team_id, source, visibility)
               VALUES ('${TEAM_ID}', 'web', 'workspace')`),
    ).rejects.toThrow();
  });

  it('dedupes provider retries through partial raw-event unique indexes scoped as designed', async () => {
    await pg.query(
      `INSERT INTO raw_events (team_id, author_user_id, source, content_text, source_metadata)
       VALUES ($1, $2, 'telegram', 'hello', $3::jsonb)`,
      [TEAM_ID, OWNER_ID, JSON.stringify({ tg_update_id: 42 })],
    );
    await expect(
      pg.query(
        `INSERT INTO raw_events (team_id, author_user_id, source, content_text, source_metadata)
         VALUES ($1, $2, 'telegram', 'retry', $3::jsonb)`,
        [TEAM_ID, OWNER_ID, JSON.stringify({ tg_update_id: 42 })],
      ),
    ).rejects.toThrow();

    await pg.query(
      `INSERT INTO raw_events (team_id, author_user_id, source, content_text, source_metadata)
       VALUES ($1, $2, 'email', 'email one', $3::jsonb)`,
      [TEAM_ID, OWNER_ID, JSON.stringify({ message_id: 'same-message' })],
    );
    await expect(
      pg.query(
        `INSERT INTO raw_events (team_id, author_user_id, source, content_text, source_metadata)
         VALUES ($1, $2, 'email', 'email retry', $3::jsonb)`,
        [TEAM_ID, OWNER_ID, JSON.stringify({ message_id: 'same-message' })],
      ),
    ).rejects.toThrow();
    await pg.query(
      `INSERT INTO raw_events (team_id, author_user_id, source, content_text, source_metadata)
       VALUES ($1, $2, 'email', 'other team same provider id', $3::jsonb)`,
      [OTHER_TEAM_ID, OWNER_ID, JSON.stringify({ message_id: 'same-message' })],
    );
  });

  it('keeps object names and relationship edges unique only where product logic needs it', async () => {
    await pg.exec(`
      INSERT INTO entities (id, team_id, type, canonical_name)
      VALUES
        ('${ENTITY_A}', '${TEAM_ID}', 'task', 'Prepare proposal'),
        ('${ENTITY_B}', '${TEAM_ID}', 'task', 'Review proposal')
    `);
    await expect(
      pg.exec(`INSERT INTO entities (team_id, type, canonical_name)
               VALUES ('${TEAM_ID}', 'task', 'prepare proposal')`),
    ).rejects.toThrow();
    await pg.exec(`UPDATE entities SET merged_into_id = '${ENTITY_B}' WHERE id = '${ENTITY_A}'`);
    await pg.exec(`INSERT INTO entities (team_id, type, canonical_name)
                   VALUES ('${TEAM_ID}', 'task', 'Prepare proposal')`);

    await pg.exec(`
      INSERT INTO entity_relationships (team_id, from_entity_id, to_entity_id, kind, created_by)
      VALUES ('${TEAM_ID}', '${ENTITY_A}', '${ENTITY_B}', 'related', '${OWNER_ID}')
    `);
    await expect(
      pg.exec(`INSERT INTO entity_relationships (team_id, from_entity_id, to_entity_id, kind, created_by)
               VALUES ('${TEAM_ID}', '${ENTITY_A}', '${ENTITY_B}', 'related', '${OWNER_ID}')`),
    ).rejects.toThrow();
  });

  it('cascades team deletion across source events and pending suggestions', async () => {
    const eventId = '99999999-9999-4999-8999-999999999999';
    const suggestionId = '77777777-7777-4777-8777-777777777777';
    await pg.exec(`
      INSERT INTO raw_events (id, team_id, author_user_id, source, content_text)
      VALUES ('${eventId}', '${TEAM_ID}', '${OWNER_ID}', 'web', 'Need a proposal task');
      INSERT INTO agent_suggestions (id, team_id, source, title, dedupe_key)
      VALUES ('${suggestionId}', '${TEAM_ID}', 'background', 'Proposal task', 'proposal-task');
      INSERT INTO agent_suggestion_items
        (suggestion_id, team_id, operation, target_kind, title, dedupe_key, proposed_payload)
      VALUES
        ('${suggestionId}', '${TEAM_ID}', 'create', 'task', 'Send proposal', 'item-1', '{"canonicalName":"Send proposal"}'::jsonb);
    `);

    await pg.exec(`DELETE FROM teams WHERE id = '${TEAM_ID}'`);
    const remaining = await pg.query<{ raw_count: string; suggestion_count: string }>(`
      SELECT
        (SELECT count(*)::text FROM raw_events WHERE team_id = '${TEAM_ID}') AS raw_count,
        (SELECT count(*)::text FROM agent_suggestions WHERE team_id = '${TEAM_ID}') AS suggestion_count
    `);

    expect(remaining.rows[0]).toEqual({ raw_count: '0', suggestion_count: '0' });
  });

  it('supports superseded approval state and replacement links', async () => {
    const suggestionId = '77777777-7777-4777-8777-777777777701';
    const olderItemId = '88888888-8888-4888-8888-888888888801';
    const newerItemId = '88888888-8888-4888-8888-888888888802';
    await pg.exec(`
      INSERT INTO agent_suggestions (id, team_id, source, status, title, dedupe_key)
      VALUES ('${suggestionId}', '${TEAM_ID}', 'background', 'superseded', 'Proposal task', 'proposal-task-superseded');
      INSERT INTO agent_suggestion_items
        (id, suggestion_id, team_id, status, operation, target_kind, title, dedupe_key, proposed_payload)
      VALUES
        ('${newerItemId}', '${suggestionId}', '${TEAM_ID}', 'pending', 'create', 'task', 'New task', 'item-new', '{"canonicalName":"New task"}'::jsonb),
        ('${olderItemId}', '${suggestionId}', '${TEAM_ID}', 'superseded', 'create', 'task', 'Old task', 'item-old', '{"canonicalName":"Old task"}'::jsonb);
      UPDATE agent_suggestion_items
      SET superseded_by_item_id = '${newerItemId}', superseded_reason = 'newer evidence'
      WHERE id = '${olderItemId}';
    `);

    const rows = await pg.query<{
      status: string;
      superseded_by_item_id: string | null;
      superseded_reason: string | null;
    }>(`
      SELECT status, superseded_by_item_id, superseded_reason
      FROM agent_suggestion_items
      WHERE id = '${olderItemId}'
    `);
    expect(rows.rows[0]).toEqual({
      status: 'superseded',
      superseded_by_item_id: newerItemId,
      superseded_reason: 'newer evidence',
    });
  });
});
