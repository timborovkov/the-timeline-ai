import { ingestWebhookCredentials, type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { resolveCredential } from '#src/ingest-webhooks/keys.js';
import { AGENT_MEMORY_WEBHOOK_NAME } from '#src/ingest-webhooks/scope.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let testDb: ResettablePGliteTestDb;
let db: Db;

beforeAll(async () => {
  testDb = await createResettablePGliteTestDb(async (pg) => {
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${TEAM_ID}', 'webhook-team', 'Webhook Team');
      INSERT INTO users (id, email, name)
      VALUES ('${USER_ID}', 'owner@example.test', 'Owner');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
    `);
  });
  db = drizzle(testDb.pg) as unknown as Db;
});

beforeEach(async () => {
  await testDb.reset();
});

afterAll(async () => {
  await testDb.close();
});

describe('agent memory webhook', () => {
  it('creates the named webhook once through withTeam', async () => {
    const scope = withTeam(db, TEAM_ID, USER_ID).ingestWebhooks;
    const created = await scope.createAgentMemoryWebhook();
    expect(created.created).toBe(true);
    if (!created.created) throw new Error('expected plaintext');
    expect(created.webhook.name).toBe(AGENT_MEMORY_WEBHOOK_NAME);
    expect(created.webhook.eventClass).toBe('communication');
    expect(created.plaintext.length).toBeGreaterThan(8);

    const existing = await scope.createAgentMemoryWebhook();
    expect(existing.created).toBe(false);
    expect(existing.webhook.id).toBe(created.webhook.id);

    const credentials = await db
      .select({ prefix: ingestWebhookCredentials.keyPrefix })
      .from(ingestWebhookCredentials)
      .where(eq(ingestWebhookCredentials.webhookId, created.webhook.id));
    expect(credentials).toHaveLength(1);
    expect(await resolveCredential(db, created.plaintext)).toMatchObject({
      name: AGENT_MEMORY_WEBHOOK_NAME,
      visibilityDefault: 'team',
    });
  });
});
