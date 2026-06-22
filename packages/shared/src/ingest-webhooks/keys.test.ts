import { PGlite } from '@electric-sql/pglite';
import { ingestWebhookCredentials, ingestWebhooks } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { hashCredential, mintCredential, resolveCredential } from '#src/ingest-webhooks/keys.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'tli_test_ingest_webhook_key_for_resolution';

describe('ingest webhook credentials', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${TEAM_ID}', 'webhook-team', 'Webhook Team');
      INSERT INTO users (id, email)
      VALUES ('${USER_ID}', 'owner@example.com');
    `);
  });

  it('mints tli-prefixed credentials and resolves active webhook credentials', async () => {
    const minted = mintCredential();
    expect(minted.plaintext).toMatch(/^tli_/);
    expect(minted.prefix).toBe(minted.plaintext.slice(0, 12));

    const [webhook] = await db
      .insert(ingestWebhooks)
      .values({
        teamId: TEAM_ID,
        ownerUserId: USER_ID,
        name: 'Pipedrive webhook',
        visibilityDefault: 'private',
        proposalGenerationEnabled: false,
      })
      .returning();
    if (!webhook) throw new Error('webhook insert failed');
    const [credential] = await db
      .insert(ingestWebhookCredentials)
      .values({
        teamId: TEAM_ID,
        webhookId: webhook.id,
        createdByUserId: USER_ID,
        keyHash: hashCredential(TOKEN),
        keyPrefix: TOKEN.slice(0, 12),
      })
      .returning();
    if (!credential) throw new Error('credential insert failed');

    await expect(resolveCredential(db as never, TOKEN)).resolves.toMatchObject({
      teamId: TEAM_ID,
      webhookId: webhook.id,
      credentialId: credential.id,
      name: 'Pipedrive webhook',
      ownerUserId: USER_ID,
      visibilityDefault: 'private',
      proposalGenerationEnabled: false,
    });

    await expect(resolveCredential(db as never, 'tli_wrong')).resolves.toBeNull();
  });

  it('does not resolve revoked credentials or disabled webhooks', async () => {
    const [webhook] = await db
      .insert(ingestWebhooks)
      .values({ teamId: TEAM_ID, ownerUserId: USER_ID, name: 'Disabled webhook' })
      .returning();
    if (!webhook) throw new Error('webhook insert failed');
    await db.insert(ingestWebhookCredentials).values({
      teamId: TEAM_ID,
      webhookId: webhook.id,
      createdByUserId: USER_ID,
      keyHash: hashCredential(TOKEN),
      keyPrefix: TOKEN.slice(0, 12),
      revokedAt: new Date(),
    });

    await expect(resolveCredential(db as never, TOKEN)).resolves.toBeNull();

    await db
      .update(ingestWebhooks)
      .set({ disabledAt: new Date() })
      .where(eq(ingestWebhooks.id, webhook.id));
    await db
      .update(ingestWebhookCredentials)
      .set({ revokedAt: null })
      .where(eq(ingestWebhookCredentials.webhookId, webhook.id));
    await expect(resolveCredential(db as never, TOKEN)).resolves.toBeNull();
  });
});
