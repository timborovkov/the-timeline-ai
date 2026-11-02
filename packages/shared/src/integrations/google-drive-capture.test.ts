import { PGlite } from '@electric-sql/pglite';
import { googleDriveFileSnapshots, integrations } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import {
  DRIVE_FILE_DEBOUNCE_MS,
  DRIVE_FILE_MAX_LATENCY_MS,
  driveDebouncePlan,
  hashDrivePayload,
  loadLatestDriveSnapshot,
  saveDriveSnapshot,
  takeDriveProcessSlot,
} from '#src/integrations/google-drive-capture.js';
import { driveChangeJudgePrompt } from '#src/integrations/google-drive-judge.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('driveDebouncePlan', () => {
  it('waits the quiet window from the latest notification', () => {
    const now = Date.parse('2026-06-01T10:00:00.000Z');
    const plan = driveDebouncePlan(null, now);
    expect(plan.delayMs).toBe(DRIVE_FILE_DEBOUNCE_MS);
    expect(plan.firstQueuedAt).toBe('2026-06-01T10:00:00.000Z');
  });

  it('caps trailing debounce at one hour from the first notification', () => {
    const first = Date.parse('2026-06-01T10:00:00.000Z');
    const now = first + DRIVE_FILE_MAX_LATENCY_MS - 60_000;
    const plan = driveDebouncePlan({ firstQueuedAt: new Date(first).toISOString() }, now);
    expect(plan.delayMs).toBe(60_000);
  });
});

describe('takeDriveProcessSlot', () => {
  it('rejects after the per-file daily cap', async () => {
    const checkRateLimit = ({ key }: { key: string }) =>
      Promise.resolve(
        key.includes('file')
          ? { ok: false as const, retryAfterMs: 1_000, remaining: 0 }
          : { ok: true as const, remaining: 10 },
      );
    await expect(
      takeDriveProcessSlot({
        integrationId: 'int-1',
        fileId: 'file-1',
        checkRateLimit,
      }),
    ).resolves.toMatchObject({ allowed: false, reason: 'file' });
  });
});

describe('driveChangeJudgePrompt', () => {
  it('sends hunks and signals without a full document', () => {
    const prompt = driveChangeJudgePrompt({
      fileName: 'SOW',
      mimeType: 'application/vnd.google-apps.document',
      hunks: ['Signed $48k Northstar contract'],
      strongSignals: ['comment_added', 'shared_external_domain'],
    });
    expect(prompt).toContain('Signed $48k Northstar contract');
    expect(prompt).toContain('comment_added');
    expect(prompt).not.toContain('ya29.');
  });

  it('hashes payloads without echoing them', () => {
    expect(hashDrivePayload('secret-doc')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashDrivePayload('secret-doc')).not.toContain('secret');
  });
});

describe('saveDriveSnapshot uniqueness', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'team-a', 'Team A');
      INSERT INTO users (id, email) VALUES ('${USER_ID}', 'owner@example.com');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_ID}', '${USER_ID}', 'owner');
    `);
  }, 60_000);

  afterEach(async () => {
    await pg.close();
  });

  it('inserts comment-only and permission-only snapshots that share a content hash', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const snapshot = {
      contentHash: hashDrivePayload('same-body'),
      snapshotText: 'same-body',
      commentsHash: 'comments-1',
      permissionsHash: 'permissions-1',
      mimeType: 'application/vnd.google-apps.document',
    };
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-1',
      snapshot,
    });
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-1',
      snapshot: { ...snapshot, commentsHash: 'comments-2' },
    });
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-1',
      snapshot: { ...snapshot, commentsHash: 'comments-2' },
    });

    const rows = await db.select().from(googleDriveFileSnapshots);
    expect(rows).toHaveLength(2);
    const latest = await loadLatestDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-1',
    });
    expect(latest?.commentsHash).toBe('comments-2');
    expect(latest?.contentHash).toBe(snapshot.contentHash);
  });
});
