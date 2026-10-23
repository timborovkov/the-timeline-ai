import { PGlite } from '@electric-sql/pglite';
import { billingOperatorAudit, teamBillingAccounts, type Db } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BillingOperatorError,
  assignCompedPlan,
  setOperatorSpendCap,
  setTeamPolarDiscount,
  setTeamPriceOverride,
  startEnterpriseCheckout,
} from '#src/billing/operator-store.js';
import { createFakeBillingProvider } from '#src/billing/provider.js';
import { resetEnvForTests } from '#src/env.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ADMIN_ID = '11111111-2222-4333-8444-555555555555';
const OWNER_ID = '22222222-3333-4444-8555-666666666666';

let pg: PGlite;
let db: Db;

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'tim-labs', 'Tim Labs');
    INSERT INTO users (id, email)
    VALUES
      ('${ADMIN_ID}', 'ops@example.test'),
      ('${OWNER_ID}', 'owner@example.test');
  `);
  db = drizzle(pg) as unknown as Db;
  process.env.PLATFORM_ADMIN_EMAILS = 'ops@example.test';
  resetEnvForTests();
});

afterEach(async () => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
  resetEnvForTests();
  await pg.close();
});

describe('billing operator store', () => {
  it('rejects a team owner who is not on the platform allowlist', async () => {
    await expect(
      assignCompedPlan({
        db,
        actor: { userId: OWNER_ID, email: 'owner@example.test' },
        teamId: TEAM_ID,
        entitlementsPlanId: 'team',
        spendCapCents: 2_500,
        reason: 'owner attempt',
        expiresAt: null,
      }),
    ).rejects.toBeInstanceOf(BillingOperatorError);
  });

  it('records comp and price overrides with the previous and next values', async () => {
    await assignCompedPlan({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      entitlementsPlanId: 'team',
      spendCapCents: 2_500,
      reason: 'Tim internal',
      expiresAt: new Date('2026-12-31T23:59:59.999Z'),
    });
    await setTeamPriceOverride({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      override: { meteredDiscountPercent: 25, includedActiveMembers: 10 },
      expiresAt: null,
    });

    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.arrangement).toBe('comped');
    expect(account?.planId).toBe('team');
    expect(account?.spendCapCents).toBe(2_500);
    expect(account?.compReason).toBe('Tim internal');
    expect(account?.priceOverride).toEqual({
      meteredDiscountPercent: 25,
      includedActiveMembers: 10,
    });

    const audit = await db.select().from(billingOperatorAudit);
    expect(audit).toHaveLength(2);
    const comp = audit.find((row) => row.action === 'assign_comp');
    expect(comp?.actorEmail).toBe('ops@example.test');
    expect(comp?.before).toMatchObject({ arrangement: 'standard', planId: 'free' });
    expect(comp?.after).toMatchObject({
      arrangement: 'comped',
      planId: 'team',
      spendCapCents: 2_500,
    });
    const price = audit.find((row) => row.action === 'set_price_override');
    expect(price?.before).toMatchObject({ priceOverride: null });
    expect(price?.after).toMatchObject({
      priceOverride: { meteredDiscountPercent: 25, includedActiveMembers: 10 },
    });
  });

  it('rejects an actor email that does not match the user row', async () => {
    await expect(
      assignCompedPlan({
        db,
        actor: { userId: ADMIN_ID, email: 'other@example.test' },
        teamId: TEAM_ID,
        entitlementsPlanId: 'team',
        spendCapCents: 2_500,
        reason: 'spoofed session',
        expiresAt: null,
      }),
    ).rejects.toThrow(/identity/i);
  });

  it('refuses a comp that would leave a live Polar subscription in place', async () => {
    await pg.exec(`
      INSERT INTO team_billing_accounts (team_id, plan_id, billing_state, polar_subscription_id, spend_cap_cents, shadow_billing)
      VALUES ('${TEAM_ID}', 'team', 'team_active', 'sub_live', 10000, false);
    `);
    await expect(
      assignCompedPlan({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
        entitlementsPlanId: 'team',
        spendCapCents: 2_500,
        reason: 'internal comp',
        expiresAt: null,
      }),
    ).rejects.toThrow(/Configure Polar/);
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.arrangement).toBe('standard');
    expect(account?.polarSubscriptionId).toBe('sub_live');
  });

  it('revokes an existing Polar subscription after the comp is saved', async () => {
    const revoked: string[] = [];
    await pg.exec(`
      INSERT INTO team_billing_accounts (team_id, plan_id, billing_state, polar_subscription_id, spend_cap_cents, shadow_billing)
      VALUES ('${TEAM_ID}', 'team', 'team_active', 'sub_live', 10000, false);
    `);
    await assignCompedPlan({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      entitlementsPlanId: 'team',
      spendCapCents: 2_500,
      reason: 'internal comp',
      expiresAt: null,
      cancelPolarSubscription: (subscriptionId) => {
        revoked.push(subscriptionId);
        return Promise.resolve();
      },
    });
    expect(revoked).toEqual(['sub_live']);
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.arrangement).toBe('comped');
    expect(account?.polarSubscriptionId).toBeNull();
  });

  it('keeps the comp when Polar revoke fails so a retry can stop the fee', async () => {
    await pg.exec(`
      INSERT INTO team_billing_accounts (team_id, plan_id, billing_state, polar_subscription_id, spend_cap_cents, shadow_billing)
      VALUES ('${TEAM_ID}', 'payg', 'payg_active', 'sub_stuck', 2500, false);
    `);
    await expect(
      assignCompedPlan({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
        entitlementsPlanId: 'team',
        spendCapCents: 2_500,
        reason: 'internal comp',
        expiresAt: null,
        cancelPolarSubscription: () =>
          Promise.reject(new Error('Polar subscription revoke failed: 500')),
      }),
    ).rejects.toThrow(/could not be revoked/);
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.arrangement).toBe('comped');
    expect(account?.polarSubscriptionId).toBe('sub_stuck');
  });

  it('restores a spend-cap freeze and leaves past_due paused', async () => {
    await pg.exec(`
      INSERT INTO team_billing_accounts (team_id, plan_id, billing_state, spend_cap_cents, shadow_billing)
      VALUES ('${TEAM_ID}', 'team', 'read_only', 0, false);
    `);
    await setOperatorSpendCap({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      spendCapCents: 2_500,
    });
    const [restored] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(restored?.billingState).toBe('team_active');
    expect(restored?.spendCapCents).toBe(2_500);

    await pg.exec(`
      UPDATE team_billing_accounts
      SET billing_state = 'past_due'
      WHERE team_id = '${TEAM_ID}';
    `);
    await setOperatorSpendCap({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      spendCapCents: 8_000,
    });
    const [stillDue] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(stillDue?.billingState).toBe('past_due');
    expect(stillDue?.spendCapCents).toBe(8_000);
  });

  it('rejects a Polar discount id with unexpected characters', async () => {
    await expect(
      setTeamPolarDiscount({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
        polarDiscountId: 'disc id',
        expiresAt: null,
      }),
    ).rejects.toThrow(/discount id/);
  });

  it('opens an Enterprise checkout at the negotiated fee and can be retried', async () => {
    await pg.exec(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '${OWNER_ID}', 'owner');
    `);
    const failing = createFakeBillingProvider();
    failing.createCheckoutSession = () => Promise.reject(new Error('polar down'));
    await expect(
      startEnterpriseCheckout({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
        platformFeeCents: 150_000,
        includedActiveMembers: 40,
        additionalMemberCents: 300,
        productId: 'prod_enterprise',
        successUrl: 'https://thetimeline.cc/app/team?section=billing&checkout=success',
        provider: failing,
      }),
    ).rejects.toThrow(/retry/i);
    const [prepared] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(prepared?.planId).toBe('enterprise');
    expect(prepared?.billingState).toBe('enterprise_active');
    expect(prepared?.polarSubscriptionId).toBeNull();
    expect(prepared?.priceOverrideExpiresAt).toBeNull();
    expect(prepared?.priceOverride).toMatchObject({
      platformFeeCents: 150_000,
      includedActiveMembers: 40,
      additionalMemberCents: 300,
    });

    const provider = createFakeBillingProvider();
    const result = await startEnterpriseCheckout({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      platformFeeCents: 150_000,
      productId: 'prod_enterprise',
      successUrl: 'https://thetimeline.cc/app/team?section=billing&checkout=success',
      provider,
    });
    expect(result.url).toContain('https://sandbox.polar.sh/');
    expect(provider.checkouts).toEqual([
      expect.objectContaining({
        amount: 150_000,
        productId: 'prod_enterprise',
        externalCustomerId: TEAM_ID,
        customerEmail: 'owner@example.test',
      }),
    ]);
    expect(provider.customers.get(TEAM_ID)?.email).toBe('owner@example.test');
  });

  it('refuses Enterprise checkout for a comp or a live subscription', async () => {
    await pg.exec(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '${OWNER_ID}', 'owner');
    `);
    await assignCompedPlan({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      entitlementsPlanId: 'team',
      spendCapCents: 2_500,
      reason: 'internal',
      expiresAt: null,
    });
    const provider = createFakeBillingProvider();
    await expect(
      startEnterpriseCheckout({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
        platformFeeCents: 100,
        productId: 'prod_enterprise',
        successUrl: 'https://thetimeline.cc/app/team?section=billing',
        provider,
      }),
    ).rejects.toThrow(/comp/i);
    expect(provider.checkouts).toHaveLength(0);

    await pg.exec(`
      UPDATE team_billing_accounts
      SET arrangement = 'standard', plan_id = 'team', billing_state = 'team_active',
          polar_subscription_id = 'sub_live'
      WHERE team_id = '${TEAM_ID}';
    `);
    await expect(
      startEnterpriseCheckout({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
        platformFeeCents: 100,
        productId: 'prod_enterprise',
        successUrl: 'https://thetimeline.cc/app/team?section=billing',
        provider,
      }),
    ).rejects.toThrow(/Cancel the current Polar subscription/);
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.planId).toBe('team');
    expect(account?.polarSubscriptionId).toBe('sub_live');

    await pg.exec(`
      UPDATE team_billing_accounts
      SET billing_state = 'canceled', polar_subscription_id = 'sub_old',
          polar_product_id = 'prod_team'
      WHERE team_id = '${TEAM_ID}';
    `);
    const opened = await startEnterpriseCheckout({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      platformFeeCents: 100,
      productId: 'prod_enterprise',
      successUrl: 'https://thetimeline.cc/app/team?section=billing',
      provider,
    });
    expect(opened.url).toContain('https://sandbox.polar.sh/');
    const [replaced] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(replaced?.planId).toBe('enterprise');
    expect(replaced?.billingState).toBe('enterprise_active');
    expect(replaced?.polarSubscriptionId).toBeNull();
    expect(replaced?.polarProductId).toBeNull();
  });
});
