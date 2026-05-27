import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { type Db, rawEvents } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createJobRecoveryScope } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../db/drizzle');

async function applyMigrations(pg: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'SELECT 1;');
    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }
}

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEAM_ID = '99999999-9999-9999-9999-999999999999';
const ADMIN_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_2_ID = '33333333-3333-3333-3333-333333333333';
const MEMBER_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_USER_ID = '55555555-5555-5555-5555-555555555555';
const RAW_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PRIVATE_RAW_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_TEAM_RAW_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const INTEGRATION_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const OBJECT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ZERO_FACT_RAW_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const FAILED_EXTRACTION_RAW_ID = '12121212-1212-1212-1212-121212121212';

let pg: PGlite;
let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  pg = new PGlite();
  await applyMigrations(pg);
  db = drizzle(pg);
  await seed(pg);
});

describe('job recovery scope', () => {
  it('shows only active-team visible candidates to admins', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    await seedRawEventFailure(pg, PRIVATE_RAW_ID, TEAM_ID, OTHER_USER_ID, 'private');
    await seedRawEventFailure(pg, OTHER_TEAM_RAW_ID, OTHER_TEAM_ID, OTHER_USER_ID, 'team');

    const scope = scopeFor(ADMIN_ID, 'admin');
    const items = await scope.listRecoverableJobs();

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('transcription');
    expect(items[0]?.artifactId).toBe(RAW_ID);
    expect(items[0]?.label).toContain('Transcription');
    expect(items[0]?.label).not.toContain('transcribe');
  });

  it('requires admin role for list, retry, and dismiss', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    const scope = scopeFor(MEMBER_ID, 'member');

    await expect(scope.listRecoverableJobs()).rejects.toThrow('Requires admin role');
    await expect(scope.dismissRecoverableJob('bad')).rejects.toThrow('Requires admin role');
    await expect(scope.retryRecoverableJob('bad')).rejects.toThrow('Requires admin role');
  });

  it('hides a team-wide dismissal for another admin', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    const adminOne = scopeFor(ADMIN_ID, 'admin');
    const [item] = await adminOne.listRecoverableJobs();
    if (!item) throw new Error('expected recovery item');

    await adminOne.dismissRecoverableJob(item.id, 'bad source file');

    const adminTwo = scopeFor(ADMIN_2_ID, 'admin');
    await expect(adminTwo.listRecoverableJobs()).resolves.toEqual([]);
  });

  it('retry clears dismissal and failure markers before enqueueing', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    const enqueueTranscribeJob = vi.fn().mockResolvedValue(undefined);
    const scope = scopeFor(ADMIN_ID, 'admin', { enqueueTranscribeJob });
    const [item] = await scope.listRecoverableJobs();
    if (!item) throw new Error('expected recovery item');
    await scope.dismissRecoverableJob(item.id);

    await scope.retryRecoverableJob(item.id);

    expect(enqueueTranscribeJob).toHaveBeenCalledWith({
      rawEventId: RAW_ID,
      teamId: TEAM_ID,
      audioKey: 'audio/raw.ogg',
    });
    const rows = await (db as never as Db)
      .select({ meta: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.id, RAW_ID));
    expect(rows[0]?.meta).not.toHaveProperty('transcription_failed_at');
    expect(rows[0]?.meta).not.toHaveProperty('transcription_error');
  });

  it('does not flag successful zero-fact extraction as stuck', async () => {
    await seedTextRawEvent(pg, RAW_ID, {
      sourceMetadata: '{}',
    });
    await seedTextRawEvent(pg, ZERO_FACT_RAW_ID, {
      sourceMetadata:
        '{"extracted_at":"2026-05-27T10:00:00.000Z","extraction_model_version":"test-model"}',
    });

    const scope = scopeFor(ADMIN_ID, 'admin');
    const items = await scope.listRecoverableJobs();
    const extractionItems = items.filter((item) => item.kind === 'extraction');

    expect(extractionItems.map((item) => item.artifactId)).toEqual([RAW_ID]);
  });

  it('keeps failed zero-fact extraction out of stuck extraction results', async () => {
    await seedTextRawEvent(pg, RAW_ID, {
      sourceMetadata: '{}',
    });
    await seedTextRawEvent(pg, FAILED_EXTRACTION_RAW_ID, {
      sourceMetadata:
        '{"extraction_failed_at":"2026-05-27T10:00:00.000Z","extraction_error":"model failed"}',
    });

    const scope = scopeFor(ADMIN_ID, 'admin');
    const items = await scope.listRecoverableJobs();
    const failedItem = items.find(
      (item) => item.kind === 'extraction' && item.artifactId === FAILED_EXTRACTION_RAW_ID,
    );
    const stuckIds = items
      .filter((item) => item.kind === 'extraction' && item.status === 'stuck')
      .map((item) => item.artifactId);

    expect(failedItem).toMatchObject({ kind: 'extraction', status: 'failed' });
    expect(stuckIds).toEqual([RAW_ID]);
  });

  it('retries object embedding with the original queue scope', async () => {
    await pg.exec(`
      INSERT INTO entities (id, team_id, type, canonical_name)
      VALUES ('${OBJECT_ID}', '${TEAM_ID}', 'project', 'Apollo');
    `);
    const enqueueEmbedJob = vi.fn().mockResolvedValue(undefined);
    const scope = scopeFor(ADMIN_ID, 'admin', {
      enqueueEmbedJob,
      getEmbedQueue: () =>
        fakeQueue([
          {
            data: { scope: 'object', objectId: OBJECT_ID, teamId: TEAM_ID },
            failedReason: 'embed failed',
            finishedOn: Date.now(),
          },
        ]),
    });
    const [item] = await scope.listRecoverableJobs();
    if (!item) throw new Error('expected recovery item');

    await scope.retryRecoverableJob(item.id);

    expect(item.artifactKind).toBe('object');
    expect(enqueueEmbedJob).toHaveBeenCalledWith({
      scope: 'object',
      objectId: OBJECT_ID,
      teamId: TEAM_ID,
    });
  });

  it('excludes repeatable ticks and unsupported low-level failed jobs', async () => {
    await pg.exec(`
      INSERT INTO integrations (id, team_id, provider, display_name, external_account_id)
      VALUES ('${INTEGRATION_ID}', '${TEAM_ID}', 'github', 'GitHub', 'gh-1');
    `);
    const scope = scopeFor(ADMIN_ID, 'admin', {
      getEmbedQueue: () => fakeQueue([{ data: { scope: 'meeting_chunk', teamId: TEAM_ID } }]),
      getMeetingFinalizeQueue: () => fakeQueue([]),
      getIntegrationSyncQueue: () =>
        fakeQueue([
          { data: { kind: 'incremental', integrationId: '__tick__', teamId: '__tick__' } },
          { data: { kind: 'incremental', integrationId: INTEGRATION_ID, teamId: TEAM_ID } },
        ]),
    });

    const items = await scope.listRecoverableJobs();

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('integration_sync');
    expect(items[0]?.artifactId).toBe(INTEGRATION_ID);
  });
});

