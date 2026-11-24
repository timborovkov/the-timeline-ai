import { PGlite } from '@electric-sql/pglite';
import {
  teams,
  billingPolarMembers,
  teamBillingAccounts,
  teamMembers,
  users,
  type Db,
} from '@timeline/db';
import { expect } from '@timeline/test-support';
import { beforeEach, afterEach, describe, it, spyOn } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { assertTeamMemberSeatCapacity, reconcileTeamPaidSeats } from '#src/billing/capacity.js';
import {
  assertStoredPolarIdentity,
  resolvePolarOwnerUserId,
  withTeamBillingIdentity,
  preparePolarMembershipChange,
  completePolarMembershipChange,
} from '#src/billing/customer-identity.js';
import { PolarIdentityError } from '#src/billing/polar-identity-api.js';
import { handlePolarWebhookEvent } from '#src/billing/polar-webhook.js';
import * as polar from '#src/billing/polar.js';
import { createFakeBillingProvider, type TeamSeatSubscription } from '#src/billing/provider.js';
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
  it('records pending checkout identities and rejects disabled billing sessions', async () => {
    await withTeamBillingIdentity(
      { db, teamId, userId: owner, provider },
      async (_identity, context) => {
        await context.recordCheckout('fixture-checkout');
      },
    );
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team?.lifecycleWork.pendingCheckoutIds).toEqual(['fixture-checkout']);
    await db.update(teams).set({ disabledAt: new Date() }).where(eq(teams.id, teamId));
    await expect(resolve()).rejects.toBeInstanceOf(PolarIdentityError);
    await expect(resolve(owner, secondTeam)).resolves.toBeDefined();
  });
  it('retains payable links and removes only confirmed expired links under the checkout lock', async () => {
    await withTeamBillingIdentity({ db, teamId, userId: owner, provider }, (_identity, context) =>
      context.recordCheckout('closed'),
    );
    await withTeamBillingIdentity({ db, teamId, userId: owner, provider }, (_identity, context) =>
      context.recordCheckout('payable'),
    );
    provider.expireCheckout = (id) => Promise.resolve(id === 'closed' ? 'expired' : 'already_paid');
    const retire = () =>
      withTeamBillingIdentity({ db, teamId, userId: owner, provider }, (_identity, context) =>
        context.prepareTeamCheckout({ productId: 'team-product', seats: 3 }),
      );
    expect(await retire()).toEqual({ status: 'blocked' });
    const [remaining] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(remaining?.lifecycleWork.pendingCheckoutIds).toEqual(['payable']);
    provider.expireCheckout = () => Promise.resolve('expired');
    expect(await retire()).toEqual({ status: 'ready' });
    const [cleared] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(cleared?.lifecycleWork.pendingCheckoutIds).toEqual([]);
  });
  it('rediscovers and records a payable Team quote when the create response was lost', async () => {
    const url = 'https://checkout.example.test/recovered';
    provider.listPendingTeamCheckouts = (filter) => {
      expect(filter).toEqual({
        customerId: provider.customers.get(teamId)?.id,
        productId: 'team-product',
      });
      return Promise.resolve([
        {
          id: 'lost-checkout',
          status: 'open',
          seats: 3,
          discountId: null,
          url,
        },
      ]);
    };
    const prepare = (seats: number) =>
      withTeamBillingIdentity({ db, teamId, userId: owner, provider }, (_identity, context) =>
        context.prepareTeamCheckout({ productId: 'team-product', seats }),
      );
    provider.expireCheckout = () => Promise.resolve('still_open');

    expect(await prepare(3)).toEqual({ status: 'resume', url });
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    expect(team?.lifecycleWork.pendingCheckoutIds).toEqual(['lost-checkout']);
    expect(await prepare(4)).toEqual({ status: 'blocked' });
    provider.listPendingTeamCheckouts = () => Promise.resolve([]);
    provider.expireCheckout = () => Promise.resolve('expired');
    expect(await prepare(4)).toEqual({ status: 'ready' });
  });

  it('allows invite creation but holds roster growth while a Team quote can still be paid', async () => {
    const identity = await withTeamBillingIdentity(
      { db, teamId: secondTeam, userId: owner, provider },
      async (current, context) => {
        await context.recordCheckout('one-seat-quote');
        return current;
      },
    );
    const providerMock = spyOn(polar, 'createPolarBillingProvider').mockReturnValue(provider);
    const productMock = spyOn(polar, 'polarProductIdForPlan').mockReturnValue('team-product');
    try {
      const accept = () =>
        db.transaction(async (tx) => {
          await assertTeamMemberSeatCapacity({
            db: tx as unknown as Db,
            teamId: secondTeam,
            includePendingInvites: false,
            acquirePaidSeat: true,
          });
          await tx
            .insert(teamMembers)
            .values({ teamId: secondTeam, userId: member, role: 'member' });
        });
      provider.expireCheckout = () => Promise.resolve('still_open');
      await expect(
        assertTeamMemberSeatCapacity({ db, teamId: secondTeam }),
      ).resolves.toBeUndefined();
      await expect(accept()).rejects.toThrow('pending Team checkout');

      provider.expireCheckout = () => Promise.resolve('already_paid');
      await expect(accept()).rejects.toThrow('pending Team checkout');

      const originalId = 'one-seat-quote';
      const recoveredId = 'unrecorded-team-quote';
      provider.expireCheckout = (id) =>
        Promise.resolve(id === originalId ? 'expired' : 'still_open');
      provider.listPendingTeamCheckouts = (input) => {
        expect(input).toEqual({ customerId: identity.customerId, productId: 'team-product' });
        return Promise.resolve([
          {
            id: recoveredId,
            status: 'open',
            seats: 1,
            discountId: null,
            url: 'https://checkout.example.test/recovered',
          },
        ]);
      };
      await expect(accept()).rejects.toThrow('pending Team checkout');
      expect(
        await db.select().from(teamMembers).where(eq(teamMembers.teamId, secondTeam)),
      ).toHaveLength(1);

      provider.listPendingTeamCheckouts = () => Promise.resolve([]);
      await expect(accept()).resolves.toBeUndefined();
      expect(
        await db.select().from(teamMembers).where(eq(teamMembers.teamId, secondTeam)),
      ).toHaveLength(2);
      const [team] = await db.select().from(teams).where(eq(teams.id, secondTeam));
      expect(team?.lifecycleWork.pendingCheckoutIds).toEqual([]);
    } finally {
      providerMock.mockRestore();
      productMock.mockRestore();
    }
  });

  it('reconciles verified seat drift without purchasing seats or granting allowance twice', async () => {
    const identity = await resolve();
    const subscription: TeamSeatSubscription = {
      id: 'synthetic-subscription',
      customerId: identity.customerId,
      productId: 'team-product',
      seats: 1,
      pendingSeats: null,
      status: 'active',
      periodStart: new Date('2026-11-01T00:00:00Z'),
      periodEnd: new Date('2026-12-01T00:00:00Z'),
      modifiedAt: new Date('2026-11-16T00:00:00Z'),
    };
    await db
      .update(teamBillingAccounts)
      .set({
        planId: 'team',
        billingState: 'team_active',
        polarProductId: subscription.productId,
        polarSubscriptionId: subscription.id,
        periodStartedAt: subscription.periodStart,
        periodEndsAt: subscription.periodEnd,
        teamSeatTerms: { paidSeats: 1, highWaterSeats: 1, includedUsageCents: 1200 },
        includedDiscountRemainingCents: 700,
      })
      .where(eq(teamBillingAccounts.teamId, teamId));

    provider.getTeamSeatSubscription = () => Promise.resolve({ ...subscription });
    const changes: { seats: number; proration: string }[] = [];
    provider.updateTeamSeatSubscription = (change) => {
      changes.push(change);
      subscription.pendingSeats = change.seats === subscription.seats ? null : change.seats;
      return Promise.resolve({ ...subscription });
    };
    const reconcile = () => reconcileTeamPaidSeats({ db, teamId, provider });
    const account = async () =>
      (
        await db.select().from(teamBillingAccounts).where(eq(teamBillingAccounts.teamId, teamId))
      )[0];

    // The roster is larger than the recovered provider quantity. Maintenance
    // can record a confirmed snapshot but cannot authorize a purchase.
    await reconcile();
    expect(changes).toEqual([]);
    expect((await account())?.includedDiscountRemainingCents).toBe(700);

    subscription.seats = 3;
    subscription.pendingSeats = 2;
    await reconcile();
    await reconcile();
    expect(changes).toEqual([
      {
        subscriptionId: subscription.id,
        seats: 3,
        proration: 'next_period',
      },
    ]);
    expect(await account()).toMatchObject({
      teamSeatTerms: { paidSeats: 3, highWaterSeats: 3, includedUsageCents: 2400 },
      includedDiscountRemainingCents: 1900,
    });

    subscription.periodStart = subscription.periodEnd;
    subscription.periodEnd = new Date('2027-01-01T00:00:00Z');
    subscription.modifiedAt = subscription.periodStart;
    await reconcile();
    await reconcile();
    expect(await account()).toMatchObject({
      periodStartedAt: subscription.periodStart,
      teamSeatTerms: { paidSeats: 3, highWaterSeats: 3, includedUsageCents: 3600 },
      includedDiscountRemainingCents: 3600,
    });
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
  it('blocks first billing setup while an unlinked member removal is pending', async () => {
    await revoke();
    await expect(resolve(admin)).rejects.toMatchObject({ operation: 'pending_membership_change' });
    await finish();
    const identity = await resolve();
    expect(
      (await api().members(identity.customerId)).some((row) => row.external_id === admin),
    ).toBe(false);
  });
  it('rejects local demotion without completed revocation of a newly mapped member', async () => {
    const identity = await resolve(admin);
    await expect(finish()).rejects.toMatchObject({ operation: 'revocation_incomplete' });
    await revoke();
    await finish();
    expect(
      (await api().members(identity.customerId)).some((row) => row.id === identity.memberId),
    ).toBe(false);
    await expect(resolve(admin)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('recovers and revokes remote members after provisioning rolled back locally', async () => {
    const save = api().saveMember.bind(api());
    api().saveMember = async (...args) => {
      const result = await save(...args);
      if (args[1].userId === admin)
        throw new PolarIdentityError('unavailable', 'after_remote_write');
      return result;
    };
    await expect(resolve()).rejects.toMatchObject({ operation: 'after_remote_write' });
    const account = (
      await db.select().from(teamBillingAccounts).where(eq(teamBillingAccounts.teamId, teamId))
    )[0];
    expect(account?.polarCustomerId).toBeNull();
    expect(account?.polarOrganizationId).toBe(api().organizationId);
    expect(await db.select().from(billingPolarMembers)).toHaveLength(0);
    const remote = await api().customer(teamId);
    if (!remote) throw new Error('remote provisioning was lost');
    expect((await api().members(remote.id)).some((row) => row.external_id === admin)).toBe(true);
    api().saveMember = save;
    await expect(
      preparePolarMembershipChange({
        db,
        teamId,
        actorUserId: owner,
        userId: admin,
        targetRole: 'member',
        provider: null,
      }),
    ).rejects.toMatchObject({ operation: 'provider' });
    await expect(finish()).rejects.toMatchObject({ operation: 'revocation_incomplete' });
    await revoke();
    await finish();
    const recovered = await resolve();
    expect(recovered.customerId).toBe(remote.id);
    expect((await api().members(remote.id)).some((row) => row.external_id === admin)).toBe(false);
    await expect(resolve(admin)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('blocks revocation while a legacy customer email still grants independent access', async () => {
    const identity = await resolve(admin);
    const customer = await api().customer(teamId, identity.customerId);
    if (!customer) throw new Error('customer missing');
    customer.email = 'owner@example.test';
    api().clearEmail = () =>
      Promise.reject(new PolarIdentityError('configuration', 'customer_email_clear_unsupported'));
    await expect(revoke()).rejects.toMatchObject({ operation: 'customer_email_clear_unsupported' });
    await expect(finish()).rejects.toMatchObject({ operation: 'revocation_incomplete' });
    await expect(resolve(admin)).rejects.toThrow();
    customer.email = null; // Provider-supported cleanup enables a safe retry.
    await revoke();
    await finish();
    await expect(resolve(admin)).rejects.toMatchObject({ code: 'forbidden' });
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
  it('recovers a converted owner without local mappings and rejects ambiguous or conflicting recovery', async () => {
    const identity = await resolve();
    const remoteOwner = (await api().members(identity.customerId)).find(
      (row) => row.role === 'owner',
    );
    if (!remoteOwner) throw new Error('owner missing');
    remoteOwner.external_id = teamId;
    await db.delete(billingPolarMembers).where(eq(billingPolarMembers.teamId, teamId));
    const owners = [{ userId: owner, email: remoteOwner.email, verified: true }];
    expect(resolvePolarOwnerUserId(owners, [], remoteOwner, true)).toBe(owner);
    expect(() => resolvePolarOwnerUserId(owners, [], remoteOwner)).toThrow();
    expect(() =>
      resolvePolarOwnerUserId(
        [...owners, { userId: admin, email: remoteOwner.email, verified: true }],
        [],
        remoteOwner,
        true,
      ),
    ).toThrow();
    expect(() =>
      resolvePolarOwnerUserId(
        owners,
        [{ userId: admin, memberId: remoteOwner.id }],
        remoteOwner,
        true,
      ),
    ).toThrow();
    await withTeamBillingIdentity(
      { db, teamId, userId: owner, provider, convert: true },
      (recovered) => {
        expect(recovered).toEqual(identity);
        return Promise.resolve();
      },
    );
    expect(await resolve()).toEqual(identity);
  });
  it('rejects a member mapping swapped to a different user in the same customer', async () => {
    const a = await resolve();
    await db
      .update(billingPolarMembers)
      .set({ memberId: a.memberId })
      .where(and(eq(billingPolarMembers.teamId, teamId), eq(billingPolarMembers.userId, admin)));
    await expect(resolve(admin)).rejects.toMatchObject({ code: 'identity_conflict' });
  });
  it('rejects a swapped member mapping during revocation before deleting another user', async () => {
    const ownerIdentity = await resolve();
    const adminIdentity = await resolve(admin);
    await db
      .update(billingPolarMembers)
      .set({ memberId: ownerIdentity.memberId })
      .where(and(eq(billingPolarMembers.teamId, teamId), eq(billingPolarMembers.userId, admin)));
    await expect(revoke()).rejects.toMatchObject({ operation: 'member_mapping' });
    await expect(finish()).rejects.toMatchObject({ operation: 'revocation_incomplete' });
    expect(
      (await api().members(ownerIdentity.customerId)).find(
        (row) => row.id === ownerIdentity.memberId,
      )?.role,
    ).toBe('owner');
    expect(
      (await api().members(ownerIdentity.customerId)).some(
        (row) => row.id === adminIdentity.memberId,
      ),
    ).toBe(true);
  });
  it('rejects a swapped successor mapping before transferring ownership', async () => {
    const ownerIdentity = await resolve();
    await db.update(teamMembers).set({ role: 'owner' }).where(eq(teamMembers.userId, admin));
    await db
      .update(billingPolarMembers)
      .set({ memberId: ownerIdentity.memberId })
      .where(and(eq(billingPolarMembers.teamId, teamId), eq(billingPolarMembers.userId, admin)));
    await expect(revoke(owner)).rejects.toMatchObject({ operation: 'member_mapping' });
    expect(
      (await api().members(ownerIdentity.customerId)).find(
        (row) => row.id === ownerIdentity.memberId,
      )?.role,
    ).toBe('owner');
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
