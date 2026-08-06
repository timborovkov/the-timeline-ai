import { PGlite } from '@electric-sql/pglite';
import { integrationSyncContinuationHandoffs, integrations, teams } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  adminAcknowledgePendingIntegrationSyncContinuation,
  adminClaimPendingIntegrationSyncContinuations,
  adminCommitIntegrationSyncCheckpoint,
  adminLoadCursor,
} from '#src/integrations/scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const INTEGRATION_ID = '22222222-2222-4222-8222-222222222222';

describe('Monday continuation checkpoints', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await db.insert(teams).values({ id: TEAM_ID, slug: 'monday-handoff', name: 'Monday handoff' });
    await db.insert(integrations).values({
      id: INTEGRATION_ID,
      teamId: TEAM_ID,
      provider: 'monday',
      displayName: 'Monday',
    });
  });

  afterEach(async () => {
    await pg.close();
  });

  it('keeps a pending Monday target idempotent and assigns its successor a fresh handoff', async () => {
    const continuation = {
      resourceType: 'monday.item',
      externalId: 'board-1:item-1:update-1',
    };
    const commit = () =>
      adminCommitIntegrationSyncCheckpoint(db as never, {
        integrationId: INTEGRATION_ID,
        cursors: [],
        continuations: [continuation],
      });

    await commit();
    const [firstRow] = await db
      .select({ id: integrationSyncContinuationHandoffs.id })
      .from(integrationSyncContinuationHandoffs)
      .where(eq(integrationSyncContinuationHandoffs.integrationId, INTEGRATION_ID));
    if (!firstRow) throw new Error('first Monday handoff missing');

    await commit();
    await expect(
      db
        .select({ id: integrationSyncContinuationHandoffs.id })
        .from(integrationSyncContinuationHandoffs)
        .where(eq(integrationSyncContinuationHandoffs.integrationId, INTEGRATION_ID)),
    ).resolves.toEqual([{ id: firstRow.id }]);

    const [firstClaim] = await adminClaimPendingIntegrationSyncContinuations(
      db as never,
      INTEGRATION_ID,
    );
    if (!firstClaim) throw new Error('first Monday handoff claim missing');
    await expect(
      adminAcknowledgePendingIntegrationSyncContinuation(
        db as never,
        firstClaim.handoffId,
        firstClaim.claimToken,
      ),
    ).resolves.toBe(true);

    await commit();
    const [successor] = await adminClaimPendingIntegrationSyncContinuations(
      db as never,
      INTEGRATION_ID,
    );
    if (!successor) throw new Error('Monday continuation successor missing');
    expect(successor).toMatchObject({ continuation });
    expect(successor.handoffId).not.toBe(firstRow.id);
  });

  it('rolls back a Monday cursor when its exact continuation cannot be staged', async () => {
    await pg.exec(`
      ALTER TABLE integration_sync_continuation_handoffs
      ADD CONSTRAINT monday_continuation_fault_injection
      CHECK (external_id <> 'cannot-stage-monday-continuation')
    `);

    await expect(
      adminCommitIntegrationSyncCheckpoint(db as never, {
        integrationId: INTEGRATION_ID,
        cursors: [
          {
            resourceType: 'monday.board:board-1',
            cursor: { item_page_cursor: 'cursor-2' },
          },
        ],
        continuations: [
          {
            resourceType: 'monday.item',
            externalId: 'cannot-stage-monday-continuation',
          },
        ],
      }),
    ).rejects.toThrow();

    await expect(
      adminLoadCursor(db as never, INTEGRATION_ID, 'monday.board:board-1'),
    ).resolves.toEqual({});
    await expect(
      db
        .select()
        .from(integrationSyncContinuationHandoffs)
        .where(eq(integrationSyncContinuationHandoffs.integrationId, INTEGRATION_ID)),
    ).resolves.toEqual([]);
  });
});