function scopeFor(
  userId: string,
  role: 'admin' | 'member',
  queues: Parameters<typeof createJobRecoveryScope>[0]['queues'] = {},
) {
  return createJobRecoveryScope({
    db: db as never,
    teamId: TEAM_ID,
    userId,
    ensureMember: (minRole = 'member') => {
      if (minRole === 'admin' && role !== 'admin') throw new Error('Requires admin role');
      return Promise.resolve(role);
    },
    queues: {
      enqueueTranscribeJob: vi.fn().mockResolvedValue(undefined),
      enqueueExtractJob: vi.fn().mockResolvedValue(undefined),
      enqueueEmbedJob: vi.fn().mockResolvedValue(undefined),
      enqueueDocumentExtractJob: vi.fn().mockResolvedValue(undefined),
      enqueueMeetingFinalizeJob: vi.fn().mockResolvedValue(undefined),
      enqueueIntegrationSyncJob: vi.fn().mockResolvedValue(undefined),
      getEmbedQueue: () => fakeQueue([]),
      getMeetingFinalizeQueue: () => fakeQueue([]),
      getIntegrationSyncQueue: () => fakeQueue([]),
      ...queues,
    },
  });
}

function fakeQueue(jobs: unknown[]) {
  return {
    getJobs: vi.fn().mockResolvedValue(jobs),
  };
}

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name) VALUES
      ('${TEAM_ID}', 'team', 'Team'),
      ('${OTHER_TEAM_ID}', 'other', 'Other');
    INSERT INTO users (id, email) VALUES
      ('${ADMIN_ID}', 'admin@test.local'),
      ('${ADMIN_2_ID}', 'admin2@test.local'),
      ('${MEMBER_ID}', 'member@test.local'),
      ('${OTHER_USER_ID}', 'other@test.local');
    INSERT INTO team_members (team_id, user_id, role) VALUES
      ('${TEAM_ID}', '${ADMIN_ID}', 'admin'),
      ('${TEAM_ID}', '${ADMIN_2_ID}', 'admin'),
      ('${TEAM_ID}', '${MEMBER_ID}', 'member'),
      ('${TEAM_ID}', '${OTHER_USER_ID}', 'member'),
      ('${OTHER_TEAM_ID}', '${OTHER_USER_ID}', 'admin');
  `);
}

async function seedRawEventFailure(
  pg: PGlite,
  id: string,
  teamId: string,
  authorUserId: string,
  visibility: 'private' | 'team',
): Promise<void> {
  await pg.exec(`
    INSERT INTO raw_events (
      id,
      team_id,
      author_user_id,
      source,
      content_audio_url,
      occurred_at,
      created_at,
      visibility,
      source_metadata
    )
    VALUES (
      '${id}',
      '${teamId}',
      '${authorUserId}',
      'web',
      'audio/raw.ogg',
      now() - interval '1 hour',
      now() - interval '1 hour',
      '${visibility}',
      '{"transcription_failed_at":"2026-05-27T10:00:00.000Z","transcription_error":"codec failed"}'::jsonb
    );
  `);
}

async function seedTextRawEvent(
  pg: PGlite,
  id: string,
  opts: { sourceMetadata: string },
): Promise<void> {
  await pg.exec(`
    INSERT INTO raw_events (
      id,
      team_id,
      author_user_id,
      source,
      content_text,
      occurred_at,
      created_at,
      visibility,
      source_metadata
    )
    VALUES (
      '${id}',
      '${TEAM_ID}',
      '${ADMIN_ID}',
      'web',
      'Headed out',
      now() - interval '1 hour',
      now() - interval '1 hour',
      'team',
      '${opts.sourceMetadata}'::jsonb
    );
  `);
}
