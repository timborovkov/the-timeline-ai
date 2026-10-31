import { PGlite } from '@electric-sql/pglite';
import {
  billingPolarMembers,
  teamBillingAccounts,
  teamMembers,
  users,
  type Db,
} from '@timeline/db';
import { expect } from '@timeline/test-support';
import { beforeEach, afterEach, describe, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import {
  assertStoredPolarIdentity,
  withTeamBillingIdentity,
  preparePolarMembershipChange,
  completePolarMembershipChange,
} from '#src/billing/customer-identity.js';
import { PolarIdentityError } from '#src/billing/polar-identity-api.js';
import { handlePolarWebhookEvent } from '#src/billing/polar-webhook.js';
import { createFakeBillingProvider } from '#src/billing/provider.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const teamId = '11111111-1111-4111-8111-111111111111';
const secondTeam = '22222222-2222-4222-8222-222222222222';
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const admin = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const member = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let pg: PGlite;
let db: Db;
let provider: ReturnType<typeof createFakeBillingProvider>;
beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg) as unknown as Db;
  provider = createFakeBillingProvider({ teamIdentity: true });
  await pg.exec(`
    INSERT INTO teams(id,slug,name) VALUES ('${teamId}','identity-a','Team A'), ('${secondTeam}','identity-b','Team B');
    INSERT INTO users(id,email,"emailVerified") VALUES ('${owner}','owner@example.test',now()), ('${admin}','admin@example.test',now()), ('${member}','member@example.test',now());
    INSERT INTO team_members(team_id,user_id,role) VALUES ('${teamId}','${owner}','owner'),('${teamId}','${admin}','admin'),('${teamId}','${member}','member'),('${secondTeam}','${owner}','owner');
    INSERT INTO team_billing_accounts(team_id) VALUES ('${teamId}'),('${secondTeam}');
  `);
});
afterEach(async () => {
  await pg.close();
});
function api() {
  if (!provider.identity) throw new Error('identity API required');
  return provider.identity;
}
const resolve = (userId = owner, team = teamId) =>
  withTeamBillingIdentity({ db, teamId: team, userId, provider }, (identity) =>
    Promise.resolve(identity),
  );
const revoke = (userId = admin, targetRole = 'member') =>
  preparePolarMembershipChange({ db, teamId, actorUserId: owner, userId, targetRole, provider });
