import { PGlite } from '@electric-sql/pglite';
import { billingFreeGrants, type Db } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyOwnedTeamFreeGrant,
  assertTeamConcurrentRecallCapacity,
  assertTeamCustomMcpCapacity,
  assertTeamMemberSeatCapacity,
  assertTeamWriteCapacity,
  claimOwnedTeamFreeGrantsForVerifiedUser,
  getTeamCapacityUsage,
  releaseFreeGrantIfOwnerLeaves,
} from '#src/billing/capacity.js';
import { BillingAdmissionError } from '#src/billing/errors.js';
import { createBillingScope } from '#src/billing/scope.js';
import { createMcpScope } from '#src/mcp/scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '11111111-2222-4333-8444-555555555555';
const EXTRA_TEAM_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

let pg: PGlite;
let db: Db;

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'billing-capacity', 'Billing Capacity');
    INSERT INTO users (id, email, "emailVerified")
    VALUES ('${USER_ID}', 'owner@example.test', now());
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
  db = drizzle(pg) as unknown as Db;
});

afterEach(async () => {
  await pg.close();
});

describe('billing capacity (not Polar meters)', () => {
  it('enforces Free document, member, MCP, and concurrent Recall stock limits', async () => {
    await pg.exec(`
      INSERT INTO documents (team_id, name)
      SELECT '${TEAM_ID}', 'doc-' || g FROM generate_series(1, 100) AS g;
    `);
    await expect(
      assertTeamWriteCapacity({ db, teamId: TEAM_ID, additionalDocuments: 1 }),
    ).rejects.toBeInstanceOf(BillingAdmissionError);

    await assertTeamMemberSeatCapacity({ db, teamId: TEAM_ID, additionalSeats: 2 });
    await expect(
      assertTeamMemberSeatCapacity({ db, teamId: TEAM_ID, additionalSeats: 3 }),
    ).rejects.toBeInstanceOf(BillingAdmissionError);

    await pg.exec(`
      INSERT INTO team_invites (team_id, email, role, token, invited_by_user_id, expires_at)
      VALUES (
        '${TEAM_ID}',
        'pending@example.test',
        'member',
        'pending-invite-token',
        '${USER_ID}',
        NOW() + INTERVAL '7 days'
      );
    `);
    await expect(
      assertTeamMemberSeatCapacity({
        db,
        teamId: TEAM_ID,
        additionalSeats: 2,
        includePendingInvites: true,
      }),
    ).rejects.toBeInstanceOf(BillingAdmissionError);
    await assertTeamMemberSeatCapacity({
      db,
      teamId: TEAM_ID,
      additionalSeats: 2,
      includePendingInvites: false,
    });

    await expect(assertTeamCustomMcpCapacity({ db, teamId: TEAM_ID })).rejects.toBeInstanceOf(
      BillingAdmissionError,
    );

    await pg.exec(`
      INSERT INTO meetings (team_id, platform, meeting_url, status)
      VALUES ('${TEAM_ID}', 'meet', 'https://meet.google.com/aaa-bbbb-ccc', 'joining');
    `);
    await expect(
      assertTeamConcurrentRecallCapacity({ db, teamId: TEAM_ID }),
    ).rejects.toBeInstanceOf(BillingAdmissionError);
  });

  it('does not mint a second Free grant for an extra owned workspace', async () => {
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${EXTRA_TEAM_ID}', 'extra-team', 'Extra Team');
    `);
    const first = await applyOwnedTeamFreeGrant({ db, teamId: TEAM_ID, userId: USER_ID });
    expect(first.ok).toBe(true);
    const extra = await applyOwnedTeamFreeGrant({
      db,
      teamId: EXTRA_TEAM_ID,
      userId: USER_ID,
    });
    expect(extra).toEqual({ ok: false, reason: 'free_grant_elsewhere' });
    const billing = createBillingScope({
      db,
      teamId: EXTRA_TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    expect((await billing.getAccount()).billingState).toBe('restricted');
    const blocked = await billing.reserve({
      operationId: 'ask:web:extra',
      meterId: 'ai',
      reservedNativeUnits: 1,
      reservedChargeCents: 1,
    });
    expect(blocked.ok).toBe(false);
  });

  it('leaves the workspace restricted until the owner email is verified', async () => {
    const unverified = '22222222-3333-4444-8555-666666666666';
    await pg.exec(`
      INSERT INTO users (id, email)
      VALUES ('${unverified}', 'unverified@example.test');
      INSERT INTO teams (id, slug, name)
      VALUES ('${EXTRA_TEAM_ID}', 'extra-team', 'Extra Team');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${EXTRA_TEAM_ID}', '${unverified}', 'owner');
    `);
    const grant = await applyOwnedTeamFreeGrant({
      db,
      teamId: EXTRA_TEAM_ID,
      userId: unverified,
    });
    expect(grant).toEqual({ ok: false, reason: 'email_unverified' });
    const billing = createBillingScope({
      db,
      teamId: EXTRA_TEAM_ID,
      userId: unverified,
      ensureMember: () => Promise.resolve('owner'),
    });
    expect((await billing.getAccount()).billingState).toBe('restricted');
    await pg.exec(`
      UPDATE users SET "emailVerified" = now() WHERE id = '${unverified}';
    `);
    await claimOwnedTeamFreeGrantsForVerifiedUser({ db, userId: unverified });
    expect((await billing.getAccount()).billingState).toBe('free');
  });

  it('ignores removed owner memberships when claiming Free grants', async () => {
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${EXTRA_TEAM_ID}', 'extra-team', 'Extra Team');
      INSERT INTO team_members (team_id, user_id, role, removed_at)
      VALUES ('${EXTRA_TEAM_ID}', '${USER_ID}', 'owner', now());
      UPDATE team_members SET removed_at = now()
      WHERE team_id = '${TEAM_ID}' AND user_id = '${USER_ID}';
    `);
    await claimOwnedTeamFreeGrantsForVerifiedUser({ db, userId: USER_ID });
    const grants = await db
      .select()
      .from(billingFreeGrants)
      .where(eq(billingFreeGrants.userId, USER_ID));
    expect(grants).toHaveLength(0);
  });

  it('claims Free on the active owned workspace and skips a removed extra owner row', async () => {
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${EXTRA_TEAM_ID}', 'extra-team', 'Extra Team');
      INSERT INTO team_members (team_id, user_id, role, removed_at)
      VALUES ('${EXTRA_TEAM_ID}', '${USER_ID}', 'owner', now());
    `);
    await claimOwnedTeamFreeGrantsForVerifiedUser({ db, userId: USER_ID });
    const [grant] = await db
      .select()
      .from(billingFreeGrants)
      .where(eq(billingFreeGrants.userId, USER_ID));
    expect(grant?.assignedTeamId).toBe(TEAM_ID);
    const extraGrants = await db
      .select()
      .from(billingFreeGrants)
      .where(eq(billingFreeGrants.assignedTeamId, EXTRA_TEAM_ID));
    expect(extraGrants).toHaveLength(0);
  });

  it('assigns the Free grant to a restricted Free workspace instead of a paid one', async () => {
    await pg.exec(`
      INSERT INTO teams (id, slug, name, created_at)
      VALUES ('${EXTRA_TEAM_ID}', 'extra-restricted', 'Extra Restricted', '2020-01-01T00:00:00Z');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${EXTRA_TEAM_ID}', '${USER_ID}', 'owner');
    `);
    const paid = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await paid.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'team', billing_state = 'team_active', spend_cap_cents = 10000
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO team_billing_accounts (team_id, plan_id, billing_state, spend_cap_cents)
      VALUES ('${EXTRA_TEAM_ID}', 'free', 'restricted', 0);
    `);
    await claimOwnedTeamFreeGrantsForVerifiedUser({ db, userId: USER_ID });
    const [grant] = await db
      .select()
      .from(billingFreeGrants)
      .where(eq(billingFreeGrants.userId, USER_ID));
    expect(grant?.assignedTeamId).toBe(EXTRA_TEAM_ID);
    const extra = createBillingScope({
      db,
      teamId: EXTRA_TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    expect((await extra.getAccount()).billingState).toBe('free');
    expect((await paid.getAccount()).planId).toBe('team');
  });

  it('blocks document writes in non-reservable billing states even under stock limits', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET billing_state = 'past_due', plan_id = 'team', spend_cap_cents = 10000
      WHERE team_id = '${TEAM_ID}';
    `);
    await expect(
      assertTeamWriteCapacity({ db, teamId: TEAM_ID, additionalDocuments: 1 }),
    ).rejects.toBeInstanceOf(BillingAdmissionError);

    await pg.exec(`
      UPDATE team_billing_accounts SET billing_state = 'read_only' WHERE team_id = '${TEAM_ID}';
    `);
    await expect(
      assertTeamWriteCapacity({ db, teamId: TEAM_ID, additionalBytes: 1 }),
    ).rejects.toMatchObject({
      message:
        "This team's billing is paused, so new files cannot be uploaded until billing is restored.",
    });
  });

  it('adds storage bytes numerically instead of concatenating the SUM result', async () => {
    await pg.exec(`
      INSERT INTO documents (id, team_id, name)
      VALUES ('cccccccc-dddd-4eee-8fff-000000000000', '${TEAM_ID}', 'big.bin');
      INSERT INTO document_versions (team_id, document_id, version, object_key, byte_size)
      VALUES (
        '${TEAM_ID}',
        'cccccccc-dddd-4eee-8fff-000000000000',
        1,
        'team/docs/big.bin',
        1073741824
      );
    `);
    await assertTeamWriteCapacity({ db, teamId: TEAM_ID, additionalBytes: 0 });
    await expect(
      assertTeamWriteCapacity({ db, teamId: TEAM_ID, additionalBytes: 1 }),
    ).rejects.toBeInstanceOf(BillingAdmissionError);
  });

  it('reports live used/limit for enforced plan stock', async () => {
    await pg.exec(`
      INSERT INTO meetings (team_id, platform, meeting_url, status)
      VALUES ('${TEAM_ID}', 'meet', 'https://meet.google.com/aaa-bbbb-ccc', 'joining');
      INSERT INTO billing_usage_reservations
        (team_id, operation_id, meter_id, reserved_native_units, reserved_charge_cents, expires_at)
      VALUES ('${TEAM_ID}', 'ask:web:1', 'ai', 1, 1, now() + interval '1 hour');
    `);
    const rows = await getTeamCapacityUsage({ db, teamId: TEAM_ID, planId: 'free' });
    const byKind = Object.fromEntries(rows.map((row) => [row.kind, row]));
    expect(byKind.concurrent_recall_bots).toMatchObject({ used: 1, limit: 1 });
    expect(byKind.agent_turns).toMatchObject({ used: 1, limit: 100 });
    expect(byKind.active_members).toMatchObject({ used: 1, limit: 3 });
    expect(byKind.custom_mcp_servers).toMatchObject({ used: 0, limit: 0 });
    expect(byKind.documents).toMatchObject({ used: 0, limit: 100 });
  });

  it('rejects adding a custom MCP server on the Free plan', async () => {
    const mcp = createMcpScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await expect(
      mcp.addServer({
        name: 'Context7',
        url: 'https://mcp.context7.com/mcp',
        authType: 'none',
      }),
    ).rejects.toBeInstanceOf(BillingAdmissionError);
  });

  it('rejects new seats when billing is paused', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET billing_state = 'past_due', plan_id = 'team', spend_cap_cents = 10000
      WHERE team_id = '${TEAM_ID}';
    `);
    await expect(
      assertTeamMemberSeatCapacity({ db, teamId: TEAM_ID, additionalSeats: 1 }),
    ).rejects.toMatchObject({
      message:
        "This team's billing is paused, so new members cannot be added until billing is restored.",
    });

    await pg.exec(`
      UPDATE team_billing_accounts SET billing_state = 'read_only' WHERE team_id = '${TEAM_ID}';
    `);
    await expect(
      assertTeamMemberSeatCapacity({ db, teamId: TEAM_ID, additionalSeats: 1 }),
    ).rejects.toBeInstanceOf(BillingAdmissionError);

    await pg.exec(`
      UPDATE team_billing_accounts SET billing_state = 'payment_retry' WHERE team_id = '${TEAM_ID}';
    `);
    await expect(
      assertTeamMemberSeatCapacity({ db, teamId: TEAM_ID, additionalSeats: 1 }),
    ).rejects.toBeInstanceOf(BillingAdmissionError);
  });

  it('excludes chunks from deleted documents in indexed-chunk capacity', async () => {
    await pg.exec(`
      INSERT INTO documents (id, team_id, name, deleted_at)
      VALUES ('cccccccc-dddd-4eee-8fff-000000000001', '${TEAM_ID}', 'gone.txt', now());
      INSERT INTO document_versions (id, team_id, document_id, version, object_key)
      VALUES (
        'cccccccc-dddd-4eee-8fff-000000000002',
        '${TEAM_ID}',
        'cccccccc-dddd-4eee-8fff-000000000001',
        1,
        'team/docs/gone.txt'
      );
      INSERT INTO document_chunks (team_id, document_id, document_version_id, chunk_index, representation_kind, text, token_count)
      SELECT '${TEAM_ID}', 'cccccccc-dddd-4eee-8fff-000000000001',
             'cccccccc-dddd-4eee-8fff-000000000002', g, 'source_text', 'chunk', 1
      FROM generate_series(1, 2000) AS g;
    `);
    await assertTeamWriteCapacity({ db, teamId: TEAM_ID, additionalChunks: 1 });
    const rows = await getTeamCapacityUsage({ db, teamId: TEAM_ID, planId: 'free' });
    const chunks = rows.find((row) => row.kind === 'indexed_chunks');
    expect(chunks).toMatchObject({ used: 0, limit: 2000 });
  });

  it('unassigns the Free grant when its owner leaves the assigned team', async () => {
    await applyOwnedTeamFreeGrant({ db, teamId: TEAM_ID, userId: USER_ID });
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${EXTRA_TEAM_ID}', 'other-owned', 'Other Owned');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${EXTRA_TEAM_ID}', '${USER_ID}', 'owner');
      INSERT INTO team_billing_accounts (team_id, plan_id, billing_state, spend_cap_cents)
      VALUES ('${EXTRA_TEAM_ID}', 'free', 'restricted', 0);
      UPDATE team_members SET removed_at = now()
      WHERE team_id = '${TEAM_ID}' AND user_id = '${USER_ID}';
    `);
    await releaseFreeGrantIfOwnerLeaves({ db, teamId: TEAM_ID, userId: USER_ID });
    const [grant] = await db
      .select()
      .from(billingFreeGrants)
      .where(eq(billingFreeGrants.userId, USER_ID));
    expect(grant?.assignedTeamId).toBe(EXTRA_TEAM_ID);
    const left = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    expect((await left.getAccount()).billingState).toBe('restricted');
    const extra = createBillingScope({
      db,
      teamId: EXTRA_TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    expect((await extra.getAccount()).billingState).toBe('free');
  });

  it('does not restrict a Free team when another owner grant remains', async () => {
    const otherOwner = '22222222-3333-4444-8555-666666666666';
    await applyOwnedTeamFreeGrant({ db, teamId: TEAM_ID, userId: USER_ID });
    await pg.exec(`
      INSERT INTO users (id, email, "emailVerified")
      VALUES ('${otherOwner}', 'other-owner@example.test', now());
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '${otherOwner}', 'owner');
      INSERT INTO billing_free_grants (user_id, assigned_team_id)
      VALUES ('${otherOwner}', '${TEAM_ID}');
    `);
    await releaseFreeGrantIfOwnerLeaves({ db, teamId: TEAM_ID, userId: USER_ID });
    const remaining = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    expect((await remaining.getAccount()).billingState).toBe('free');
    const [leftGrant] = await db
      .select()
      .from(billingFreeGrants)
      .where(eq(billingFreeGrants.userId, USER_ID));
    expect(leftGrant?.assignedTeamId).toBeNull();
  });
});
