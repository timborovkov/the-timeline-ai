import { PGlite } from '@electric-sql/pglite';
import { billingOperatorAudit, teamBillingAccounts, type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import {
  BillingOperatorError,
  assignCompedPlan,
  clearCompedPlan,
  clearTeamPriceOverride,
  setOperatorSpendCap,
  setTeamPolarDiscount,
  setTeamPriceOverride,
  startEnterpriseCheckout,
} from '#src/billing/operator-store.js';
import { resolveTeamCommercialTerms } from '#src/billing/operator.js';
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
    INSERT INTO users (id, email, "emailVerified")
    VALUES
      ('${ADMIN_ID}', 'ops@example.test', '2026-01-01T00:00:00Z'),
      ('${OWNER_ID}', 'owner@example.test', '2026-01-01T00:00:00Z');
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
  it('rejects an allowlisted platform admin until their email is verified', async () => {
    await pg.exec(`UPDATE users SET "emailVerified" = NULL WHERE id = '${ADMIN_ID}'`);
    await expect(
      assignCompedPlan({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
        entitlementsPlanId: 'team',
        spendCapCents: 2_500,
        reason: 'unverified admin',
        expiresAt: null,
      }),
    ).rejects.toThrow('Platform admin email must be verified.');
  });

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

  it('closes an expired Enterprise checkout before saving a comp', async () => {
    await pg.exec(`
      INSERT INTO team_billing_accounts (
        team_id, plan_id, billing_state, spend_cap_cents, shadow_billing, pending_enterprise_terms
      ) VALUES (
        '${TEAM_ID}', 'free', 'free', 0, true,
        '{"byCheckoutId":{"chk_open":{"platformFeeCents":250000,"spendCapCents":80000}}}'::jsonb
      );
    `);
    const expired: string[] = [];
    await assignCompedPlan({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      entitlementsPlanId: 'team',
      spendCapCents: 2_500,
      reason: 'internal comp',
      expiresAt: null,
      expireCheckout: (checkoutId) => {
        expired.push(checkoutId);
        return Promise.resolve('expired');
      },
    });
    expect(expired).toEqual(['chk_open']);
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.arrangement).toBe('comped');
    expect(account?.planId).toBe('team');
    expect(account?.pendingEnterpriseTerms).toBeNull();
  });

  it('refuses a comp while an Enterprise checkout is still payable or already paid', async () => {
    await pg.exec(`
      INSERT INTO team_billing_accounts (
        team_id, plan_id, billing_state, spend_cap_cents, shadow_billing, pending_enterprise_terms
      ) VALUES (
        '${TEAM_ID}', 'free', 'free', 0, true,
        '{"byCheckoutId":{"chk_open":{"platformFeeCents":250000,"spendCapCents":80000}}}'::jsonb
      );
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
    await expect(
      assignCompedPlan({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
        entitlementsPlanId: 'team',
        spendCapCents: 2_500,
        reason: 'internal comp',
        expiresAt: null,
        expireCheckout: () => Promise.resolve('still_open'),
      }),
    ).rejects.toThrow(/still payable/);
    await expect(
      assignCompedPlan({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
        entitlementsPlanId: 'team',
        spendCapCents: 2_500,
        reason: 'internal comp',
        expiresAt: null,
        expireCheckout: () => Promise.resolve('already_paid'),
      }),
    ).rejects.toThrow(/already started payment/);
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.arrangement).toBe('standard');
    expect(account?.pendingEnterpriseTerms).toEqual({
      byCheckoutId: { chk_open: { platformFeeCents: 250000, spendCapCents: 80000 } },
    });
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
    expect(prepared?.planId).toBe('free');
    expect(prepared?.billingState).toBe('free');
    expect(prepared?.polarSubscriptionId).toBeNull();
    expect(prepared?.priceOverride).toBeNull();
    expect(prepared?.pendingEnterpriseTerms).toBeNull();

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
    const [saved] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(saved?.pendingEnterpriseTerms).toEqual({
      byCheckoutId: {
        chk_fake_1: { platformFeeCents: 150_000 },
      },
    });
  });

  it('expires the earlier Enterprise checkout before storing a replacement link', async () => {
    await pg.exec(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '${OWNER_ID}', 'owner');
    `);
    const provider = createFakeBillingProvider();
    await startEnterpriseCheckout({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      platformFeeCents: 100_000,
      spendCapCents: 40_000,
      productId: 'prod_enterprise',
      successUrl: 'https://thetimeline.cc/app/team?section=billing',
      provider,
    });
    const failing = createFakeBillingProvider();
    failing.createCheckoutSession = () => Promise.reject(new Error('polar down'));
    await expect(
      startEnterpriseCheckout({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
        platformFeeCents: 250_000,
        spendCapCents: 80_000,
        productId: 'prod_enterprise',
        successUrl: 'https://thetimeline.cc/app/team?section=billing',
        provider: failing,
      }),
    ).rejects.toThrow(/retry/i);
    expect(failing.expiredCheckoutIds).toEqual(['chk_fake_1']);
    expect(failing.checkouts).toHaveLength(0);
    const [afterFailure] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(afterFailure?.pendingEnterpriseTerms).toEqual({
      byCheckoutId: {
        chk_fake_1: { platformFeeCents: 100_000, spendCapCents: 40_000 },
      },
    });

    await startEnterpriseCheckout({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      platformFeeCents: 250_000,
      includedActiveMembers: 12,
      spendCapCents: 80_000,
      productId: 'prod_enterprise',
      successUrl: 'https://thetimeline.cc/app/team?section=billing',
      provider,
    });
    expect(provider.expiredCheckoutIds).toEqual(['chk_fake_1']);
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.planId).toBe('free');
    expect(account?.pendingEnterpriseTerms).toEqual({
      byCheckoutId: {
        chk_fake_2: {
          platformFeeCents: 250_000,
          includedActiveMembers: 12,
          spendCapCents: 80_000,
        },
      },
    });
  });

  it('does not open a second Enterprise checkout while an earlier one is still payable', async () => {
    await pg.exec(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '${OWNER_ID}', 'owner');
    `);
    const provider = createFakeBillingProvider();
    await startEnterpriseCheckout({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      platformFeeCents: 100_000,
      spendCapCents: 40_000,
      productId: 'prod_enterprise',
      successUrl: 'https://thetimeline.cc/app/team?section=billing',
      provider,
    });

    const stillOpen = createFakeBillingProvider();
    stillOpen.expireCheckout = (checkoutId) => {
      stillOpen.expiredCheckoutIds.push(checkoutId);
      return Promise.resolve('still_open');
    };
    await expect(
      startEnterpriseCheckout({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
        platformFeeCents: 250_000,
        productId: 'prod_enterprise',
        successUrl: 'https://thetimeline.cc/app/team?section=billing',
        provider: stillOpen,
      }),
    ).rejects.toThrow(/still open/i);
    expect(stillOpen.checkouts).toHaveLength(0);

    const paid = createFakeBillingProvider();
    paid.expireCheckout = (checkoutId) => {
      paid.expiredCheckoutIds.push(checkoutId);
      return Promise.resolve('already_paid');
    };
    await expect(
      startEnterpriseCheckout({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
        platformFeeCents: 250_000,
        productId: 'prod_enterprise',
        successUrl: 'https://thetimeline.cc/app/team?section=billing',
        provider: paid,
      }),
    ).rejects.toThrow(/started payment/i);
    expect(paid.checkouts).toHaveLength(0);

    const broken = createFakeBillingProvider();
    broken.expireCheckout = () => Promise.reject(new Error('polar down'));
    await expect(
      startEnterpriseCheckout({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
        platformFeeCents: 250_000,
        productId: 'prod_enterprise',
        successUrl: 'https://thetimeline.cc/app/team?section=billing',
        provider: broken,
      }),
    ).rejects.toThrow(/could not be closed/i);
    expect(broken.checkouts).toHaveLength(0);

    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.pendingEnterpriseTerms).toEqual({
      byCheckoutId: {
        chk_fake_1: { platformFeeCents: 100_000, spendCapCents: 40_000 },
      },
    });
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
    expect(replaced?.planId).toBe('team');
    expect(replaced?.billingState).toBe('canceled');
    expect(replaced?.polarSubscriptionId).toBe('sub_old');
    expect(replaced?.polarProductId).toBe('prod_team');

    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'free', billing_state = 'restricted', polar_subscription_id = 'sub_revoked',
          polar_product_id = 'prod_enterprise'
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
    await pg.exec(`
      UPDATE team_billing_accounts
      SET polar_subscription_id = NULL, polar_product_id = NULL
      WHERE team_id = '${TEAM_ID}';
    `);
    const afterRevoke = await startEnterpriseCheckout({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      platformFeeCents: 100,
      productId: 'prod_enterprise',
      successUrl: 'https://thetimeline.cc/app/team?section=billing',
      provider,
    });
    expect(afterRevoke.url).toContain('https://sandbox.polar.sh/');
    expect(replaced?.pendingEnterpriseTerms).toEqual({
      byCheckoutId: { chk_fake_1: { platformFeeCents: 100 } },
    });
  });

  it('rejects a platform fee override that Polar would not charge', async () => {
    await expect(
      setTeamPriceOverride({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
        override: { platformFeeCents: 100 },
        expiresAt: null,
      }),
    ).rejects.toThrow(/Enterprise checkout/);
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.priceOverride ?? null).toBeNull();
  });

  it('keeps the contracted Enterprise fee when a usage override is replaced or cleared', async () => {
    await pg.exec(`
      INSERT INTO team_billing_accounts (
        team_id, plan_id, billing_state, price_override
      ) VALUES (
        '${TEAM_ID}', 'enterprise', 'enterprise_active',
        '{"platformFeeCents":250000,"includedActiveMembers":4}'::jsonb
      );
    `);
    const actor = { userId: ADMIN_ID, email: 'ops@example.test' };
    await setTeamPriceOverride({
      db,
      actor,
      teamId: TEAM_ID,
      override: { meteredDiscountPercent: 25 },
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });
    const [replaced] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(replaced?.enterprisePlatformFeeCents).toBe(250_000);
    expect(replaced?.priceOverride).toEqual({ meteredDiscountPercent: 25 });

    await clearTeamPriceOverride({ db, actor, teamId: TEAM_ID });
    const [cleared] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(cleared?.enterprisePlatformFeeCents).toBe(250_000);
    expect(cleared?.priceOverride).toBeNull();
    expect(
      resolveTeamCommercialTerms({
        planId: 'enterprise',
        billingState: 'enterprise_active',
        spendCapCents: cleared?.spendCapCents ?? 0,
        enterprisePlatformFeeCents: cleared?.enterprisePlatformFeeCents ?? null,
        priceOverride: cleared?.priceOverride ?? null,
        priceOverrideExpiresAt: cleared?.priceOverrideExpiresAt ?? null,
      }).platformFeeCents,
    ).toBe(250_000);

    await pg.exec(`
      UPDATE team_billing_accounts
      SET enterprise_platform_fee_cents = NULL,
          price_override = '{"platformFeeCents":180000}'::jsonb
      WHERE team_id = '${TEAM_ID}';
    `);
    await clearTeamPriceOverride({ db, actor, teamId: TEAM_ID });
    const [moved] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(moved?.priceOverride).toBeNull();
    expect(moved?.enterprisePlatformFeeCents).toBe(180_000);
    expect(
      resolveTeamCommercialTerms({
        planId: 'enterprise',
        billingState: 'enterprise_active',
        spendCapCents: 0,
        enterprisePlatformFeeCents: moved?.enterprisePlatformFeeCents ?? null,
        priceOverride: null,
        priceOverrideExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
      }).platformFeeCents,
    ).toBe(180_000);
  });

  it('keeps every concurrent Enterprise checkout id when the links overlap', async () => {
    await pg.exec(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '${OWNER_ID}', 'owner');
    `);
    const outer = createFakeBillingProvider();
    let interleaved = false;
    outer.createCheckoutSession = (input) => {
      outer.checkouts.push(input);
      if (!interleaved) {
        interleaved = true;
        const inner = createFakeBillingProvider();
        inner.createCheckoutSession = (innerInput) => {
          inner.checkouts.push(innerInput);
          return Promise.resolve({
            id: 'chk_inner',
            url: 'https://sandbox.polar.sh/checkout/inner',
          });
        };
        return startEnterpriseCheckout({
          db,
          actor: { userId: ADMIN_ID, email: 'ops@example.test' },
          teamId: TEAM_ID,
          platformFeeCents: 100_000,
          productId: 'prod_enterprise',
          successUrl: 'https://thetimeline.cc/app/team?section=billing',
          provider: inner,
        }).then(() => ({
          id: 'chk_outer',
          url: 'https://sandbox.polar.sh/checkout/outer',
        }));
      }
      return Promise.resolve({
        id: 'chk_outer_again',
        url: 'https://sandbox.polar.sh/checkout/outer-again',
      });
    };
    const opened = await startEnterpriseCheckout({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      platformFeeCents: 250_000,
      productId: 'prod_enterprise',
      successUrl: 'https://thetimeline.cc/app/team?section=billing',
      provider: outer,
    });
    expect(opened.url).toContain('https://sandbox.polar.sh/checkout/outer');
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.pendingEnterpriseTerms).toEqual({
      byCheckoutId: {
        chk_inner: { platformFeeCents: 100_000 },
        chk_outer: { platformFeeCents: 250_000 },
      },
    });
  });

  it('does not copy an expired override into Enterprise checkout', async () => {
    await pg.exec(`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '${OWNER_ID}', 'owner');
      INSERT INTO team_billing_accounts (
        team_id, plan_id, billing_state, price_override, price_override_expires_at
      ) VALUES (
        '${TEAM_ID}', 'team', 'team_active',
        '{"includedActiveMembers":4,"meteredDiscountPercent":80,"additionalMemberCents":900}'::jsonb,
        '2020-01-01T00:00:00Z'
      );
    `);
    const provider = createFakeBillingProvider();
    await startEnterpriseCheckout({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      platformFeeCents: 250_000,
      productId: 'prod_enterprise',
      successUrl: 'https://thetimeline.cc/app/team?section=billing',
      provider,
    });
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.planId).toBe('team');
    expect(account?.priceOverrideExpiresAt?.toISOString()).toBe('2020-01-01T00:00:00.000Z');
    expect(account?.pendingEnterpriseTerms).toEqual({
      byCheckoutId: { chk_fake_1: { platformFeeCents: 250_000 } },
    });
  });

  it('clears a comp to restricted Free when the workspace has no grant and a subscription remains', async () => {
    await assignCompedPlan({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      entitlementsPlanId: 'team',
      spendCapCents: 2_500,
      reason: 'internal',
      expiresAt: null,
    });
    await pg.exec(`
      UPDATE team_billing_accounts
      SET polar_subscription_id = 'sub_left'
      WHERE team_id = '${TEAM_ID}';
    `);
    await expect(
      clearCompedPlan({
        db,
        actor: { userId: ADMIN_ID, email: 'ops@example.test' },
        teamId: TEAM_ID,
      }),
    ).rejects.toThrow(/Revoke the Polar subscription/);
    await pg.exec(`
      UPDATE team_billing_accounts
      SET polar_subscription_id = NULL
      WHERE team_id = '${TEAM_ID}';
    `);
    await clearCompedPlan({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
    });
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.arrangement).toBe('standard');
    expect(account?.planId).toBe('free');
    expect(account?.billingState).toBe('restricted');
    expect(account?.spendCapCents).toBe(0);
  });

  it('restores unrestricted Free when the cleared comp still holds the grant', async () => {
    await assignCompedPlan({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      entitlementsPlanId: 'business',
      spendCapCents: 4_000,
      reason: 'internal',
      expiresAt: null,
    });
    await pg.exec(`
      INSERT INTO billing_free_grants (user_id, assigned_team_id)
      VALUES ('${OWNER_ID}', '${TEAM_ID}');
    `);
    await clearCompedPlan({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
    });
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.billingState).toBe('free');
    expect(account?.planId).toBe('free');
  });
});
