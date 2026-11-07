import { type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { beforeAll, beforeEach, afterAll, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import {
  createProvisioningGrant,
  listProvisioningGrants,
  provisionWorkspace,
  revokeProvisioningGrant,
  pruneAgentCredentials,
} from '#src/agent-provisioning/index.js';
import { resetSecretsKeyCacheForTests } from '#src/crypto/secrets.js';
import { resetEnvForTests } from '#src/env.js';
import { TERMS_VERSION, PRIVACY_VERSION } from '#src/legal-versions.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const team = '11111111-1111-4111-8111-111111111111';
let fixture: ResettablePGliteTestDb;
let db: Db;
const oldKey = process.env.SECRETS_ENCRYPTION_KEY;
const input = { name: 'New workspace', agentName: 'Coworker', timezone: 'UTC' };
beforeAll(async () => {
  process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
  resetEnvForTests();
  resetSecretsKeyCacheForTests();
  fixture = await createResettablePGliteTestDb(async (pg) => {
    await pg.exec(
      `INSERT INTO users (id,email,"emailVerified",legal_terms_version,legal_privacy_version,legal_accepted_at) VALUES ('${owner}','owner@example.test',now(),'${TERMS_VERSION}','${PRIVACY_VERSION}',now()); INSERT INTO teams(id,name,slug) VALUES ('${team}','Existing','existing'); INSERT INTO team_members(team_id,user_id,role) VALUES ('${team}','${owner}','owner');`,
    );
  });
  db = drizzle(fixture.pg) as unknown as Db;
});
beforeEach(async () => {
  await fixture.reset();
});
afterAll(async () => {
  await fixture.close();
  if (oldKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = oldKey;
  resetEnvForTests();
  resetSecretsKeyCacheForTests();
});

describe('owner delegated provisioning', () => {
  it('creates once, recovers the same scoped credential and rejects a changed retry', async () => {
    const grant = await createProvisioningGrant(db, owner, { name: 'Agent', allowCapture: true });
    const first = (await provisionWorkspace(db, grant.token, 'request-1', input)) as {
      credential: string;
      workspace: { id: string };
      connection: { scopes: string[] };
    };
    expect(first.credential).toMatch(/^tla_/);
    expect(first.connection.scopes).toEqual(['read', 'capture']);
    expect(first.workspace.id).not.toBe(team);
    expect(await provisionWorkspace(db, grant.token, 'request-1', input)).toEqual(first);
    await expect(
      provisionWorkspace(db, grant.token, 'request-1', { ...input, name: 'Other' }),
    ).rejects.toThrow('idempotency_conflict');
    expect((await listProvisioningGrants(db, owner))[0]?.used).toBe(1);
    const stored = await fixture.pg.query<{ response_ciphertext: string }>(
      'select response_ciphertext from agent_provisioning_receipts',
    );
    expect(stored.rows[0]?.response_ciphertext).not.toContain(first.credential);
  });
  it('does not grant capture implicitly, and enforces allowance and credential separation', async () => {
    const grant = await createProvisioningGrant(db, owner, { name: 'Agent' });
    const first = (await provisionWorkspace(db, grant.token, 'one', input)) as {
      credential: string;
      connection: { scopes: string[] };
    };
    expect(first.connection.scopes).toEqual(['read']);
    await expect(provisionWorkspace(db, first.credential, 'two', input)).rejects.toThrow(
      'invalid_credential',
    );
    await expect(provisionWorkspace(db, grant.token, 'two', input)).rejects.toThrow(
      'workspace_allowance_reached',
    );
    await expect(
      provisionWorkspace(db, grant.token, 'three', { ...input, teamId: team }),
    ).rejects.toThrow();
  });
  it('rejects unverified owners and revoked grants without deleting created workspaces', async () => {
    const grant = await createProvisioningGrant(db, owner, { name: 'Agent' });
    const first = (await provisionWorkspace(db, grant.token, 'one', input)) as {
      workspace: { id: string };
    };
    await revokeProvisioningGrant(db, owner, grant.id);
    await expect(provisionWorkspace(db, grant.token, 'one', input)).rejects.toThrow(
      'grant_unavailable',
    );
    expect(
      (
        await fixture.pg.query(
          "select id from agent_provisioning_audit where action='provision.attempt'",
        )
      ).rows.length,
    ).toBe(1);
    expect(
      (await fixture.pg.query('select id from teams where id=$1', [first.workspace.id])).rows
        .length,
    ).toBe(1);
    await fixture.pg.exec('update users set "emailVerified"=null');
    await expect(createProvisioningGrant(db, owner, { name: 'Agent' })).rejects.toThrow(
      'verified_owner_required',
    );
  });
  it('expires recovery without creating another workspace and removes encrypted receipts', async () => {
    const grant = await createProvisioningGrant(db, owner, { name: 'Agent' });
    await provisionWorkspace(db, grant.token, 'one', input);
    await fixture.pg.exec(
      "update agent_provisioning_receipts set expires_at=now()-interval '1 minute'",
    );
    await pruneAgentCredentials(db);
    await expect(provisionWorkspace(db, grant.token, 'one', input)).rejects.toThrow(
      'receipt_expired',
    );
    expect((await listProvisioningGrants(db, owner))[0]?.used).toBe(1);
  });
  it('serializes concurrent retries and rejects expired or demoted owners', async () => {
    const grant = await createProvisioningGrant(db, owner, { name: 'Agent' });
    const [first, retry] = await Promise.all([
      provisionWorkspace(db, grant.token, 'same', input),
      provisionWorkspace(db, grant.token, 'same', input),
    ]);
    expect(first).toEqual(retry);
    expect((await listProvisioningGrants(db, owner))[0]?.used).toBe(1);
    await fixture.pg.exec(
      "update agent_provisioning_grants set expires_at=now()-interval '1 second'",
    );
    await expect(provisionWorkspace(db, grant.token, 'same', input)).rejects.toThrow(
      'grant_unavailable',
    );
    await fixture.pg.exec("update team_members set role='member'");
    await expect(createProvisioningGrant(db, owner, { name: 'Agent' })).rejects.toThrow(
      'owner_required',
    );
  });
  it('rejects a soft-removed owner whose role is still owner', async () => {
    await fixture.pg.exec('update team_members set removed_at=now()');
    await expect(createProvisioningGrant(db, owner, { name: 'Agent' })).rejects.toThrow(
      'owner_required',
    );
    await fixture.pg.exec('update team_members set removed_at=null');
    const grant = await createProvisioningGrant(db, owner, { name: 'Agent' });
    await fixture.pg.exec('update team_members set removed_at=now()');
    await expect(provisionWorkspace(db, grant.token, 'removed', input)).rejects.toThrow(
      'owner_required',
    );
  });
  it('rolls back workspace and connection creation when receipt encryption fails', async () => {
    const grant = await createProvisioningGrant(db, owner, { name: 'Agent' });
    process.env.SECRETS_ENCRYPTION_KEY = 'invalid';
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
    try {
      await expect(provisionWorkspace(db, grant.token, 'rollback', input)).rejects.toThrow();
      expect((await listProvisioningGrants(db, owner))[0]?.used).toBe(0);
      expect((await fixture.pg.query('select id from teams')).rows.length).toBe(1);
      expect((await fixture.pg.query('select id from mcp_outbound_keys')).rows.length).toBe(0);
    } finally {
      process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
      resetEnvForTests();
      resetSecretsKeyCacheForTests();
    }
  });
  it('does not issue another Free allowance and rejects elevated provisioning input', async () => {
    const grant = await createProvisioningGrant(db, owner, { name: 'Two projects', allowance: 2 });
    const first = (await provisionWorkspace(db, grant.token, 'first', input)) as {
      billing: { restricted: boolean };
    };
    const second = (await provisionWorkspace(db, grant.token, 'second', {
      ...input,
      name: 'Second project',
    })) as { billing: { restricted: boolean } };
    expect(first.billing.restricted).toBe(false);
    expect(second.billing.restricted).toBe(true);
    await expect(
      provisionWorkspace(db, grant.token, 'elevated', { ...input, scopes: ['agent:ask'] }),
    ).rejects.toThrow();
    await expect(
      createProvisioningGrant(db, owner, { name: 'Too many', allowance: 11 }),
    ).rejects.toThrow();
    await expect(
      createProvisioningGrant(db, owner, { name: 'Too long', days: 31 }),
    ).rejects.toThrow();
    await expect(
      createProvisioningGrant(db, owner, { name: 'Too short', days: 0 }),
    ).rejects.toThrow();
    expect(
      (await createProvisioningGrant(db, owner, { name: 'One day', days: 1 })).id,
    ).toBeDefined();
    expect(
      (await createProvisioningGrant(db, owner, { name: 'Thirty days', days: 30 })).id,
    ).toBeDefined();
  });
  it('counts matching receipt retries toward the owner-wide hourly limit', async () => {
    const grant = await createProvisioningGrant(db, owner, { name: 'Agent' });
    const first = await provisionWorkspace(db, grant.token, 'same', input);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(await provisionWorkspace(db, grant.token, 'same', input)).toEqual(first);
    }
    await expect(provisionWorkspace(db, grant.token, 'same', input)).rejects.toThrow(
      'rate_limited',
    );
  });
  it('limits attempts across grants owned by the same person', async () => {
    const grant = await createProvisioningGrant(db, owner, { name: 'Agent' });
    const other = await createProvisioningGrant(db, owner, { name: 'Other' });
    await fixture.pg.exec(
      `INSERT INTO agent_provisioning_audit(owner_id,action) SELECT '${owner}','provision.attempt' FROM generate_series(1,5)`,
    );
    await expect(provisionWorkspace(db, grant.token, 'one', input)).rejects.toThrow('rate_limited');
    await expect(provisionWorkspace(db, other.token, 'two', input)).rejects.toThrow('rate_limited');
  });
});