async function finish(userId = admin, role: 'member' | 'admin' | 'owner' = 'member') {
  await db.transaction(async (tx) => {
    await completePolarMembershipChange(tx as unknown as Db, teamId, userId, role);
    await tx
      .update(teamMembers)
      .set({ role })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  });
}
describe('Polar team identity and revocation', () => {
  it('creates two distinct team customers for the same owner, persists before checkout and reuses on retry', async () => {
    const a = await resolve();
    const b = await resolve(owner, secondTeam);
    expect(a.customerId).not.toBe(b.customerId);
    expect(a.memberId).not.toBe(b.memberId);
    expect(await resolve()).toEqual(a);
    await expect(
      withTeamBillingIdentity({ db, teamId, userId: owner, provider }, () =>
        Promise.reject(new Error('checkout outage')),
      ),
    ).rejects.toThrow('checkout outage');
    expect(await assertStoredPolarIdentity(db, teamId, provider)).toBe(a.customerId);
  });
  it('gives admins their own billing manager identity and rejects ordinary members', async () => {
    const a = await resolve();
    const b = await resolve(admin);
    expect(a.customerId).toBe(b.customerId);
    expect(a.memberId).not.toBe(b.memberId);
    expect((await api().members(a.customerId)).find((row) => row.id === b.memberId)?.role).toBe(
      'billing_manager',
    );
    await expect(resolve(member)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('fails closed for mismatched environment and organization without session issuance', async () => {
    await resolve();
    for (const patch of [
      { polarServer: 'production' },
      { polarServer: 'sandbox', polarOrganizationId: 'foreign' },
    ]) {
      await db.update(teamBillingAccounts).set(patch).where(eq(teamBillingAccounts.teamId, teamId));
      await expect(resolve()).rejects.toMatchObject({ code: 'identity_conflict' });
    }
  });
  it('rejects a wrong stored customer and missing environment binding', async () => {
    await resolve();
    await db
      .update(teamBillingAccounts)
      .set({ polarCustomerId: 'other-customer' })
      .where(eq(teamBillingAccounts.teamId, teamId));
    await expect(resolve()).rejects.toThrow();
    await db
      .update(teamBillingAccounts)
      .set({ polarServer: null })
      .where(eq(teamBillingAccounts.teamId, teamId));
    await expect(resolve()).rejects.toMatchObject({ code: 'identity_conflict' });
  });
  it('leaves local privileges unchanged and denies sessions during a provider outage, then retries revocation', async () => {
    const a = await resolve(admin);
    const remove = api().removeMember.bind(api());
    api().removeMember = () =>
      Promise.reject(new PolarIdentityError('unavailable', 'remove_member'));
    await expect(revoke()).rejects.toMatchObject({ code: 'unavailable' });
    expect(
      (await db.select().from(teamMembers).where(eq(teamMembers.userId, admin)))[0]?.role,
    ).toBe('admin');
    await expect(resolve(admin)).rejects.toMatchObject({ operation: 'pending_membership_change' });
    api().removeMember = remove;
    await revoke();
    expect((await api().members(a.customerId)).some((row) => row.id === a.memberId)).toBe(false);
    await expect(resolve(admin)).rejects.toThrow();
    await finish();
    await expect(resolve(admin)).rejects.toMatchObject({ code: 'forbidden' });
    expect(await resolve()).toBeDefined();
  });
  it('keeps intent through an interrupted local transaction and never recreates the revoked member', async () => {
    const a = await resolve(admin);
    await revoke();
    await expect(
      db.transaction(async (tx) => {
        await completePolarMembershipChange(tx as unknown as Db, teamId, admin, 'member');
        throw new Error('interrupted');
      }),
    ).rejects.toThrow('interrupted');
    await expect(resolve(admin)).rejects.toThrow();
    await revoke();
    await finish();
    expect((await api().members(a.customerId)).some((row) => row.id === a.memberId)).toBe(false);
  });
  it('refuses to revoke the last owner before creating a pending operation', async () => {
    await resolve();
    await expect(revoke(owner)).rejects.toMatchObject({ operation: 'last_billing_owner' });
    expect(
      (await db.select().from(billingPolarMembers)).every((row) => row.pendingRole === null),
    ).toBe(true);
    expect(await resolve()).toBeDefined();
  });
  it('transfers owner before removing the old owner and preserves the successor', async () => {
    const a = await resolve();
    await db.update(teamMembers).set({ role: 'owner' }).where(eq(teamMembers.userId, admin));
    await revoke(owner);
    await finish(owner);
    const b = await resolve(admin);
    const members = await api().members(a.customerId);
    expect(members.find((row) => row.id === b.memberId)?.role).toBe('owner');
    expect(members.some((row) => row.id === a.memberId)).toBe(false);
  });
  it('syncs verified email changes and rejects unverified users', async () => {
    const a = await resolve(admin);
    await db.update(users).set({ email: 'changed@example.test' }).where(eq(users.id, admin));
    await resolve(admin);
    expect((await api().members(a.customerId)).find((row) => row.id === a.memberId)?.email).toBe(
      'changed@example.test',
    );
    await db.update(users).set({ emailVerified: null }).where(eq(users.id, admin));
    await expect(resolve(admin)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('requires explicit conversion and stops an ambiguous individual owner before mutation', async () => {
    const a = await resolve();
    const customer = await api().customer(teamId, a.customerId);
    if (!customer) throw new Error('customer missing');
    customer.type = 'individual';
    customer.email = 'unrelated@example.test';
    await expect(resolve()).rejects.toMatchObject({ operation: 'conversion_required' });
    await expect(
      withTeamBillingIdentity({ db, teamId, userId: owner, provider, convert: true }, () =>
        Promise.resolve(),
      ),
    ).rejects.toMatchObject({ operation: 'conversion_owner' });
    expect(customer.type).toBe('individual');
    customer.email = 'owner@example.test';
    await withTeamBillingIdentity(
      { db, teamId, userId: owner, provider, convert: true },
      (identity) => {
        expect(identity.customerId).toBe(a.customerId);
        return Promise.resolve();
      },
    );
    expect(customer.type).toBe('team');
  });
  it('rejects a member mapping swapped to a different user in the same customer', async () => {
    const a = await resolve();
    await db
      .update(billingPolarMembers)
      .set({ memberId: a.memberId })
      .where(and(eq(billingPolarMembers.teamId, teamId), eq(billingPolarMembers.userId, admin)));
    await expect(resolve(admin)).rejects.toMatchObject({ code: 'identity_conflict' });
  });
  it('rejects webhook customer and subscription conflicts before changing entitlements', async () => {
    const a = await resolve();
    const webhook = (customerId: string) =>
      handlePolarWebhookEvent({
        db,
        provider,
        chargesEnabled: true,
        products: {},
        payload: {
          type: 'subscription.active',
          data: { id: 'foreign-subscription', customer: { id: customerId, external_id: teamId } },
        },
      });
    await expect(webhook('foreign-customer')).rejects.toMatchObject({
      operation: 'webhook_customer',
    });
    api().assertSubscription = () =>
      Promise.reject(new PolarIdentityError('identity_conflict', 'subscription'));
    await expect(webhook(a.customerId)).rejects.toMatchObject({ operation: 'subscription' });
    expect(
      (await db.select().from(teamBillingAccounts).where(eq(teamBillingAccounts.teamId, teamId)))[0]
        ?.polarSubscriptionId,
    ).toBeNull();
  });
});
