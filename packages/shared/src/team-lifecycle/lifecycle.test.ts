/** Exercise real migrations and tenant state: deletion must never damage another team or reopen access. */
import { PGlite } from '@electric-sql/pglite';
import { teams, teamMembers, teamBillingAccounts, schema, type Db } from '@timeline/db';
import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { eq, is, Table } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';

import { BILLING_SYSTEM_USER_ID } from '#src/billing/context.js';
import { recordedChargesForPeriod } from '#src/billing/presentation.js';
import { settleTeamPreDisableDailyUsage } from '#src/billing/runtime.js';
import { encryptJson } from '#src/crypto/secrets.js';
import { resetEnvForTests } from '#src/env.js';
import { mondayProvider } from '#src/integrations/providers/monday.js';
import { ProviderAuthorizationError } from '#src/integrations/types.js';
import { getMeetingBotProvider, resetMeetingBotProviderForTests } from '#src/meeting-bots/index.js';
import { setPlatformSuspension, listPlatformTeams } from '#src/platform-admin/index.js';
import {
  assertActivePrincipal,
  registerOperatorContextResolver,
} from '#src/platform-admin/runtime.js';
import { beginTeamDeletion, retryTeamLifecycle } from '#src/team-lifecycle/admin.js';
import {
  PURGED_TEAM_TABLES,
  RETAINED_TEAM_TABLES,
  INDIRECT_AND_ACCOUNT_TABLES,
} from '#src/team-lifecycle/inventory.js';
import { processTeamLifecycle } from '#src/team-lifecycle/processor.js';
import { purgeTeamRows, verifyTeamRows } from '#src/team-lifecycle/purge.js';
import { teamOwnsStorageKey } from '#src/team-lifecycle/storage.js';
import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const ADMIN = '11111111-2222-4333-8444-555555555555';
const OWNER = '22222222-3333-4444-8555-666666666666';
const TEAM = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef';
const actor = { userId: ADMIN, email: 'ops@example.test' };
let pg: PGlite;
let db: Db;
beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg) as unknown as Db;
  await pg.exec(
    `INSERT INTO users (id,email,"emailVerified") VALUES ('${ADMIN}','ops@example.test',now()),('${OWNER}','owner@example.test',now()); INSERT INTO teams (id,name,slug,inbound_email) VALUES ('${TEAM}','First','first','first@example.test'),('${OTHER}','Other','other','other@example.test'); INSERT INTO team_members (team_id,user_id,role) VALUES ('${TEAM}','${OWNER}','owner'),('${OTHER}','${OWNER}','owner');`,
  );
  process.env.PLATFORM_ADMIN_EMAILS = actor.email;
  resetEnvForTests();
  registerOperatorContextResolver(() => Promise.resolve(null));
});
afterEach(async () => {
  await pg.close();
  delete process.env.PLATFORM_ADMIN_EMAILS;
  resetEnvForTests();
});

