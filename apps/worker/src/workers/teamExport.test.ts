import { PGlite } from '@electric-sql/pglite';
import { auditLog, type Db, teamExports } from '@timeline/db';
import { buildTeamExportObjectKey, type TeamExportManifest } from '@timeline/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyDbMigrations } from '#src/test/pglite.js';
import { processTeamExportJob, type TeamExportWorkerIO } from '#src/workers/teamExport.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const EXPORT_ID = '33333333-3333-4333-8333-333333333333';

type TestDb = ReturnType<typeof drizzle>;

function manifest(expiresAt = '2026-07-02T12:00:00.000Z'): TeamExportManifest {
  return {
    export_id: EXPORT_ID,
    team_id: TEAM_ID,
    requested_by_user_id: USER_ID,
    generated_at: '2026-07-01T12:00:00.000Z',
    expires_at: expiresAt,
    format_version: 1,
    files: {
      'manifest.json': { bytes: 256 },
      'raw-events.json': { rows: 1, bytes: 512 },
    },
    omissions: {
      raw_events: 0,
      facts: 0,
      folders: 0,
      documents: 0,
      document_versions: 0,
      meetings: 0,
      calendar_events: 0,
      files: 0,
      integration_secrets: 0,
    },
  };
}

function fakeIO(overrides: Partial<TeamExportWorkerIO> = {}): TeamExportWorkerIO {
  return {
    buildArchive: vi.fn().mockResolvedValue({
      archive: Buffer.from('zip-bytes'),
      manifest: manifest(),
      omissions: manifest().omissions,
      signedFileCount: 2,
    }),
    putArchive: vi.fn().mockResolvedValue(undefined),
    deleteArchive: vi.fn().mockResolvedValue(undefined),
    getBuckets: () => ({
      attachments: 'attachments',
      audio: 'audio',
      documents: 'documents',
      exports: 'exports',
    }),
    signFileUrl: vi.fn().mockResolvedValue('https://signed.example.test/file'),
    ...overrides,
  };
}

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'team-export-worker', 'Team Export Worker');

    INSERT INTO users (id, email)
    VALUES ('${USER_ID}', 'team-export@example.com');

    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
}

async function insertExport(db: TestDb, status: 'queued' | 'ready' | 'expired' = 'queued') {
  await db.insert(teamExports).values({
    id: EXPORT_ID,
    teamId: TEAM_ID,
    requestedByUserId: USER_ID,
    status,
    objectKey: status === 'ready' ? buildTeamExportObjectKey(TEAM_ID, EXPORT_ID) : null,
    manifest: {},
    omissions: {},
  });
}

async function loadExport(db: TestDb) {
  const rows = await db.select().from(teamExports).where(eq(teamExports.id, EXPORT_ID)).limit(1);
  const row = rows[0];
  if (!row) throw new Error('missing team export');
  return row;
}

describe('team export worker', () => {
  let pg: PGlite;
  let db: TestDb;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  }, 60_000);

  afterEach(async () => {
    await pg.close();
  });

  it('uploads the archive, marks the export ready, and writes trust audit rows', async () => {
    await insertExport(db);
    const io = fakeIO();

    await processTeamExportJob(
      { db: db as never as Db, io },
      { teamExportId: EXPORT_ID, teamId: TEAM_ID, requestedByUserId: USER_ID },
    );

    const row = await loadExport(db);
    expect(row.status).toBe('ready');
    expect(row.objectKey).toBe(buildTeamExportObjectKey(TEAM_ID, EXPORT_ID));
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(row.expiresAt).toEqual(new Date('2026-07-02T12:00:00.000Z'));
    expect(row.error).toBeNull();
    expect(io.putArchive).toHaveBeenCalledWith({
      bucket: 'exports',
      key: buildTeamExportObjectKey(TEAM_ID, EXPORT_ID),
      body: Buffer.from('zip-bytes'),
      contentType: 'application/zip',
    });
    expect(io.deleteArchive).not.toHaveBeenCalled();

    const audits = await db.select().from(auditLog).where(eq(auditLog.targetId, EXPORT_ID));
    expect(audits.map((entry) => entry.action).sort()).toEqual([
      'team_export.file_urls_signed',
      'team_export.ready',
    ]);
  });

  it('marks failed and deletes a partial archive when post-upload finalization fails', async () => {
    await insertExport(db);
    const badManifest = manifest('not-a-date');
    const io = fakeIO({
      buildArchive: vi.fn().mockResolvedValue({
        archive: Buffer.from('zip-bytes'),
        manifest: badManifest,
        omissions: badManifest.omissions,
        signedFileCount: 0,
      }),
    });

    await expect(
      processTeamExportJob(
        { db: db as never as Db, io },
        { teamExportId: EXPORT_ID, teamId: TEAM_ID, requestedByUserId: USER_ID },
      ),
    ).rejects.toThrow(/Invalid time value|invalid input syntax/i);

    expect(io.putArchive).toHaveBeenCalledOnce();
    expect(io.deleteArchive).toHaveBeenCalledWith({
      bucket: 'exports',
      key: buildTeamExportObjectKey(TEAM_ID, EXPORT_ID),
    });
    const row = await loadExport(db);
    expect(row.status).toBe('failed');
    expect(row.objectKey).toBeNull();
    expect(row.error).toMatch(/Invalid time value|invalid input syntax/i);
    expect(row.completedAt).toBeInstanceOf(Date);
  });

  it('skips exports that are already terminal', async () => {
    await insertExport(db, 'ready');
    const io = fakeIO();

    await processTeamExportJob(
      { db: db as never as Db, io },
      { teamExportId: EXPORT_ID, teamId: TEAM_ID, requestedByUserId: USER_ID },
    );

    expect(io.buildArchive).not.toHaveBeenCalled();
    expect(io.putArchive).not.toHaveBeenCalled();
    expect((await loadExport(db)).status).toBe('ready');
  });
});
