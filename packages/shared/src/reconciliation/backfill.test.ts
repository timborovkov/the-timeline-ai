import { PGlite } from '@electric-sql/pglite';
import { rawEvents, reconciliationEvidence } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  auditReconciliationEvidenceCoverage,
  backfillReconciliationEvidence,
} from '#src/reconciliation/backfill.js';
import { normalizeRawEventsToEvidence } from '#src/reconciliation/normalization.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-1111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('reconciliation evidence backfill and coverage audit', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'reconcile-backfill', 'Reconcile Backfill');
      INSERT INTO users (id, email) VALUES ('${USER_ID}', 'owner@example.test');
      INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
    `);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('audits replay coverage and backfills only missing raw events by default', async () => {
    const rows = await db
      .insert(rawEvents)
      .values([
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'email',
          contentText: 'Email with retained provider payload.',
          occurredAt: new Date('2026-06-25T09:00:00Z'),
          visibility: 'team',
          sourceMetadata: {
            message_id: '<retained@example.test>',
            raw_postmark: { MessageID: '<retained@example.test>', TextBody: 'Retained payload.' },
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'slack',
          contentText: 'Slack message whose source snapshot was not retained.',
          occurredAt: new Date('2026-06-25T09:01:00Z'),
          visibility: 'team',
          sourceMetadata: {
            slack_workspace_id: 'T_BACKFILL',
            slack_channel_id: 'C_BACKFILL',
            slack_message_ts: '1800000000.000100',
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_ID,
          source: 'web',
          contentText: 'Historical web note that has not been normalized yet.',
          occurredAt: new Date('2026-06-25T09:02:00Z'),
          visibility: 'team',
          sourceMetadata: { title: 'Historical note' },
        },
      ])
      .returning({ id: rawEvents.id, source: rawEvents.source });

    await normalizeRawEventsToEvidence({
      db: db as never,
      teamId: TEAM_ID,
      rawEventIds: rows.slice(0, 2).map((row) => row.id),
    });

    const before = await auditReconciliationEvidenceCoverage({
      db: db as never,
      teamId: TEAM_ID,
      pageSize: 2,
    });
    expect(before).toMatchObject({
      totalRawEvents: 3,
      normalizedRawEvents: 2,
      missingRawEvents: 1,
      fullReplayEvidence: 1,
      degradedReplayEvidence: 1,
    });
    expect(before.bySource.email).toMatchObject({
      totalRawEvents: 1,
      normalizedRawEvents: 1,
      fullReplayEvidence: 1,
    });
    expect(before.bySource.web).toMatchObject({
      totalRawEvents: 1,
      missingRawEvents: 1,
    });

    const dryRun = await backfillReconciliationEvidence({
      db: db as never,
      teamId: TEAM_ID,
      pageSize: 1,
      limit: 1,
      dryRun: true,
    });
    expect(dryRun).toMatchObject({
      dryRun: true,
      missingOnly: true,
      candidateRawEvents: 1,
      normalizedEvidence: 0,
    });

    const stillMissing = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, rows[2]?.id ?? rows[0]?.id ?? ''));
    expect(stillMissing).toHaveLength(0);

    const backfill = await backfillReconciliationEvidence({
      db: db as never,
      teamId: TEAM_ID,
      pageSize: 1,
      limit: 1,
    });
    expect(backfill).toMatchObject({
      dryRun: false,
      missingOnly: true,
      candidateRawEvents: 1,
      normalizedEvidence: 1,
    });
    expect(backfill.scannedRawEvents).toBe(3);

    const after = await auditReconciliationEvidenceCoverage({
      db: db as never,
      teamId: TEAM_ID,
      source: 'web',
    });
    expect(after).toMatchObject({
      source: 'web',
      totalRawEvents: 1,
      normalizedRawEvents: 1,
      missingRawEvents: 0,
      degradedReplayEvidence: 1,
    });
  });
});
