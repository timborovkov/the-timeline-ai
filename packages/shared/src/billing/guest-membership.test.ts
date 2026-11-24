import { teamBillingAccounts, teamMembers, teams, users, type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterAll, afterEach, beforeAll, beforeEach, describe, it, spyOn } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { assertTeamMemberSeatCapacity, reconcileTeamPaidSeats } from '#src/billing/capacity.js';
import { TEAM_MONTHLY_USAGE_PER_SEAT_CENTS } from '#src/billing/catalog.js';
import * as polar from '#src/billing/polar.js';
import {
  createFakeBillingProvider,
  type BillingProvider,
  type TeamSeatSubscription,
} from '#src/billing/provider.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb } from '#src/test/pglite.js';

const teamId = '11111111-1111-4111-8111-111111111111';
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const guest = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let fixture: Awaited<ReturnType<typeof createResettablePGliteTestDb>>;
let db: Db;
let provider: BillingProvider;
let subscription: TeamSeatSubscription;
let updates: { seats: number; proration: string }[];
let failProvider = false;
let providerSpy: ReturnType<typeof spyOn<typeof polar, 'createPolarBillingProvider'>>;

beforeAll(async () => {
  fixture = await createResettablePGliteTestDb();
  db = drizzle(fixture.pg) as unknown as Db;
});
afterAll(async () => fixture.close());
afterEach(() => {
  providerSpy.mockRestore();
});
beforeEach(async () => {
  await fixture.reset();
  await db.insert(teams).values({ id: teamId, slug: 'paid-guests', name: 'Paid guests' });
  await db.insert(users).values([
    { id: owner, email: 'owner@example.test', emailVerified: new Date() },
    { id: guest, email: 'guest@example.test', emailVerified: new Date() },
  ]);
  await db.insert(teamMembers).values({ teamId, userId: owner, role: 'owner' });
  const fake = createFakeBillingProvider({ teamIdentity: true });
  if (!fake.identity) throw new Error('Expected fixture identity');
  const customer = await fake.identity.create(teamId, 'Paid guests', {
    userId: owner,
    email: 'owner@example.test',
  });
  subscription = {
    id: 'sub_fixture',
    customerId: customer.id,
    productId: 'prod_fixture',
    seats: 1,
    pendingSeats: null,
    status: 'active',
    periodStart: new Date('2026-11-01T00:00:00Z'),
    periodEnd: new Date('2026-12-01T00:00:00Z'),
    modifiedAt: new Date('2026-11-16T00:00:00Z'),
  };
  updates = [];
  failProvider = false;
  provider = {
    ...fake,
    getTeamSeatSubscription: () => Promise.resolve({ ...subscription }),
    updateTeamSeatSubscription(input) {
      if (failProvider) return Promise.reject(new Error('Synthetic provider unavailable'));
      updates.push({ seats: input.seats, proration: input.proration });
      if (input.proration === 'invoice')
        subscription = { ...subscription, seats: input.seats, pendingSeats: null };
      else
        subscription = {
          ...subscription,
          pendingSeats: input.seats === subscription.seats ? null : input.seats,
        };
      return Promise.resolve({ ...subscription });
    },
  };
  providerSpy = spyOn(polar, 'createPolarBillingProvider').mockReturnValue(provider);
  await db.insert(teamBillingAccounts).values({
    teamId,
    planId: 'team',
    billingState: 'team_active',
    shadowBilling: false,
    polarCustomerId: customer.id,
    polarOrganizationId: 'org-synthetic',
    polarServer: 'sandbox',
    polarSubscriptionId: subscription.id,
    polarProductId: subscription.productId,
    periodStartedAt: subscription.periodStart,
    periodEndsAt: subscription.periodEnd,
    teamSeatTerms: {
      paidSeats: 1,
      highWaterSeats: 1,
      includedUsageCents: TEAM_MONTHLY_USAGE_PER_SEAT_CENTS,
    },
    includedDiscountRemainingCents: TEAM_MONTHLY_USAGE_PER_SEAT_CENTS,
  });
});

async function inviteGuest() {
  const invitation = await withTeam(db, teamId, owner).guests.invite('guest@example.test');
  if (!invitation) throw new Error('Expected guest invitation');
  expect(await withTeam(db, teamId, guest).guests.accept(invitation.token)).toBe(true);
}

async function activateMember() {
  await db.transaction(async (tx) => {
    await assertTeamMemberSeatCapacity({
      db: tx as unknown as Db,
      teamId,
      additionalSeats: 1,
      includePendingInvites: false,
      acquirePaidSeat: true,
    });
    await tx.insert(teamMembers).values({ teamId, userId: guest, role: 'member' });
  });
}

async function remainingAllowance() {
  const [account] = await db
    .select()
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, teamId));
  return account?.includedDiscountRemainingCents;
}

describe('paid membership and restricted guests', () => {
  it('does not bill guests, acquires a full-member seat, and reuses paid capacity without minting usage', async () => {
    await inviteGuest();
    await reconcileTeamPaidSeats({ db, teamId, provider });
    expect(updates).toEqual([]);
    expect(await remainingAllowance()).toBe(TEAM_MONTHLY_USAGE_PER_SEAT_CENTS);
    await activateMember();
    expect(updates).toEqual([{ seats: 2, proration: 'invoice' }]);
    expect(await withTeam(db, teamId, guest).guests.hasAccess()).toBe(false);
    // The verified subscription read confirms one half-period grant.
    const grantedAllowance = TEAM_MONTHLY_USAGE_PER_SEAT_CENTS * 1.5;
    expect(await remainingAllowance()).toBe(grantedAllowance);
    await db
      .update(teamMembers)
      .set({ removedAt: new Date() })
      .where(eq(teamMembers.userId, guest));
    await reconcileTeamPaidSeats({ db, teamId, provider });
    expect(updates.at(-1)).toEqual({ seats: 1, proration: 'next_period' });
    await db.transaction(async (tx) => {
      await assertTeamMemberSeatCapacity({
        db: tx as unknown as Db,
        teamId,
        includePendingInvites: false,
        acquirePaidSeat: true,
      });
      await tx.update(teamMembers).set({ removedAt: null }).where(eq(teamMembers.userId, guest));
    });
    expect(updates.at(-1)).toEqual({ seats: 2, proration: 'next_period' });
    expect(updates.filter((update) => update.proration === 'invoice')).toHaveLength(1);
    expect(await remainingAllowance()).toBe(grantedAllowance);
  });

  it('retains restricted guest access and no full membership when seat acquisition fails', async () => {
    await inviteGuest();
    failProvider = true;
    await expect(activateMember()).rejects.toThrow('Synthetic provider unavailable');
    expect(await db.select().from(teamMembers)).toHaveLength(1);
    expect(await withTeam(db, teamId, guest).guests.hasAccess()).toBe(true);
    expect(await remainingAllowance()).toBe(TEAM_MONTHLY_USAGE_PER_SEAT_CENTS);
  });
});
