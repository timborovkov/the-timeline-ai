import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import {
  integrations,
  integrationSelections,
  integrationSyncState,
  integrationWebhookDeliveryTargets,
  teams,
} from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptJson, resetSecretsKeyCacheForTests } from '#src/crypto/secrets.js';
import { resetEnvForTests } from '#src/env.js';
import { acceptSignedSlackNativeEvent } from '#src/integrations/slack-ingress.js';
import { applyDbMigrations } from '#src/test/pglite.js';

describe('signed native Slack routing', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;
  const payload = {
    type: 'event_callback',
    team_id: 'T1',
    api_app_id: 'A1',
    event_id: 'E1',
    event: { type: 'message', channel: 'C1', ts: '1782000000.000100', text: 'Test' },
  };
  beforeEach(async () => {
    vi.stubEnv('SECRETS_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
  }, 60_000);
  afterEach(async () => {
    await pg.close();
    vi.unstubAllEnvs();
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
  });
  async function connect(account: string, app: string, channel: string) {
    const team = randomUUID();
    const id = randomUUID();
    await db.insert(teams).values({ id: team, slug: team, name: team });
    const secret = encryptJson({
      app_id: app,
      authed_user: { access_token: 'user-token', scope: 'channels:history,groups:history' },
      scope: 'channels:history,groups:history,reactions:read,files:read',
    });
    await db.insert(integrations).values({
      id,
      teamId: team,
      provider: 'slack',
      displayName: 'Slack',
      externalAccountId: account,
      authSecretCiphertext: secret.ciphertext,
      authSecretIv: secret.iv,
      authSecretTag: secret.tag,
    });
    await db
      .insert(integrationSelections)
      .values({ integrationId: id, selectionKind: 'slack.channel', externalId: channel });
    return id;
  }
  it('routes only the matching account, app, and selected channel and deduplicates delivery', async () => {
    const selected = await connect('T1', 'A1', 'C1');
    await connect('T2', 'A1', 'C1');
    await connect('T1', 'A2', 'C1');
    await connect('T1', 'A1', 'C2');
    const first = await acceptSignedSlackNativeEvent(db as never, payload);
    expect(first).toBeTruthy();
    expect(await acceptSignedSlackNativeEvent(db as never, payload)).toBe(first);
    expect(
      (await db.select().from(integrationWebhookDeliveryTargets)).map((row) => row.integrationId),
    ).toEqual([selected]);
    expect((await db.select().from(integrationSyncState)).map((row) => row.integrationId)).toEqual([
      selected,
    ]);
  });
  it('does not activate OAuth-only connections or unknown channels', async () => {
    await connect('T1', 'A1', 'C2');
    expect(await acceptSignedSlackNativeEvent(db as never, payload)).toBeNull();
    expect(await db.select().from(integrationSyncState)).toEqual([]);
  });
});