describe('team lifecycle', () => {
  it('retries unconfirmed website cancellation and settles captured pages once while disabled', async () => {
    const previousKey = process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_KEY = 'synthetic-test-key';
    resetEnvForTests();
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 503 }));
    try {
      const [source] = await db
        .insert(schema.websites)
        .values({
          teamId: TEAM,
          url: 'https://example.test',
          hostname: 'example.test',
          subject: 'own_team',
          createdBy: OWNER,
        })
        .returning();
      if (!source) throw new Error('Website fixture missing');
      const [run] = await db
        .insert(schema.websiteRuns)
        .values({
          teamId: TEAM,
          websiteId: source.id,
          requestedBy: OWNER,
          trigger: 'manual',
          idempotencyKey: 'cancel-fixture',
          providerStartedAt: new Date(),
        })
        .returning();
      if (!run) throw new Error('Website run fixture missing');
      await db.insert(schema.websiteSources).values({
        id: run.id,
        teamId: TEAM,
        url: 'https://example.test',
        websiteSubject: 'own_team',
        crawlId: 'synthetic-crawl',
        pages: [
          { url: 'https://example.test', title: 'Fixture', text: 'Captured before disabling' },
        ],
      });
      await setPlatformSuspension(db, actor, 'team', TEAM, true, 'Cancel provider fixture');
      const maintenance = withTeam(db, TEAM, BILLING_SYSTEM_USER_ID, {
        skipMembershipCheck: true,
      }).lifecycle;
      expect(await maintenance.stopWebsiteRuns()).toBe(false);
      expect((await db.select().from(schema.websiteRuns))[0]?.providerFinishedAt).toBeNull();
      request.mockResolvedValue(new Response('{"success":true}', { status: 200 }));
      expect(await maintenance.stopWebsiteRuns()).toBe(false);
      expect(await maintenance.stopWebsiteRuns()).toBe(true);
      const ledger = await db.select().from(schema.billingUsageLedger);
      expect(ledger.filter((row) => row.operationId === `website-scan:${run.id}`)).toHaveLength(1);
      expect((await db.select().from(schema.websiteRuns))[0]?.sourceUnits).toBe(20);
    } finally {
      request.mockRestore();
      if (previousKey === undefined) delete process.env.FIRECRAWL_API_KEY;
      else process.env.FIRECRAWL_API_KEY = previousKey;
      resetEnvForTests();
    }
  });
  it('stops website runs while disabled and erases their records without touching another team', async () => {
    for (const teamId of [TEAM, OTHER]) {
      const [source] = await db
        .insert(schema.websites)
        .values({
          teamId,
          url: 'https://example.test',
          hostname: 'example.test',
          subject: 'own_team',
          createdBy: OWNER,
        })
        .returning();
      if (!source) throw new Error('Website fixture missing');
      const [run] = await db
        .insert(schema.websiteRuns)
        .values({
          teamId,
          websiteId: source.id,
          requestedBy: OWNER,
          trigger: 'manual',
          idempotencyKey: 'fixture',
        })
        .returning();
      if (!run) throw new Error('Website run fixture missing');
      await db
        .insert(schema.websitePages)
        .values({ teamId, websiteId: source.id, url: 'https://example.test' });
      await db
        .insert(schema.websiteNotifications)
        .values({ teamId, runId: run.id, ciphertext: 'fixture', iv: 'fixture', tag: 'fixture' });
    }
    await setPlatformSuspension(db, actor, 'team', TEAM, true, 'Pause website fixtures');
    const maintenance = withTeam(db, TEAM, BILLING_SYSTEM_USER_ID, {
      skipMembershipCheck: true,
    }).lifecycle;
    expect(await maintenance.stopWebsiteRuns()).toBe(false);
    expect(await maintenance.stopWebsiteRuns()).toBe(true);
    const runs = await db.select().from(schema.websiteRuns);
    expect(runs.find((run) => run.teamId === TEAM)?.finishedAt).toBeInstanceOf(Date);
    expect(runs.find((run) => run.teamId === OTHER)?.status).toBe('queued');
    for (const table of [
      schema.websites,
      schema.websiteRuns,
      schema.websitePages,
      schema.websiteNotifications,
    ]) {
      await expect(
        db.update(table).set({ teamId: TEAM }).where(eq(table.teamId, TEAM)),
      ).rejects.toThrow();
    }
    await setPlatformSuspension(db, actor, 'team', TEAM, false, 'Restore website fixtures');
    expect(await withTeam(db, TEAM, OWNER).websites.list()).toHaveLength(1);
    await beginTeamDeletion(db, actor, {
      teamId: TEAM,
      confirmation: 'First',
      reason: 'Erase website fixtures',
    });
    let done = false;
    for (let tick = 0; tick < 8 && !done; tick++) done = await purgeTeamRows(db, TEAM);
    expect(done).toBe(true);
    await verifyTeamRows(db, TEAM);
    for (const table of [
      schema.websites,
      schema.websiteRuns,
      schema.websitePages,
      schema.websiteNotifications,
    ]) {
      expect(await db.select().from(table).where(eq(table.teamId, OTHER))).toHaveLength(1);
    }
  });

  it('erases repeated document and folder names without flattening namespaces', async () => {
    await pg.exec(`INSERT INTO folders (id,team_id,name) VALUES
      ('20000000-0000-4000-8000-000000000001','${TEAM}','Parent A'),
      ('20000000-0000-4000-8000-000000000002','${TEAM}','Parent B');
      INSERT INTO folders (team_id,name,parent_folder_id) VALUES
      ('${TEAM}','Same subfolder','20000000-0000-4000-8000-000000000001'),
      ('${TEAM}','Same subfolder','20000000-0000-4000-8000-000000000002');
      INSERT INTO documents (team_id,name,folder_id) VALUES
      ('${TEAM}','Same document','20000000-0000-4000-8000-000000000001'),
      ('${TEAM}','Same document','20000000-0000-4000-8000-000000000002');`);
    await beginTeamDeletion(db, actor, {
      teamId: TEAM,
      confirmation: 'First',
      reason: 'Erase hierarchy fixture',
    });
    let done = false;
    for (let tick = 0; tick < 8 && !done; tick++) done = await purgeTeamRows(db, TEAM);
    expect(done).toBe(true);
    await verifyTeamRows(db, TEAM);
  });
  it('retains financial reconciliation evidence while removing content metadata', async () => {
    await db.insert(schema.billingUsageLedger).values({
      teamId: TEAM,
      operationId: 'financial-fixture',
      kind: 'settlement',
      meterId: 'ai',
      nativeUnits: '1',
      customerChargeCents: 100,
      metadata: {
        invoice_cents: 75,
        discount_cents: 25,
        usage_at: '2026-10-20T12:00:00Z',
        pricing_plan_id: 'payg',
        polar_ingest_status: 'sent',
        private_content: 'Erase this content',
        credentials: 'Erase this secret',
      },
    });
    const before = await db.select().from(schema.billingUsageLedger);
    const period = { start: '2026-10-01T00:00:00Z', end: '2026-11-01T00:00:00Z' };
    const expected = recordedChargesForPeriod(before, period);
    expect(expected?.totalCents).toBe(75);
    await beginTeamDeletion(db, actor, {
      teamId: TEAM,
      confirmation: 'First',
      reason: 'Financial retention fixture',
    });
    await withTeam(db, TEAM, BILLING_SYSTEM_USER_ID, {
      skipMembershipCheck: true,
    }).lifecycle.purgeIndirect({});
    const after = await db.select().from(schema.billingUsageLedger);
    expect(recordedChargesForPeriod(after, period)).toEqual(expected);
    expect(after[0]?.metadata).not.toHaveProperty('private_content');
    expect(after[0]?.metadata).not.toHaveProperty('credentials');
    expect(after[0]?.metadata.polar_ingest_status).toBe('sent');
  });
  it('records inaccessible provider cleanup and continues local erasure', async () => {
    const oldKey = process.env.SECRETS_ENCRYPTION_KEY;
    process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
    resetEnvForTests();
    const stop = vi
      .spyOn(
        mondayProvider as typeof mondayProvider & {
          deprovisionWebhook: NonNullable<typeof mondayProvider.deprovisionWebhook>;
        },
        'deprovisionWebhook',
      )
      .mockRejectedValue(new ProviderAuthorizationError('monday'));
    try {
      const secret = encryptJson({ access_token: 'synthetic' });
      const [source] = await db
        .insert(schema.integrations)
        .values({
          teamId: TEAM,
          provider: 'monday',
          displayName: 'Synthetic',
          authSecretCiphertext: secret.ciphertext,
          authSecretIv: secret.iv,
          authSecretTag: secret.tag,
        })
        .returning();
      if (!source) throw new Error('Missing fixture integration');
      await db.insert(schema.integrationWebhookSubscriptions).values({
        integrationId: source.id,
        provider: 'monday',
        externalSubscriptionId: 'synthetic-webhook',
        resourceKind: 'monday.board',
        externalResourceId: 'synthetic-board',
        eventType: 'create_item',
        status: 'active',
      });
      await beginTeamDeletion(db, actor, {
        teamId: TEAM,
        confirmation: 'First',
        reason: 'Revoked provider fixture',
      });
      const io = {
        objects: () => Promise.resolve(true),
        vectors: () => Promise.resolve(),
        queues: () => Promise.resolve(true),
      };
      for (let tick = 0; tick < 6; tick++) await processTeamLifecycle(db, io);
      const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
      expect(team?.lifecycleWork.stage).toBe('verify');
      expect(
        team?.lifecycleWork.followups?.find((item) => item.category === 'processors'),
      ).toMatchObject({
        status: 'pending',
        reference: expect.stringContaining('synthetic-webhook') as string,
      });
      expect(await db.select().from(schema.integrations)).toHaveLength(0);
      await expect(assertActivePrincipal(db, TEAM)).rejects.toThrow();
    } finally {
      stop.mockRestore();
      if (oldKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
      else process.env.SECRETS_ENCRYPTION_KEY = oldKey;
      resetEnvForTests();
    }
  });
  it('reconnects shared credentials without modifying disabled integrations or attention', async () => {
    const oldKey = process.env.SECRETS_ENCRYPTION_KEY;
    process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
    resetEnvForTests();
    try {
      const scope = withTeam(db, OTHER, OWNER).integrations;
      const input = {
        provider: 'monday' as const,
        displayName: 'Fixture',
        externalAccountId: 'shared',
        tokens: { access_token: 'synthetic' },
      };
      const connection = await scope.upsertProviderConnection(input);
      const sources = await db
        .insert(schema.integrations)
        .values(
          [TEAM, OTHER].map((teamId) => ({
            teamId,
            provider: 'monday' as const,
            displayName: 'Old',
            providerConnectionId: connection.id,
            lastError: 'reconnect required',
          })),
        )
        .returning();
      await db.insert(schema.connectionAttention).values(
        sources.map((source) => ({
          teamId: source.teamId,
          integrationId: source.id,
          providerConnectionId: connection.id,
          category: 'needs_reconnect' as const,
          summary: 'Synthetic reconnect',
        })),
      );
      await setPlatformSuspension(db, actor, 'team', TEAM, true, 'Pause fixture');
      await scope.upsertProviderConnection({ ...input, displayName: 'Fresh' });
      const rows = await db.select().from(schema.integrations);
      expect(rows.find((row) => row.teamId === OTHER)?.lastError).toBeNull();
      expect(rows.find((row) => row.teamId === TEAM)?.lastError).toBe('reconnect required');
      const attention = await db.select().from(schema.connectionAttention);
      expect(attention.find((row) => row.teamId === OTHER)?.resolvedAt).not.toBeNull();
      expect(attention.find((row) => row.teamId === TEAM)?.resolvedAt).toBeNull();
      // Personal-connection attention can outlive its last team integration.
      await db.delete(schema.integrations).where(eq(schema.integrations.teamId, OTHER));
      await db
        .update(schema.connectionAttention)
        .set({ resolvedAt: null })
        .where(eq(schema.connectionAttention.teamId, OTHER));
      await scope.upsertProviderConnection(input);
      const remainingAttention = await db.select().from(schema.connectionAttention);
      expect(remainingAttention.find((row) => row.teamId === OTHER)?.resolvedAt).not.toBeNull();
      expect(remainingAttention.find((row) => row.teamId === TEAM)?.resolvedAt).toBeNull();
      await expect(assertActivePrincipal(db, TEAM)).rejects.toThrow('disabled');
    } finally {
      if (oldKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
      else process.env.SECRETS_ENCRYPTION_KEY = oldKey;
      resetEnvForTests();
    }
  });
  it('allows an owner to remove a personal connection shared with a disabled team', async () => {
    const id = '20000000-0000-4000-8000-000000000003';
    await db.insert(schema.providerConnections).values({
      id,
      ownerUserId: OWNER,
      provider: 'mcp',
      displayName: 'Fixture',
      externalAccountId: id,
      authSecretCiphertext: Buffer.from('fixture'),
      authSecretIv: Buffer.alloc(12),
      authSecretTag: Buffer.alloc(16),
    });
    await db.insert(schema.integrations).values(
      [TEAM, OTHER].map((teamId) => ({
        teamId,
        provider: 'mcp' as const,
        displayName: 'Fixture source',
        providerConnectionId: id,
      })),
    );
    await setPlatformSuspension(db, actor, 'team', TEAM, true, 'Pause fixture');
    expect(await withTeam(db, OTHER, OWNER).integrations.deleteOwnedProviderConnection(id)).toBe(
      true,
    );
    expect(await db.select().from(schema.providerConnections)).toHaveLength(0);
    const sources = await db.select().from(schema.integrations);
    expect(sources.every((row) => !row.enabled && row.providerConnectionId === null)).toBe(true);
    expect(
      await db
        .select()
        .from(schema.connectionAttention)
        .where(eq(schema.connectionAttention.teamId, TEAM)),
    ).toHaveLength(0);
    await expect(
      pg.exec(`UPDATE integrations SET enabled=true WHERE team_id='${TEAM}'`),
    ).rejects.toThrow('disabled');
  });
  it('does not expose a restorable gap before permanent deletion is committed', async () => {
    const transaction = db.transaction.bind(db);
    // Simulate another admin restoring any externally visible pause-only commit.
    const spy = vi.spyOn(db, 'transaction').mockImplementation(async (...args) => {
      const result = await transaction(...args);
      const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
      if (team?.disabledAt && !team.deletionStartedAt) {
        spy.mockRestore();
        await setPlatformSuspension(db, actor, 'team', TEAM, false, 'Concurrent restore');
      }
      return result;
    });
    try {
      await beginTeamDeletion(db, actor, {
        teamId: TEAM,
        confirmation: 'First',
        reason: 'Concurrent deletion fixture',
      });
      const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
      expect(team?.deletionStartedAt).not.toBeNull();
      expect(team?.disabledAt).not.toBeNull();
      expect(team?.lifecycleWork.billingPending).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
  it('erases merged objects when their old canonical name has been reused', async () => {
    await pg.exec(`INSERT INTO entities (id,team_id,type,canonical_name) VALUES
      ('10000000-0000-4000-8000-000000000001','${TEAM}','project','Survivor');
      INSERT INTO entities (team_id,type,canonical_name,merged_into_id) VALUES
      ('${TEAM}','project','Reused name','10000000-0000-4000-8000-000000000001');
      INSERT INTO entities (team_id,type,canonical_name) VALUES ('${TEAM}','project','Reused name'),('${OTHER}','project','Reused name');`);
    await beginTeamDeletion(db, actor, {
      teamId: TEAM,
      confirmation: 'First',
      reason: 'Fixture erasure',
    });
    let done = false;
    for (let tick = 0; tick < 6 && !done; tick++) done = await purgeTeamRows(db, TEAM);
    expect(done).toBe(true);
    await verifyTeamRows(db, TEAM);
    expect((await pg.query(`SELECT 1 FROM entities WHERE team_id='${OTHER}'`)).rows).toHaveLength(
      1,
    );
  });
  it('records consumed Recall minutes before cancelling an active bot', async () => {
    const previousKey = process.env.RECALL_API_KEY;
    process.env.RECALL_API_KEY = 'synthetic-recall-key';
    resetEnvForTests();
    resetMeetingBotProviderForTests();
    const leave = vi.spyOn(getMeetingBotProvider(), 'leaveMeeting').mockResolvedValue(undefined);
    try {
      const meetingId = '10000000-0000-4000-8000-000000000002';
      await pg.exec(`INSERT INTO meetings (id,team_id,platform,meeting_url,provider_bot_id,status,started_at) VALUES
        ('${meetingId}','${TEAM}','meet','https://meet.google.com/synthetic','synthetic-bot','active',now()-interval '5 minutes');
        INSERT INTO billing_usage_reservations (team_id,operation_id,meter_id,reserved_native_units,reserved_charge_cents,state,expires_at) VALUES
        ('${TEAM}','recall:${meetingId}','recall_minutes',30,100,'reserved',now()+interval '1 hour');`);
      await setPlatformSuspension(db, actor, 'team', TEAM, true, 'Stop fixture');
      await withTeam(db, TEAM, BILLING_SYSTEM_USER_ID, {
        skipMembershipCheck: true,
      }).lifecycle.stopBots();
      const [meeting] = (
        await pg.query<{ status: string; ended_at: Date }>(
          `SELECT status,ended_at FROM meetings WHERE id='${meetingId}'`,
        )
      ).rows;
      const [reservation] = (
        await pg.query<{ metadata: Record<string, unknown> }>(
          `SELECT metadata FROM billing_usage_reservations WHERE team_id='${TEAM}'`,
        )
      ).rows;
      expect(meeting?.status).toBe('cancelled');
      expect(meeting?.ended_at).not.toBeNull();
      expect(reservation?.metadata.pending_settlement).toBe(true);
      expect(Number(reservation?.metadata.pending_recall_minutes)).toBeGreaterThanOrEqual(5);
    } finally {
      leave.mockRestore();
      if (previousKey === undefined) delete process.env.RECALL_API_KEY;
      else process.env.RECALL_API_KEY = previousKey;
      resetMeetingBotProviderForTests();
      resetEnvForTests();
    }
  });
  it('settles missed active-day usage before deleting its source history', async () => {
    await pg.exec(`INSERT INTO team_billing_accounts (team_id,plan_id,billing_state,shadow_billing,price_override) VALUES ('${TEAM}','team','team_active',true,'{"includedActiveMembers":0}');
      UPDATE teams SET created_at=now()-interval '40 days', disabled_periods=jsonb_build_array(jsonb_build_object('start',now()-interval '1 day','end',now()-interval '12 hours')) WHERE id='${TEAM}';
      UPDATE team_members SET created_at=now()-interval '2 days' WHERE team_id='${TEAM}';
      INSERT INTO documents (id,team_id,name,created_at) VALUES ('10000000-0000-4000-8000-000000000003','${TEAM}','Historical file',now()-interval '2 days');
      INSERT INTO document_versions (team_id,document_id,version,object_key,byte_size,created_at) VALUES ('${TEAM}','10000000-0000-4000-8000-000000000003',1,'${TEAM}/fixture',1073741824,now()-interval '2 days');`);
    await beginTeamDeletion(db, actor, {
      teamId: TEAM,
      confirmation: 'First',
      reason: 'Settle history fixture',
    });
    const io = {
      objects: () => Promise.resolve(true),
      vectors: () => Promise.resolve(),
      queues: () => Promise.resolve(true),
    };
    await processTeamLifecycle(db, io);
    await processTeamLifecycle(db, io);
    const [checkpoint] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(checkpoint?.lifecycleWork.stage).toBe('stop');
    expect(checkpoint?.lifecycleWork.usageBackfillDay).toBeDefined();
    expect((await pg.query(`SELECT 1 FROM documents WHERE team_id='${TEAM}'`)).rows).toHaveLength(
      1,
    );
    for (let tick = 0; tick < 6; tick++) await processTeamLifecycle(db, io);
    const storage = (
      await pg.query(
        `SELECT 1 FROM billing_usage_ledger WHERE team_id='${TEAM}' AND meter_id='storage_gb_month'`,
      )
    ).rows;
    const members = (
      await pg.query(
        `SELECT 1 FROM billing_member_day_ledger WHERE team_id='${TEAM}' AND day < current_date::text`,
      )
    ).rows;
    expect(storage.length).toBeGreaterThan(0);
    expect(members.length).toBeGreaterThan(0);
    expect(
      (
        await pg.query(
          `SELECT 1 FROM billing_member_day_ledger WHERE team_id='${TEAM}' AND day=(current_date-1)::text`,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await pg.query(
          `SELECT 1 FROM billing_usage_ledger WHERE team_id='${TEAM}' AND meter_id='member_days' AND customer_charge_cents > 0`,
        )
      ).rows.length,
    ).toBeGreaterThan(0);
    expect(
      (
        await pg.query(
          `SELECT 1 FROM billing_member_day_ledger WHERE team_id='${TEAM}' AND day=current_date::text`,
        )
      ).rows,
    ).toHaveLength(0);
    const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(team?.lifecycleWork.stage).toBe('verify');
  });
  it('requires ownership and exact confirmation before immediately disabling', async () => {
    await expect(withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('Wrong')).rejects.toThrow(
      'exact team name',
    );
    await db.update(teamMembers).set({ role: 'member' }).where(eq(teamMembers.teamId, TEAM));
    await expect(withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('First')).rejects.toThrow(
      'Only team owners',
    );
    await db.update(teamMembers).set({ role: 'owner' }).where(eq(teamMembers.teamId, TEAM));
    await withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('First');
    const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(team?.lifecycleWork).toMatchObject({ billingPending: true, notificationPending: true });
    await expect(assertActivePrincipal(db, TEAM)).rejects.toThrow('disabled');
    await assertActivePrincipal(db, OTHER);
    await db.delete(teamBillingAccounts).where(eq(teamBillingAccounts.teamId, TEAM));
    await expect(assertActivePrincipal(db, TEAM)).rejects.toThrow('disabled');
    await expect(
      pg.exec(
        `INSERT INTO team_invites (team_id,email,role,token,invited_by_user_id,expires_at) VALUES ('${TEAM}','late@example.test','member','late','${OWNER}',now())`,
      ),
    ).rejects.toThrow('disabled');
  });
  it('backfills unknown historical suspensions without relying on billing for access', async () => {
    await pg.close();
    pg = new PGlite();
    await applyDbMigrations(pg, async (filename) => {
      if (filename !== '0104_team_lifecycle.sql') return;
      await pg.exec(`INSERT INTO users (id,email,"emailVerified") VALUES ('${ADMIN}','ops@example.test',now()),('${OWNER}','owner@example.test',now());
        INSERT INTO teams (id,name,slug,created_at) VALUES ('${TEAM}','First','legacy-first',now()-interval '5 days');
        INSERT INTO team_members (team_id,user_id,role,created_at) VALUES ('${TEAM}','${OWNER}','owner',now()-interval '5 days');
        INSERT INTO team_billing_accounts (team_id,security_state,plan_id,billing_state,shadow_billing,price_override) VALUES ('${TEAM}','suspended','team','team_active',true,'{"includedActiveMembers":0}');`);
    });
    db = drizzle(pg) as unknown as Db;
    const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(team?.lifecycleWork).toMatchObject({ disabledDateUnknown: true, billingPending: true });
    await beginTeamDeletion(db, actor, {
      teamId: TEAM,
      confirmation: 'First',
      reason: 'Unknown historical suspension fixture',
    });
    await settleTeamPreDisableDailyUsage({ db, teamId: TEAM });
    expect(
      (await pg.query(`SELECT 1 FROM billing_member_day_ledger WHERE team_id='${TEAM}'`)).rows,
    ).toHaveLength(0);
    await db.delete(teamBillingAccounts).where(eq(teamBillingAccounts.teamId, TEAM));
    await expect(assertActivePrincipal(db, TEAM)).rejects.toThrow('disabled');
  });
  it('rejects owner requests made through impersonation', async () => {
    registerOperatorContextResolver(() =>
      Promise.resolve({
        actorUserId: ADMIN,
        actorEmail: actor.email,
        effectiveUserId: OWNER,
        teamId: TEAM,
        sessionId: OTHER,
        readOnly: false,
      }),
    );
    await expect(withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('First')).rejects.toThrow(
      'administrator identity for account management',
    );
  });
  it('retains a request and retries notification failure independently of cancellation', async () => {
    const originalKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = '';
    resetEnvForTests();
    try {
      await withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('First');
      await processTeamLifecycle(db, {
        objects: () => Promise.resolve(true),
        vectors: () => Promise.resolve(),
        queues: () => Promise.resolve(true),
      });
      const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
      expect(team?.deletionRequestedAt).not.toBeNull();
      expect(team?.lifecycleWork.notificationPending).toBe(true);
      expect(team?.lifecycleWork.billingPending).toBe(false);
      await expect(assertActivePrincipal(db, TEAM)).rejects.toThrow('disabled');
    } finally {
      if (originalKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalKey;
      resetEnvForTests();
    }
  });
  it('restores without losing disabled-period history and clears the request', async () => {
    await withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('First');
    await setPlatformSuspension(db, actor, 'team', TEAM, false, 'Owner withdrew request');
    await assertActivePrincipal(db, TEAM);
    const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(team?.deletionRequestedAt).toBeNull();
    expect(team?.disabledPeriods[0]?.end).toBeDefined();
    expect(team?.lifecycleWork.billingPending).toBe(true);
  });
  it('preserves preexisting security restrictions when restoring a deletion request', async () => {
    await db.insert(teamBillingAccounts).values({ teamId: TEAM, securityState: 'restricted' });
    await withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('First');
    await setPlatformSuspension(db, actor, 'team', TEAM, false, 'Owner withdrew request');
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM));
    const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(account?.securityState).toBe('restricted');
    expect(team?.disabledAt).toBeNull();
    expect(team?.deletionRequestedAt).toBeNull();
    expect(team?.lifecycleWork.billingPending).toBe(true);
  });
  it('permanently deletes operational rows, retains the other team, and reserves old routes', async () => {
    await beginTeamDeletion(db, actor, {
      teamId: TEAM,
      confirmation: 'First',
      reason: 'Verified owner request',
    });
    await expect(setPlatformSuspension(db, actor, 'team', TEAM, false, 'Undo')).rejects.toThrow(
      'cannot be reversed',
    );
    let done = false;
    for (let attempt = 0; attempt < 6 && !done; attempt++) done = await purgeTeamRows(db, TEAM);
    expect(done).toBe(true);
    await verifyTeamRows(db, TEAM);
    const remaining = await db.select().from(teamMembers).where(eq(teamMembers.teamId, OTHER));
    expect(remaining).toHaveLength(1);
    await db
      .update(teams)
      .set({ slug: 'deleted-first', inboundEmail: null })
      .where(eq(teams.id, TEAM));
    await expect(pg.exec("INSERT INTO teams (name,slug) VALUES ('New','first')")).rejects.toThrow(
      'retired',
    );
  });
  it('settled recovery metadata and disconnected sources do not strand cleanup', async () => {
    await pg.exec(`INSERT INTO billing_usage_reservations (team_id,operation_id,meter_id,reserved_native_units,reserved_charge_cents,state,expires_at,metadata) VALUES ('${TEAM}','settled-fixture','ai',1,1,'settled',now(),'{"worker_settlement_pending":true}');
      INSERT INTO integrations (team_id,provider,display_name,enabled) VALUES ('${TEAM}','google_drive','Disconnected',false);`);
    await beginTeamDeletion(db, actor, {
      teamId: TEAM,
      confirmation: 'First',
      reason: 'Fixture cleanup',
    });
    const io = {
      objects: () => Promise.resolve(true),
      vectors: () => Promise.resolve(),
      queues: () => Promise.resolve(true),
    };
    for (let tick = 0; tick < 4; tick++) await processTeamLifecycle(db, io);
    const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(team?.lifecycleWork.error).toBeUndefined();
    expect(['purge', 'verify']).toContain(team?.lifecycleWork.stage);
  });
  it('keeps failed cleanup disabled and resumes without erasing the control team', async () => {
    await beginTeamDeletion(db, actor, {
      teamId: TEAM,
      confirmation: 'First',
      reason: 'Authorized fixture removal',
    });
    let fail = true;
    const io = {
      objects: () => {
        if (fail) return Promise.reject(new Error('provider secret must not be persisted'));
        return Promise.resolve(true);
      },
      queues: () => Promise.resolve(true),
      vectors: () => Promise.resolve(),
    };
    await processTeamLifecycle(db, io);
    await processTeamLifecycle(db, io);
    await processTeamLifecycle(db, io);
    const [failed] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(failed?.lifecycleWork.error).toBe('Cleanup step purge requires retry');
    expect(failed?.deletedAt).toBeNull();
    fail = false;
    await retryTeamLifecycle(db, actor, TEAM);
    for (let tick = 0; tick < 6; tick++) {
      await processTeamLifecycle(db, io);
      const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
      if (team?.lifecycleWork.stage === 'verify')
        await db
          .update(teams)
          .set({ lifecycleWork: { ...team.lifecycleWork, retryAt: new Date(0).toISOString() } })
          .where(eq(teams.id, TEAM));
    }
    const [completed] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(completed?.deletedAt).not.toBeNull();
    expect(completed?.name).toBe('Deleted team');
    expect(completed?.lifecycleWork.followups?.every((item) => item.status === 'pending')).toBe(
      true,
    );
    await assertActivePrincipal(db, OTHER);
  });
  it('does not expose maintenance methods through an ordinary owner scope', async () => {
    await expect(withTeam(db, TEAM, OWNER).lifecycle.purgeRows()).rejects.toThrow(
      'internal system scope',
    );
  });
  it('waits for bounded object batches and the upload expiry window before verifying late writes', async () => {
    await beginTeamDeletion(db, actor, {
      teamId: TEAM,
      confirmation: 'First',
      reason: 'Verify late uploads',
    });
    const objects = new Set(['initial upload']);
    let objectPasses = 0;
    let batchComplete = false;
    const io = {
      objects: () => {
        objectPasses++;
        if (!batchComplete) return Promise.resolve(false);
        objects.clear();
        return Promise.resolve(true);
      },
      vectors: () => Promise.resolve(),
      queues: () => Promise.resolve(true),
    };
    for (let tick = 0; tick < 4; tick++) await processTeamLifecycle(db, io);
    const [waiting] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(waiting?.lifecycleWork.stage).toBe('purge');
    expect(waiting?.deletedAt).toBeNull();
    expect(objects.size).toBe(1);
    batchComplete = true;
    for (let tick = 0; tick < 4; tick++) await processTeamLifecycle(db, io);
    const [verifying] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(verifying?.lifecycleWork.stage).toBe('verify');
    expect(objects.size).toBe(0);
    objects.add('upload completed after the first purge');
    const passesBeforeRetry = objectPasses;
    await retryTeamLifecycle(db, actor, TEAM);
    await processTeamLifecycle(db, io);
    expect(objectPasses).toBe(passesBeforeRetry);
    const [stillWaiting] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(stillWaiting?.deletedAt).toBeNull();
    expect(stillWaiting?.lifecycleWork.retryAt).toBe(verifying?.lifecycleWork.retryAt);
    if (!stillWaiting) throw new Error('Missing deletion fixture');
    await db
      .update(teams)
      .set({
        lifecycleWork: { ...stillWaiting.lifecycleWork, retryAt: new Date(0).toISOString() },
      })
      .where(eq(teams.id, TEAM));
    await processTeamLifecycle(db, io);
    expect(objects.size).toBe(0);
    const [complete] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(complete?.deletedAt).not.toBeNull();
    await assertActivePrincipal(db, OTHER);
  });
  it('rejects forged administrative authority and team-admin deletion requests', async () => {
    await expect(
      beginTeamDeletion(
        db,
        { userId: OWNER, email: actor.email },
        {
          teamId: TEAM,
          confirmation: 'First',
          reason: 'Forged administrator',
        },
      ),
    ).rejects.toThrow();
    await db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.teamId, TEAM));
    await expect(withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('First')).rejects.toThrow(
      'Only team owners',
    );
    await db.delete(teamMembers).where(eq(teamMembers.teamId, OTHER));
    await expect(withTeam(db, OTHER, OWNER).lifecycle.requestDeletion('Other')).rejects.toThrow();
    const [unchanged] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(unchanged?.disabledAt).toBeNull();
    expect(unchanged?.deletionStartedAt).toBeNull();
  });
  it('filters and sorts teams before counting and paginating', async () => {
    await setPlatformSuspension(db, actor, 'team', TEAM, true, 'Paused');
    const result = await listPlatformTeams(db, actor, '', 1, {
      status: 'disabled',
      sort: 'name',
      direction: 'asc',
    });
    expect(result.total).toBe(1);
    expect(result.rows[0]?.id).toBe(TEAM);
    expect(
      (await listPlatformTeams(db, actor, '', 1, { status: 'active' })).rows.map((row) => row.id),
    ).toEqual([OTHER]);
  });
  it('classifies every team table and matches storage ownership exactly', () => {
    const actual = Object.values(schema)
      .filter((value) => is(value, Table))
      .map((table) => getTableConfig(table))
      .filter((table) => table.columns.some((column) => column.name === 'team_id'))
      .map((table) => table.name)
      .sort();
    expect([...PURGED_TEAM_TABLES, ...RETAINED_TEAM_TABLES].sort()).toEqual(actual);
    const indirect = Object.values(schema)
      .filter((value) => is(value, Table))
      .map((table) => getTableConfig(table))
      .filter((table) => !table.columns.some((column) => column.name === 'team_id'))
      .map((table) => table.name)
      .sort();
    expect([...INDIRECT_AND_ACCOUNT_TABLES].sort()).toEqual(indirect);
    expect(teamOwnsStorageKey(`teams/${TEAM}/audio/voice.wav`, TEAM)).toBe(true);
    expect(teamOwnsStorageKey(`${OTHER}/file`, TEAM)).toBe(false);
    expect(teamOwnsStorageKey(`${OTHER}/document/v1/${TEAM}`, TEAM)).toBe(false);
    expect(teamOwnsStorageKey(`teams/${TEAM}-other/file`, TEAM)).toBe(false);
  });
});
