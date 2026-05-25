import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { type Db, documentVersions, meetings as meetingsTable } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processJanitorTick } from './janitor.js';

/**
 * Integration tests for the janitor tick. Uses pglite for Postgres + stub
 * enqueue functions so we can assert exactly which rows were re-enqueued
 * without touching Redis.
 *
 * The thresholds matter — we test that the age cutoffs actually gate the
 * sweep, not just that a stuck row gets requeued.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../../packages/db/drizzle');

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
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DOC_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 't', 'Test');`);
  await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_ID}', 'a@x');`);
  await pg.exec(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');`,
  );
  await pg.exec(
    `INSERT INTO documents (id, team_id, name, visibility, owner_user_id) VALUES ('${DOC_ID}', '${TEAM_ID}', 'test.pdf', 'team', '${USER_ID}');`,
  );
}

async function seedVersion(
  db: Db,
  opts: {
    id: string;
    version: number;
    status: 'pending' | 'extracting' | 'chunked' | 'embedded' | 'failed';
    ageMinutes: number;
    byteSize?: number | null;
  },
): Promise<void> {
  await db.insert(documentVersions).values({
    id: opts.id,
    teamId: TEAM_ID,
    documentId: DOC_ID,
    version: opts.version,
    objectKey: `${TEAM_ID}/${DOC_ID}/v${String(opts.version)}/test.pdf`,
    byteSize: opts.byteSize === undefined ? 1024 : opts.byteSize,
    contentType: 'application/pdf',
    processingStatus: opts.status,
    createdAt: new Date(Date.now() - opts.ageMinutes * 60 * 1000),
  });
}

async function seedMeeting(
  db: Db,
  opts: {
    id: string;
    status: 'pending' | 'joining' | 'active' | 'processing' | 'completed' | 'failed';
    updatedMinutesAgo: number;
  },
): Promise<void> {
  const updatedAt = new Date(Date.now() - opts.updatedMinutesAgo * 60 * 1000);
  await db.insert(meetingsTable).values({
    id: opts.id,
    teamId: TEAM_ID,
    createdByUserId: USER_ID,
    provider: 'recall',
    platform: 'meet',
    meetingUrl: 'https://meet.google.com/test',
    status: opts.status,
    defaultVisibility: 'team',
    createdAt: updatedAt,
    updatedAt,
  });
}

let pg: PGlite;
let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  pg = new PGlite();
  await applyMigrations(pg);
  await seed(pg);
  db = drizzle(pg);
});

describe('processJanitorTick — document_versions sweep', () => {
  it('re-enqueues a pending version older than the threshold', async () => {
    await seedVersion(db as never, {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddd01',
      version: 1,
      status: 'pending',
      ageMinutes: 10,
    });
    const enqueueDoc = vi.fn().mockResolvedValue(undefined);
    const enqueueMeeting = vi.fn().mockResolvedValue(undefined);

    const result = await processJanitorTick({
      db: db as never,
      enqueueDocumentExtractJob: enqueueDoc,
      enqueueMeetingFinalizeJob: enqueueMeeting,
    });

    expect(result.documentVersionsRequeued).toBe(1);
    expect(enqueueDoc).toHaveBeenCalledWith({
      documentVersionId: 'dddddddd-dddd-dddd-dddd-dddddddddd01',
      teamId: TEAM_ID,
    });
  });

  it('does not re-enqueue a freshly-pending version under the threshold', async () => {
    await seedVersion(db as never, {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddd02',
      version: 1,
      status: 'pending',
      ageMinutes: 1,
    });
    const enqueueDoc = vi.fn().mockResolvedValue(undefined);

    const result = await processJanitorTick({
      db: db as never,
      enqueueDocumentExtractJob: enqueueDoc,
      enqueueMeetingFinalizeJob: vi.fn(),
    });

    expect(result.documentVersionsRequeued).toBe(0);
    expect(enqueueDoc).not.toHaveBeenCalled();
  });

  it('re-enqueues an extracting version older than the threshold (worker died mid-job)', async () => {
    await seedVersion(db as never, {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddd03',
      version: 1,
      status: 'extracting',
      ageMinutes: 90,
    });
    const enqueueDoc = vi.fn().mockResolvedValue(undefined);

    const result = await processJanitorTick({
      db: db as never,
      enqueueDocumentExtractJob: enqueueDoc,
      enqueueMeetingFinalizeJob: vi.fn(),
    });

    expect(result.documentVersionsRequeued).toBe(1);
    expect(enqueueDoc).toHaveBeenCalledOnce();
  });

  it('does not re-enqueue an extracting version under the threshold (worker still working)', async () => {
    await seedVersion(db as never, {
      id: 'dddddddd-dddd-dddd-dddd-ddddddddddaa',
      version: 1,
      status: 'extracting',
      ageMinutes: 30,
    });
    const enqueueDoc = vi.fn().mockResolvedValue(undefined);

    const result = await processJanitorTick({
      db: db as never,
      enqueueDocumentExtractJob: enqueueDoc,
      enqueueMeetingFinalizeJob: vi.fn(),
    });

    expect(result.documentVersionsRequeued).toBe(0);
    expect(enqueueDoc).not.toHaveBeenCalled();
  });

  it('ignores terminal states (chunked, embedded, failed)', async () => {
    await seedVersion(db as never, {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddd04',
      version: 1,
      status: 'chunked',
      ageMinutes: 1000,
    });
    await seedVersion(db as never, {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddd05',
      version: 2,
      status: 'embedded',
      ageMinutes: 1000,
    });
    await seedVersion(db as never, {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddd06',
      version: 3,
      status: 'failed',
      ageMinutes: 1000,
    });
    const enqueueDoc = vi.fn().mockResolvedValue(undefined);

    const result = await processJanitorTick({
      db: db as never,
      enqueueDocumentExtractJob: enqueueDoc,
      enqueueMeetingFinalizeJob: vi.fn(),
    });

    expect(result.documentVersionsRequeued).toBe(0);
    expect(enqueueDoc).not.toHaveBeenCalled();
  });

  it('skips abandoned pre-finalize rows (byteSize is null)', async () => {
    await seedVersion(db as never, {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddd07',
      version: 1,
      status: 'pending',
      ageMinutes: 60,
      byteSize: null,
    });
    const enqueueDoc = vi.fn().mockResolvedValue(undefined);

    const result = await processJanitorTick({
      db: db as never,
      enqueueDocumentExtractJob: enqueueDoc,
      enqueueMeetingFinalizeJob: vi.fn(),
    });

    expect(result.documentVersionsRequeued).toBe(0);
    expect(enqueueDoc).not.toHaveBeenCalled();
  });
});

describe('processJanitorTick — meetings sweep', () => {
  it('re-enqueues a processing meeting stuck for >30min', async () => {
    await seedMeeting(db as never, {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001',
      status: 'processing',
      updatedMinutesAgo: 60,
    });
    const enqueueMeeting = vi.fn().mockResolvedValue(undefined);

    const result = await processJanitorTick({
      db: db as never,
      enqueueDocumentExtractJob: vi.fn(),
      enqueueMeetingFinalizeJob: enqueueMeeting,
    });

    expect(result.meetingsRequeued).toBe(1);
    expect(enqueueMeeting).toHaveBeenCalledWith({
      meetingId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001',
      teamId: TEAM_ID,
    });
  });

  it('does not sweep pending/joining/active (driven by webhook lifecycle)', async () => {
    await seedMeeting(db as never, {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0002',
      status: 'pending',
      updatedMinutesAgo: 1000,
    });
    await seedMeeting(db as never, {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0003',
      status: 'joining',
      updatedMinutesAgo: 1000,
    });
    await seedMeeting(db as never, {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0004',
      status: 'active',
      updatedMinutesAgo: 1000,
    });
    const enqueueMeeting = vi.fn().mockResolvedValue(undefined);

    const result = await processJanitorTick({
      db: db as never,
      enqueueDocumentExtractJob: vi.fn(),
      enqueueMeetingFinalizeJob: enqueueMeeting,
    });

    expect(result.meetingsRequeued).toBe(0);
    expect(enqueueMeeting).not.toHaveBeenCalled();
  });

  it('does not re-enqueue a processing meeting that updated <30min ago', async () => {
    await seedMeeting(db as never, {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0005',
      status: 'processing',
      updatedMinutesAgo: 5,
    });
    const enqueueMeeting = vi.fn().mockResolvedValue(undefined);

    const result = await processJanitorTick({
      db: db as never,
      enqueueDocumentExtractJob: vi.fn(),
      enqueueMeetingFinalizeJob: enqueueMeeting,
    });

    expect(result.meetingsRequeued).toBe(0);
    expect(enqueueMeeting).not.toHaveBeenCalled();
  });
});

describe('processJanitorTick — failure isolation', () => {
  it('continues sweeping when one enqueue throws', async () => {
    await seedVersion(db as never, {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddd08',
      version: 1,
      status: 'pending',
      ageMinutes: 10,
    });
    await seedVersion(db as never, {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddd09',
      version: 2,
      status: 'pending',
      ageMinutes: 10,
    });
    const enqueueDoc = vi
      .fn()
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce(undefined);

    const result = await processJanitorTick({
      db: db as never,
      enqueueDocumentExtractJob: enqueueDoc,
      enqueueMeetingFinalizeJob: vi.fn(),
    });

    expect(enqueueDoc).toHaveBeenCalledTimes(2);
    expect(result.documentVersionsRequeued).toBe(1);
  });
});
