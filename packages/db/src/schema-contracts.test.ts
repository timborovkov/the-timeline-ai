import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { entities } from '#src/schema/entities.js';

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
const LEGACY_EVENT_ID = '99999999-9999-4999-8999-999999999999';
const LEGACY_ENTITY_ID = '99999999-9999-4999-8999-999999999991';
const LEGACY_BOARD_ID = '99999999-9999-4999-8999-999999999992';
const LEGACY_BOARD_ITEM_ID = '99999999-9999-4999-8999-999999999993';

function schemaIndexPredicate(name: string): string {
  const index = getTableConfig(entities).indexes.find(
    (candidate) => candidate.config.name === name,
  );
  if (!index?.config.where) throw new Error(`Missing predicate for ${name}`);
  return new PgDialect().sqlToQuery(index.config.where).sql.replace(/\s+/g, ' ').trim();
}

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
        AND tablename IN (
          'teams',
          'raw_events',
          'entities',
          'agent_suggestions',
          'reconciliation_evidence',
          'artifact_evidence_associations',
          'reconciliation_outputs',
          'reconciliation_projection_outbox',
          'monday_conversation_tombstones',
          'monday_conversation_tombstone_invalidations',
          'task_category_filter_versions',
          'task_category_project_invalidations',
          'task_project_source_locks',
          'user_pins'
        )
      ORDER BY tablename
    `);

    expect(tables.rows.map((row) => row.tablename)).toEqual([
      'agent_suggestions',
      'artifact_evidence_associations',
      'entities',
      'monday_conversation_tombstone_invalidations',
      'monday_conversation_tombstones',
      'raw_events',
      'reconciliation_evidence',
      'reconciliation_outputs',
      'reconciliation_projection_outbox',
      'task_category_filter_versions',
      'task_category_project_invalidations',
      'task_project_source_locks',
      'teams',
      'user_pins',
    ]);
  });

  it('backfills canonical shared-link associations at their current strengths', async () => {
    const migrationPg = new PGlite();
    try {
      await applyMigrations(migrationPg, {
        throughFile: '0066_monday_conversation_tombstones.sql',
      });
      await seedBase(migrationPg);
      const rawEventId = '99999999-9999-4999-8999-999999999940';
      const clusterId = '99999999-9999-4999-8999-999999999941';
      const convertedEvidenceId = '99999999-9999-4999-8999-999999999942';
      const deduplicatedEvidenceId = '99999999-9999-4999-8999-999999999943';
      const providerConvertedEvidenceId = '99999999-9999-4999-8999-999999999944';
      const providerDeduplicatedEvidenceId = '99999999-9999-4999-8999-999999999945';
      await migrationPg.exec(`
        INSERT INTO raw_events (id, team_id, author_user_id, source, content_text)
        VALUES ('${rawEventId}', '${TEAM_ID}', '${OWNER_ID}', 'web', 'Shared canonical link');

        INSERT INTO artifact_clusters
          (id, team_id, artifact_cluster_kind, artifact_type, canonical_name, status)
        VALUES
          ('${clusterId}', '${TEAM_ID}', 'document', 'document', 'Shared launch brief', 'active');

        INSERT INTO reconciliation_evidence
          (id, team_id, raw_event_id, source, event_type, occurred_at, content_digest, normalizer_version, dedupe_key)
        VALUES
          ('${convertedEvidenceId}', '${TEAM_ID}', '${rawEventId}', 'web', 'shared_link', now(), 'converted', 'v1', 'converted-evidence'),
          ('${deduplicatedEvidenceId}', '${TEAM_ID}', '${rawEventId}', 'web', 'shared_link', now(), 'deduplicated', 'v1', 'deduplicated-evidence'),
          ('${providerConvertedEvidenceId}', '${TEAM_ID}', '${rawEventId}', 'web', 'shared_link', now(), 'provider-converted', 'v1', 'provider-converted-evidence'),
          ('${providerDeduplicatedEvidenceId}', '${TEAM_ID}', '${rawEventId}', 'web', 'shared_link', now(), 'provider-deduplicated', 'v1', 'provider-deduplicated-evidence');

        INSERT INTO artifact_evidence_associations
          (team_id, cluster_id, evidence_id, raw_event_id, role, strength, association_source, metadata, dedupe_key)
        VALUES
          ('${TEAM_ID}', '${clusterId}', '${convertedEvidenceId}', '${rawEventId}', 'related_context', 'semantic', 'model_candidate', '{"source_kind":"shared_link","canonical_url":"https://example.test/brief"}'::jsonb, 'legacy-converted'),
          ('${TEAM_ID}', '${clusterId}', '${deduplicatedEvidenceId}', '${rawEventId}', 'related_context', 'semantic', 'model_candidate', '{"source_kind":"shared_link","canonical_url":"https://example.test/brief"}'::jsonb, 'legacy-duplicate'),
          ('${TEAM_ID}', '${clusterId}', '${deduplicatedEvidenceId}', '${rawEventId}', 'related_context', 'hard', 'hard_anchor', '{"source_kind":"shared_link","canonical_url":"https://example.test/brief"}'::jsonb, 'canonical-existing'),
          ('${TEAM_ID}', '${clusterId}', '${providerConvertedEvidenceId}', '${rawEventId}', 'related_context', 'semantic', 'model_candidate', '{"source_kind":"shared_link","canonical_url":"https://github.com/timborovkov/the-timeline-ai/pull/338","provider_object_id":"timborovkov/the-timeline-ai#338"}'::jsonb, 'legacy-provider-converted'),
          ('${TEAM_ID}', '${clusterId}', '${providerDeduplicatedEvidenceId}', '${rawEventId}', 'related_context', 'semantic', 'model_candidate', '{"source_kind":"shared_link","canonical_url":"https://github.com/timborovkov/the-timeline-ai/pull/338","provider_object_id":"timborovkov/the-timeline-ai#338"}'::jsonb, 'legacy-provider-duplicate'),
          ('${TEAM_ID}', '${clusterId}', '${providerDeduplicatedEvidenceId}', '${rawEventId}', 'related_context', 'structured', 'structured_anchor', '{"source_kind":"shared_link","canonical_url":"https://github.com/timborovkov/the-timeline-ai/pull/338","provider_object_id":"timborovkov/the-timeline-ai#338"}'::jsonb, 'canonical-provider-existing');
      `);

      await applyMigrationFile(migrationPg, '0067_canonical_link_evidence_strength.sql');

      const associations = await migrationPg.query<{
        evidence_id: string;
        strength: string;
        association_source: string;
      }>(`
        SELECT evidence_id, strength::text, association_source::text
        FROM artifact_evidence_associations
        WHERE cluster_id = '${clusterId}'
        ORDER BY evidence_id
      `);
      expect(associations.rows).toEqual([
        {
          evidence_id: convertedEvidenceId,
          strength: 'hard',
          association_source: 'hard_anchor',
        },
        {
          evidence_id: deduplicatedEvidenceId,
          strength: 'hard',
          association_source: 'hard_anchor',
        },
        {
          evidence_id: providerConvertedEvidenceId,
          strength: 'structured',
          association_source: 'structured_anchor',
        },
        {
          evidence_id: providerDeduplicatedEvidenceId,
          strength: 'structured',
          association_source: 'structured_anchor',
        },
      ]);
    } finally {
      await migrationPg.close();
    }
  });

  it('backfills legacy board and object pins into one ordered personal collection', async () => {
    const migrationPg = new PGlite();
    try {
      await applyMigrations(migrationPg, { throughFile: '0061_object_pins.sql' });
      await seedBase(migrationPg);
      const firstBoard = '11111111-1111-4111-8111-111111111131';
      const secondBoard = '11111111-1111-4111-8111-111111111132';
      const objectId = '11111111-1111-4111-8111-111111111133';
      await migrationPg.exec(`
        INSERT INTO boards (id, team_id, created_by, name)
        VALUES
          ('${firstBoard}', '${TEAM_ID}', '${OWNER_ID}', 'First board'),
          ('${secondBoard}', '${TEAM_ID}', '${OWNER_ID}', 'Second board');
        INSERT INTO entities (id, team_id, type, canonical_name)
        VALUES ('${objectId}', '${TEAM_ID}', 'project', 'Pinned project');
        INSERT INTO board_pins (team_id, user_id, board_id, position, created_at)
        VALUES
          ('${TEAM_ID}', '${OWNER_ID}', '${secondBoard}', 20, '2026-07-20T10:02:00Z'),
          ('${TEAM_ID}', '${OWNER_ID}', '${firstBoard}', 10, '2026-07-20T10:01:00Z');
        INSERT INTO object_pins (team_id, user_id, entity_id, position, created_at)
        VALUES ('${TEAM_ID}', '${OWNER_ID}', '${objectId}', 0, '2026-07-20T10:03:00Z');
      `);

      await applyMigrationFile(migrationPg, '0062_universal_personal_pins.sql');

      const rows = await migrationPg.query<{
        target_kind: string;
        target_key: string;
        sort_key: string;
      }>(`
        SELECT target_kind::text, target_key, sort_key::text
        FROM user_pins
        WHERE team_id = '${TEAM_ID}' AND user_id = '${OWNER_ID}'
        ORDER BY sort_key, id
      `);
      expect(rows.rows).toEqual([
        { target_kind: 'board', target_key: firstBoard, sort_key: '0' },
        { target_kind: 'board', target_key: secondBoard, sort_key: '1024' },
        { target_kind: 'object', target_key: objectId, sort_key: '2048' },
      ]);

      await migrationPg.exec(`DELETE FROM entities WHERE id = '${objectId}'`);
      const remainingObjectPins = await migrationPg.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM user_pins
        WHERE target_kind = 'object' AND target_key = '${objectId}'
      `);
      expect(remainingObjectPins.rows[0]?.count).toBe('0');
    } finally {
      await migrationPg.close();
    }
  });

  it('indexes the global pending task-category recovery sweep', async () => {
    const indexes = await pg.query<{ indexdef: string }>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'entities_task_category_pending_recovery_idx'
    `);

    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0]?.indexdef).toContain('(id, task_category_updated_at)');
    expect(indexes.rows[0]?.indexdef).toContain("task_category_status = 'pending'");
    expect(indexes.rows[0]?.indexdef).not.toContain('"type"');
    expect(schemaIndexPredicate('entities_task_category_pending_recovery_idx')).toBe(
      `"entities"."task_category_mode" = 'automatic' AND "entities"."task_category_status" = 'pending' AND "entities"."task_category_requested_input_hash" IS NOT NULL AND "entities"."archived_at" IS NULL AND "entities"."merged_into_id" IS NULL`,
    );
  });

  it('indexes team-scoped pending category filter refresh checks', async () => {
    const indexes = await pg.query<{ indexdef: string }>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'entities_team_task_category_pending_idx'
    `);

    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0]?.indexdef).toContain('(team_id, id)');
    expect(indexes.rows[0]?.indexdef).toContain("task_category_status = 'pending'");
    expect(indexes.rows[0]?.indexdef).not.toContain('"type"');
    expect(schemaIndexPredicate('entities_team_task_category_pending_idx')).toBe(
      `"entities"."task_category_status" = 'pending' AND "entities"."archived_at" IS NULL AND "entities"."merged_into_id" IS NULL`,
    );
  });

  it('locks category filter version rows in deterministic order', async () => {
    const functions = await pg.query<{ definition: string }>(`
      SELECT pg_get_functiondef(oid) AS definition
      FROM pg_proc
      WHERE proname = 'bump_task_category_filter_versions'
    `);

    expect(functions.rows).toHaveLength(1);
    expect(functions.rows[0]?.definition).toMatch(
      /ORDER BY version_key\."team_id", version_key\."category"/,
    );
  });

  it('serializes task-project relationship and type-promotion decisions', async () => {
    const functions = await pg.query<{ proname: string; definition: string }>(`
      SELECT proname, pg_get_functiondef(oid) AS definition
      FROM pg_proc
      WHERE proname IN (
        'canonicalize_task_project_relationship',
        'guard_task_project_type_promotion',
        'lock_task_project_source'
      )
      ORDER BY proname
    `);

    expect(functions.rows).toHaveLength(3);
    const canonicalize = functions.rows.find(
      (row) => row.proname === 'canonicalize_task_project_relationship',
    )?.definition;
    const promotion = functions.rows.find(
      (row) => row.proname === 'guard_task_project_type_promotion',
    )?.definition;
    const sourceLock = functions.rows.find(
      (row) => row.proname === 'lock_task_project_source',
    )?.definition;
    expect(canonicalize).toContain('FOR UPDATE');
    expect(canonicalize?.match(/FOR UPDATE/g)).toHaveLength(2);
    expect(canonicalize).toContain('lock_task_project_source');
    expect(promotion).toContain('lock_task_project_source');
    expect(sourceLock).not.toContain('INSERT INTO');
  });

  it('canonicalizes legacy inverse task-project relationships', async () => {
    const migrationPg = new PGlite();
    try {
      await applyMigrations(migrationPg, { throughFile: '0059_saved_meeting_alias_cleanup.sql' });
      await seedBase(migrationPg);
      await migrationPg.exec(`
        INSERT INTO entities (id, team_id, type, canonical_name) VALUES
          ('10000000-0000-4000-8000-000000000001', '${TEAM_ID}', 'project', 'Inverse project'),
          ('10000000-0000-4000-8000-000000000002', '${TEAM_ID}', 'task', 'Inverse task'),
          ('10000000-0000-4000-8000-000000000003', '${TEAM_ID}', 'project', 'Duplicate project'),
          ('10000000-0000-4000-8000-000000000004', '${TEAM_ID}', 'task', 'Duplicate task');

        INSERT INTO entity_relationships (team_id, from_entity_id, to_entity_id, kind) VALUES
          ('${TEAM_ID}', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'parent'),
          ('${TEAM_ID}', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'parent'),
          ('${TEAM_ID}', '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'child');
      `);

      await applyMigrationFile(migrationPg, '0060_task_categories.sql');

      const relationships = await migrationPg.query<{
        from_entity_id: string;
        to_entity_id: string;
        kind: string;
      }>(`
        SELECT from_entity_id, to_entity_id, kind
        FROM entity_relationships
        WHERE team_id = '${TEAM_ID}'
        ORDER BY from_entity_id
      `);
      expect(relationships.rows).toEqual([
        {
          from_entity_id: '10000000-0000-4000-8000-000000000002',
          to_entity_id: '10000000-0000-4000-8000-000000000001',
          kind: 'child',
        },
        {
          from_entity_id: '10000000-0000-4000-8000-000000000004',
          to_entity_id: '10000000-0000-4000-8000-000000000003',
          kind: 'child',
        },
      ]);

      await migrationPg.exec(`
        INSERT INTO entities (id, team_id, type, canonical_name) VALUES
          ('10000000-0000-4000-8000-000000000005', '${TEAM_ID}', 'project', 'Rolling project'),
          ('10000000-0000-4000-8000-000000000006', '${TEAM_ID}', 'task', 'Rolling task');

        INSERT INTO entity_relationships (team_id, from_entity_id, to_entity_id, kind)
        VALUES (
          '${TEAM_ID}',
          '10000000-0000-4000-8000-000000000005',
          '10000000-0000-4000-8000-000000000006',
          'parent'
        );
      `);
      const rollingRelationship = await migrationPg.query<{
        from_entity_id: string;
        to_entity_id: string;
        kind: string;
      }>(`
        SELECT from_entity_id, to_entity_id, kind
        FROM entity_relationships
        WHERE team_id = '${TEAM_ID}'
          AND (
            from_entity_id = '10000000-0000-4000-8000-000000000006'
            OR to_entity_id = '10000000-0000-4000-8000-000000000006'
          )
      `);
      expect(rollingRelationship.rows).toEqual([
        {
          from_entity_id: '10000000-0000-4000-8000-000000000006',
          to_entity_id: '10000000-0000-4000-8000-000000000005',
          kind: 'child',
        },
      ]);

      await migrationPg.exec(`
        INSERT INTO entity_relationships (team_id, from_entity_id, to_entity_id, kind)
        VALUES (
          '${TEAM_ID}',
          '10000000-0000-4000-8000-000000000006',
          '10000000-0000-4000-8000-000000000005',
          'child'
        )
        ON CONFLICT DO NOTHING;
      `);

      await migrationPg.exec(`
        INSERT INTO entities (id, team_id, type, canonical_name)
        VALUES (
          '10000000-0000-4000-8000-000000000007',
          '${TEAM_ID}',
          'project',
          'Second rolling project'
        );
      `);
      await expect(
        migrationPg.exec(`
          INSERT INTO entity_relationships (team_id, from_entity_id, to_entity_id, kind)
          VALUES (
            '${TEAM_ID}',
            '10000000-0000-4000-8000-000000000006',
            '10000000-0000-4000-8000-000000000007',
            'child'
          );
        `),
      ).rejects.toThrow('Task already has a primary project');

      await migrationPg.exec(`
        INSERT INTO entities (id, team_id, type, canonical_name)
        VALUES (
          '10000000-0000-4000-8000-000000000008',
          '${TEAM_ID}',
          'company',
          'Promoted relationship target'
        );
        INSERT INTO entity_relationships (team_id, from_entity_id, to_entity_id, kind)
        VALUES (
          '${TEAM_ID}',
          '10000000-0000-4000-8000-000000000006',
          '10000000-0000-4000-8000-000000000008',
          'child'
        );
      `);
      await expect(
        migrationPg.exec(`
          UPDATE entities
          SET type = 'project'
          WHERE id = '10000000-0000-4000-8000-000000000008';
        `),
      ).rejects.toThrow('would give a task multiple primary projects');

      await migrationPg.exec(`
        INSERT INTO entities (id, team_id, type, canonical_name) VALUES
          ('10000000-0000-4000-8000-000000000009', '${TEAM_ID}', 'company', 'Promoted task source'),
          ('10000000-0000-4000-8000-000000000010', '${TEAM_ID}', 'project', 'Source project one'),
          ('10000000-0000-4000-8000-000000000011', '${TEAM_ID}', 'project', 'Source project two');
        INSERT INTO entity_relationships (team_id, from_entity_id, to_entity_id, kind) VALUES
          ('${TEAM_ID}', '10000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000010', 'child'),
          ('${TEAM_ID}', '10000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000011', 'child');
      `);
      await expect(
        migrationPg.exec(`
          UPDATE entities
          SET type = 'task'
          WHERE id = '10000000-0000-4000-8000-000000000009';
        `),
      ).rejects.toThrow('would give it multiple primary projects');
    } finally {
      await migrationPg.close();
    }
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

      await applyMigrationFile(migrationPg, '0039_saved_meetings.sql');
      await applyMigrationFile(migrationPg, '0040_messaging.sql');
      await applyMigrationFile(migrationPg, '0041_provider_connections.sql');

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

  it('creates webhook gateway tables with delivery and target dedupe constraints', async () => {
    await pg.exec(`
      INSERT INTO provider_connections (
        id,
        owner_user_id,
        provider,
        display_name,
        external_account_id,
        auth_secret_ciphertext,
        auth_secret_iv,
        auth_secret_tag
      )
      VALUES (
        '11111111-1111-4111-8111-111111111120',
        '${OWNER_ID}',
        'linear',
        'Linear — Core DB',
        'org-1',
        decode('00', 'hex'),
        decode('01', 'hex'),
        decode('02', 'hex')
      );
      INSERT INTO integrations (
        id,
        team_id,
        connected_by_user_id,
        provider_connection_id,
        provider,
        display_name,
        external_account_id
      )
      VALUES (
        '11111111-1111-4111-8111-111111111121',
        '${TEAM_ID}',
        '${OWNER_ID}',
        '11111111-1111-4111-8111-111111111120',
        'linear',
        'Linear — Core DB',
        'org-1'
      );
      INSERT INTO integration_webhook_deliveries (
        id,
        provider,
        external_delivery_id,
        external_account_id,
        resource_kind,
        external_resource_id,
        event_type,
        payload,
        dedup_key
      )
      VALUES (
        '11111111-1111-4111-8111-111111111122',
        'linear',
        'delivery-1',
        'org-1',
        'linear.team',
        'team-linear-1',
        'Issue',
        '{"type":"Issue"}'::jsonb,
        'linear:delivery:delivery-1'
      );
      INSERT INTO integration_webhook_delivery_targets (
        delivery_id,
        team_id,
        integration_id,
        provider_connection_id
      )
      VALUES (
        '11111111-1111-4111-8111-111111111122',
        '${TEAM_ID}',
        '11111111-1111-4111-8111-111111111121',
        '11111111-1111-4111-8111-111111111120'
      );
      INSERT INTO integration_webhook_subscriptions (
        integration_id,
        provider_connection_id,
        provider,
        external_subscription_id,
        resource_kind,
        external_resource_id,
        event_type
      )
      VALUES (
        '11111111-1111-4111-8111-111111111121',
        '11111111-1111-4111-8111-111111111120',
        'linear',
        'sub-1',
        'linear.team',
        'team-linear-1',
        'Issue'
      );
      INSERT INTO integration_provider_budgets (
        provider,
        app_key,
        external_account_id,
        scope,
        remaining,
        "limit"
      )
      VALUES ('linear', 'linear-client', 'org-1', 'requests', 99, 100);
      INSERT INTO connection_attention (
        team_id,
        provider_connection_id,
        integration_id,
        category,
        summary
      )
      VALUES (
        '${TEAM_ID}',
        '11111111-1111-4111-8111-111111111120',
        '11111111-1111-4111-8111-111111111121',
        'webhook_degraded',
        'Webhook provisioning failed, reconciliation remains active.'
      );
    `);

    await expect(
      pg.exec(`
        INSERT INTO integration_webhook_deliveries (
          provider,
          event_type,
          payload,
          dedup_key
        )
        VALUES ('linear', 'Issue', '{}'::jsonb, 'linear:delivery:delivery-1')
      `),
    ).rejects.toThrow();

    await expect(
      pg.exec(`
        INSERT INTO integration_webhook_delivery_targets (
          delivery_id,
          team_id,
          integration_id
        )
        VALUES (
          '11111111-1111-4111-8111-111111111122',
          '${TEAM_ID}',
          '11111111-1111-4111-8111-111111111121'
        )
      `),
    ).rejects.toThrow();

    const rows = await pg.query<{
      delivery_count: number;
      target_count: number;
      subscription_count: number;
      budget_count: number;
      attention_count: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM integration_webhook_deliveries) AS delivery_count,
        (SELECT count(*)::int FROM integration_webhook_delivery_targets) AS target_count,
        (SELECT count(*)::int FROM integration_webhook_subscriptions) AS subscription_count,
        (SELECT count(*)::int FROM integration_provider_budgets) AS budget_count,
        (SELECT count(*)::int FROM connection_attention WHERE category = 'webhook_degraded') AS attention_count
    `);
    expect(rows.rows[0]).toEqual({
      delivery_count: 1,
      target_count: 1,
      subscription_count: 1,
      budget_count: 1,
      attention_count: 1,
    });
  });

  it('formally deprecates legacy object provenance columns without blocking historical rows', async () => {
    const migrationPg = new PGlite();
    try {
      await applyMigrations(migrationPg, { throughFile: '0055_reconciliation_foundation.sql' });
      await seedBase(migrationPg);
      await migrationPg.exec(`
        INSERT INTO raw_events (id, team_id, author_user_id, source, content_text)
        VALUES ('${LEGACY_EVENT_ID}', '${TEAM_ID}', '${OWNER_ID}', 'system', 'legacy provenance event');

        INSERT INTO entities (
          id,
          team_id,
          type,
          canonical_name,
          source_event_id,
          agent_suggested
        )
        VALUES (
          '${LEGACY_ENTITY_ID}',
          '${TEAM_ID}',
          'task',
          'Legacy provenance task',
          '${LEGACY_EVENT_ID}',
          true
        );

        INSERT INTO object_changes (
          team_id,
          entity_id,
          actor_kind,
          status,
          field,
          new_value,
          source_event_id
        )
        VALUES (
          '${TEAM_ID}',
          '${LEGACY_ENTITY_ID}',
          'agent',
          'suggested',
          'status',
          '"open"'::jsonb,
          '${LEGACY_EVENT_ID}'
        );

        INSERT INTO boards (id, team_id, created_by, name)
        VALUES ('${LEGACY_BOARD_ID}', '${TEAM_ID}', '${OWNER_ID}', 'Legacy board');

        INSERT INTO board_items (id, team_id, board_id, entity_id)
        VALUES (
          '${LEGACY_BOARD_ITEM_ID}',
          '${TEAM_ID}',
          '${LEGACY_BOARD_ID}',
          '${LEGACY_ENTITY_ID}'
        );

        INSERT INTO board_item_changes (
          team_id,
          board_id,
          board_item_id,
          entity_id,
          actor_kind,
          status,
          field,
          new_value,
          source_event_id
        )
        VALUES (
          '${TEAM_ID}',
          '${LEGACY_BOARD_ID}',
          '${LEGACY_BOARD_ITEM_ID}',
          '${LEGACY_ENTITY_ID}',
          'agent',
          'suggested',
          'lane',
          '"todo"'::jsonb,
          '${LEGACY_EVENT_ID}'
        );
      `);

      await applyMigrationFile(migrationPg, '0056_legacy_provenance_cutover_guards.sql');
      await applyMigrationFile(migrationPg, '0057_legacy_provenance_editability.sql');

      const constraints = await migrationPg.query<{ conname: string; convalidated: boolean }>(`
        SELECT conname, convalidated
        FROM pg_constraint
        WHERE conname IN (
          'object_changes_legacy_source_event_id_null_chk',
          'board_item_changes_legacy_source_event_id_null_chk'
        )
        ORDER BY conname
      `);
      expect(constraints.rows).toEqual([
        { conname: 'board_item_changes_legacy_source_event_id_null_chk', convalidated: false },
        { conname: 'object_changes_legacy_source_event_id_null_chk', convalidated: false },
      ]);
      const triggers = await migrationPg.query<{ tgname: string }>(`
        SELECT tgname
        FROM pg_trigger
        WHERE tgrelid = 'entities'::regclass
          AND tgname = 'entities_legacy_provenance_write_guard'
          AND NOT tgisinternal
      `);
      expect(triggers.rows).toEqual([{ tgname: 'entities_legacy_provenance_write_guard' }]);

      const legacyRows = await migrationPg.query<{
        entity_source_rows: number;
        entity_agent_rows: number;
        object_change_rows: number;
        board_change_rows: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM entities WHERE source_event_id IS NOT NULL) AS entity_source_rows,
          (SELECT count(*)::int FROM entities WHERE agent_suggested = true) AS entity_agent_rows,
          (SELECT count(*)::int FROM object_changes WHERE source_event_id IS NOT NULL) AS object_change_rows,
          (SELECT count(*)::int FROM board_item_changes WHERE source_event_id IS NOT NULL) AS board_change_rows
      `);
      expect(legacyRows.rows[0]).toEqual({
        entity_source_rows: 1,
        entity_agent_rows: 1,
        object_change_rows: 1,
        board_change_rows: 1,
      });

      await migrationPg.exec(`
        UPDATE entities
        SET canonical_name = 'Edited legacy provenance task'
        WHERE id = '${LEGACY_ENTITY_ID}'
      `);
      const editedLegacy = await migrationPg.query<{
        canonical_name: string;
        source_event_id: string | null;
        agent_suggested: boolean;
      }>(`
        SELECT canonical_name, source_event_id, agent_suggested
        FROM entities
        WHERE id = '${LEGACY_ENTITY_ID}'
      `);
      expect(editedLegacy.rows[0]).toEqual({
        canonical_name: 'Edited legacy provenance task',
        source_event_id: LEGACY_EVENT_ID,
        agent_suggested: true,
      });

      await migrationPg.exec(`
        INSERT INTO entities (id, team_id, type, canonical_name)
        VALUES ('99999999-9999-4999-8999-999999999994', '${TEAM_ID}', 'task', 'New source-ref task')
      `);
      await expect(
        migrationPg.exec(`
          INSERT INTO entities (team_id, type, canonical_name, source_event_id)
          VALUES ('${TEAM_ID}', 'task', 'New legacy source task', '${LEGACY_EVENT_ID}')
        `),
      ).rejects.toThrow();
      await expect(
        migrationPg.exec(`
          INSERT INTO entities (team_id, type, canonical_name, agent_suggested)
          VALUES ('${TEAM_ID}', 'task', 'New legacy suggested task', true)
        `),
      ).rejects.toThrow();
      await expect(
        migrationPg.exec(`
          UPDATE entities
          SET source_event_id = '${LEGACY_EVENT_ID}'
          WHERE id = '99999999-9999-4999-8999-999999999994'
        `),
      ).rejects.toThrow();
      await expect(
        migrationPg.exec(`
          UPDATE entities
          SET agent_suggested = true
          WHERE id = '99999999-9999-4999-8999-999999999994'
        `),
      ).rejects.toThrow();
      await expect(
        migrationPg.exec(`
          INSERT INTO object_changes (
            team_id,
            entity_id,
            actor_kind,
            field,
            new_value,
            source_event_id
          )
          VALUES (
            '${TEAM_ID}',
            '99999999-9999-4999-8999-999999999994',
            'system',
            'status',
            '"open"'::jsonb,
            '${LEGACY_EVENT_ID}'
          )
        `),
      ).rejects.toThrow();
      await expect(
        migrationPg.exec(`
          INSERT INTO board_item_changes (
            team_id,
            board_id,
            board_item_id,
            entity_id,
            actor_kind,
            field,
            new_value,
            source_event_id
          )
          VALUES (
            '${TEAM_ID}',
            '${LEGACY_BOARD_ID}',
            '${LEGACY_BOARD_ITEM_ID}',
            '${LEGACY_ENTITY_ID}',
            'system',
            'notes',
            '"new"'::jsonb,
            '${LEGACY_EVENT_ID}'
          )
        `),
      ).rejects.toThrow();
    } finally {
      await migrationPg.close();
    }
  });

  it('backfills existing teams to the Helsinki workspace timezone default', async () => {
    const migrationPg = new PGlite();
    const explicitTeamId = '33333333-3333-4333-8333-333333333333';
    try {
      await applyMigrations(migrationPg, { throughFile: '0046_priority_integrations.sql' });
      await seedBase(migrationPg);
      await migrationPg.exec(`
        INSERT INTO teams (id, slug, name, inbound_email)
        VALUES ('${explicitTeamId}', 'explicit-db', 'Explicit DB', 'explicit-db@example.test');
        INSERT INTO team_calendar_settings (team_id, default_timezone)
        VALUES
          ('${TEAM_ID}', 'UTC'),
          ('${explicitTeamId}', 'Europe/Paris');
        INSERT INTO message_preferences (team_id, user_id, timezone)
        VALUES
          ('${TEAM_ID}', '${OWNER_ID}', 'UTC'),
          ('${explicitTeamId}', '${OWNER_ID}', 'Europe/Paris');
        `);

      await applyMigrationFile(migrationPg, '0047_existing_team_timezones.sql');

      const settingsRows = await migrationPg.query<{
        team_id: string;
        default_timezone: string;
      }>(`
        SELECT team_id::text, default_timezone
        FROM team_calendar_settings
        WHERE team_id IN ('${TEAM_ID}', '${OTHER_TEAM_ID}', '${explicitTeamId}')
        ORDER BY team_id
        `);
      expect(settingsRows.rows).toEqual([
        { team_id: TEAM_ID, default_timezone: 'Europe/Helsinki' },
        { team_id: OTHER_TEAM_ID, default_timezone: 'Europe/Helsinki' },
        { team_id: explicitTeamId, default_timezone: 'Europe/Paris' },
      ]);

      const preferenceRows = await migrationPg.query<{ team_id: string; timezone: string }>(`
        SELECT team_id::text, timezone
        FROM message_preferences
        WHERE team_id IN ('${TEAM_ID}', '${explicitTeamId}')
        ORDER BY team_id
        `);
      expect(preferenceRows.rows).toEqual([
        { team_id: TEAM_ID, timezone: 'Europe/Helsinki' },
        { team_id: explicitTeamId, timezone: 'Europe/Paris' },
      ]);
    } finally {
      await migrationPg.close();
    }
  }, 20_000);

  it('backfills existing teams with email digest destinations', async () => {
    const migrationPg = new PGlite();
    try {
      await applyMigrations(migrationPg, {
        throughFile: '0067_canonical_link_evidence_strength.sql',
      });
      await seedBase(migrationPg);
      await applyMigrationFile(migrationPg, '0068_digest_destinations.sql');

      const rows = await migrationPg.query<{
        team_id: string;
        kind: string;
        target_id: string | null;
      }>(`
        SELECT team_id::text, kind::text, target_id
        FROM team_digest_destinations
        ORDER BY team_id, kind
      `);
      expect(rows.rows).toEqual([
        { team_id: TEAM_ID, kind: 'email_members', target_id: null },
        { team_id: OTHER_TEAM_ID, kind: 'email_members', target_id: null },
      ]);
    } finally {
      await migrationPg.close();
    }
  }, 20_000);

  it('enforces digest destination uniqueness and target shape', async () => {
    await pg.exec(`
      INSERT INTO team_digest_destinations (team_id, kind)
      VALUES ('${TEAM_ID}', 'email_members')
    `);
    await expect(
      pg.exec(`
        INSERT INTO team_digest_destinations (team_id, kind)
        VALUES ('${TEAM_ID}', 'email_members')
      `),
    ).rejects.toThrow();
    await expect(
      pg.exec(`
        INSERT INTO team_digest_destinations (team_id, kind, target_id)
        VALUES ('${TEAM_ID}', 'slack_channel', NULL)
      `),
    ).rejects.toThrow();
    await pg.exec(`
      INSERT INTO team_digest_destinations (team_id, kind, target_id, label)
      VALUES ('${TEAM_ID}', 'slack_channel', 'C123', '#general')
    `);
    await expect(
      pg.exec(`
        INSERT INTO team_digest_destinations (team_id, kind, target_id)
        VALUES ('${TEAM_ID}', 'slack_channel', 'C123')
      `),
    ).rejects.toThrow();
    await pg.exec(`
      INSERT INTO team_digest_destinations (team_id, kind, target_id, label)
      VALUES ('${TEAM_ID}', 'slack_channel', 'C456', '#product')
    `);
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

  it('enforces reconciliation foundation dedupe and team cascade contracts', async () => {
    const rawEventId = '99999999-9999-4999-8999-999999999950';
    const evidenceId = '99999999-9999-4999-8999-999999999951';
    const clusterId = '99999999-9999-4999-8999-999999999952';
    const runId = '99999999-9999-4999-8999-999999999953';
    const outputId = '99999999-9999-4999-8999-999999999954';

    await pg.exec(`
      INSERT INTO raw_events (id, team_id, author_user_id, source, content_text, source_metadata)
      VALUES ('${rawEventId}', '${TEAM_ID}', '${OWNER_ID}', 'email', 'Forwarded customer note', '{"message_id":"reconcile-foundation"}'::jsonb);

      INSERT INTO artifact_clusters
        (id, team_id, artifact_cluster_kind, artifact_type, canonical_name, status)
      VALUES
        ('${clusterId}', '${TEAM_ID}', 'customer_project', 'project', 'Acme implementation', 'active');

      INSERT INTO reconciliation_evidence
        (
          id,
          team_id,
          raw_event_id,
          source_payload_ref,
          payload_digest,
          source,
          event_type,
          occurred_at,
          visibility,
          visibility_owner_user_id,
          content_digest,
          normalizer_version,
          dedupe_key
        )
      VALUES
        (
          '${evidenceId}',
          '${TEAM_ID}',
          '${rawEventId}',
          's3://timeline-test/payloads/email/reconcile-foundation',
          'sha256:payload',
          'email',
          'forwarded_thread',
          '2026-06-01T09:00:00Z',
          'team',
          '${OWNER_ID}',
          'sha256:content',
          'reconcile-normalize-2026-06',
          'evidence-key'
        );

      INSERT INTO reconciliation_evidence_anchors
        (team_id, evidence_id, anchor_type, anchor_value, strength, source, dedupe_key)
      VALUES
        ('${TEAM_ID}', '${evidenceId}', 'email_thread', 'thread-1', 'hard', 'adapter', 'anchor-key');

      INSERT INTO artifact_evidence_associations
        (
          team_id,
          cluster_id,
          evidence_id,
          raw_event_id,
          role,
          strength,
          association_source,
          source_refs,
          visibility,
          visibility_owner_user_id,
          visibility_floor,
          dedupe_key
        )
      VALUES
        (
          '${TEAM_ID}',
          '${clusterId}',
          '${evidenceId}',
          '${rawEventId}',
          'discussion',
          'hard',
          'hard_anchor',
          '[{"source":"email","rawEventId":"${rawEventId}","evidenceId":"${evidenceId}"}]'::jsonb,
          'team',
          '${OWNER_ID}',
          'team',
          'association-key'
        );

      INSERT INTO reconciliation_runs
        (id, team_id, trigger, scope, input_fingerprint, engine_version)
      VALUES
        ('${runId}', '${TEAM_ID}', 'raw_event', '${rawEventId}', 'fingerprint-1', 'engine-1');

      INSERT INTO reconciliation_outputs
        (
          id,
          team_id,
          run_id,
          cluster_id,
          output_kind,
          target_kind,
          operation,
          payload,
          requires_approval,
          source_refs,
          source_payload_refs,
          visibility,
          visibility_owner_user_id,
          visibility_floor,
          dedupe_key
        )
      VALUES
        (
          '${outputId}',
          '${TEAM_ID}',
          '${runId}',
          '${clusterId}',
          'approval_bundle',
          'object_relationship',
          'create',
          '{"relationship":"customer_project"}'::jsonb,
          true,
          '[{"source":"email","rawEventId":"${rawEventId}","evidenceId":"${evidenceId}"}]'::jsonb,
          '["s3://timeline-test/payloads/email/reconcile-foundation"]'::jsonb,
          'team',
          '${OWNER_ID}',
          'team',
          'output-key'
        );

      INSERT INTO reconciliation_projection_outbox
        (
          id,
          team_id,
          output_id,
          action,
          status,
          payload,
          dedupe_key,
          processed_at
        )
      VALUES
        (
          '11111111-1111-4111-8111-111111111122',
          '${TEAM_ID}',
          '${outputId}',
          'create_projection',
          'processed',
          '{"projection":"agent_suggestions"}'::jsonb,
          'projection-outbox-key',
          now()
        );
    `);

    await expect(
      pg.query(
        `INSERT INTO reconciliation_evidence
          (
            team_id,
            raw_event_id,
            source,
            event_type,
            occurred_at,
            content_digest,
            normalizer_version,
            dedupe_key
          )
         VALUES ($1, $2, 'email', 'forwarded_thread', now(), 'sha256:retry', 'reconcile-normalize-2026-06', 'evidence-key')`,
        [TEAM_ID, rawEventId],
      ),
    ).rejects.toThrow();

    await expect(
      pg.query(
        `INSERT INTO reconciliation_outputs
          (team_id, run_id, output_kind, target_kind, operation, dedupe_key)
         VALUES ($1, $2, 'no_action', 'object', 'noop', 'output-key')`,
        [TEAM_ID, runId],
      ),
    ).rejects.toThrow();

    await expect(
      pg.query(
        `INSERT INTO reconciliation_projection_outbox
          (team_id, output_id, action, dedupe_key)
         VALUES ($1, $2, 'create_projection', 'projection-outbox-key')`,
        [TEAM_ID, outputId],
      ),
    ).rejects.toThrow();

    await pg.exec(`DELETE FROM teams WHERE id = '${TEAM_ID}'`);
    const remaining = await pg.query<{
      evidence_count: string;
      association_count: string;
      output_count: string;
      outbox_count: string;
    }>(`
      SELECT
        (SELECT count(*)::text FROM reconciliation_evidence WHERE team_id = '${TEAM_ID}') AS evidence_count,
        (SELECT count(*)::text FROM artifact_evidence_associations WHERE team_id = '${TEAM_ID}') AS association_count,
        (SELECT count(*)::text FROM reconciliation_outputs WHERE team_id = '${TEAM_ID}') AS output_count,
        (SELECT count(*)::text FROM reconciliation_projection_outbox WHERE team_id = '${TEAM_ID}') AS outbox_count
    `);

    expect(remaining.rows[0]).toEqual({
      evidence_count: '0',
      association_count: '0',
      output_count: '0',
      outbox_count: '0',
    });
  });
});
