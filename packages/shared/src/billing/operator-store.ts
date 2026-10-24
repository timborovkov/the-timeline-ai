import {
  billingFreeGrants,
  billingOperatorAudit,
  billingUnbilledAlerts,
  teamBillingAccounts,
  teamMembers,
  teams,
  users,
  type Db,
} from '@timeline/db';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';

import type { BillingProvider } from '#src/billing/provider.js';

import {
  BILLING_ENTITLEMENTS_VERSION,
  PLAN_CATALOG,
  type BillingPlanId,
} from '#src/billing/catalog.js';
import {
  activePolarDiscountId,
  activePriceOverride,
  assertFutureExpiry,
  assertPriceOverride,
  billingOperatorSnapshot,
  billingStateForComp,
  isPlatformAdminEmail,
  polarCheckoutUrl,
  readPendingEnterpriseTerms,
  type BillingOperatorSnapshot,
  type PendingEnterpriseTerms,
  type StoredPendingEnterpriseTerms,
  type TeamPriceOverride,
} from '#src/billing/operator.js';
import { recordBillingPlan } from '#src/billing/plan-history.js';
import { getEnv } from '#src/env.js';

/** Move a legacy JSON fee onto the column before a usage override replaces it. */
function preservedEnterprisePlatformFee(existing: {
  enterprisePlatformFeeCents?: number | null;
  priceOverride?: { platformFeeCents?: number } | null;
}): { enterprisePlatformFeeCents: number } | undefined {
  if (
    existing.enterprisePlatformFeeCents !== null &&
    existing.enterprisePlatformFeeCents !== undefined
  ) {
    return undefined;
  }
  const fromOverride = existing.priceOverride?.platformFeeCents;
  if (fromOverride === undefined) return undefined;
  return { enterprisePlatformFeeCents: fromOverride };
}

export class BillingOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingOperatorError';
  }
}

const FROM_BILLING_OPERATOR_SCOPE = Symbol('billing-operator-scope');

function isOperatorScopeReentry(input: object): boolean {
  return Boolean(
    (input as { [FROM_BILLING_OPERATOR_SCOPE]?: boolean })[FROM_BILLING_OPERATOR_SCOPE],
  );
}

async function loadBillingOperator(db: Db, actor: BillingOperatorActor, teamId: string) {
  const { withTeam } = await import('#src/team-scope.js');
  return withTeam(db, teamId, actor.userId, { skipMembershipCheck: true }).billingOperator;
}

export interface BillingOperatorActor {
  userId: string;
  email: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

async function requirePlatformAdmin(db: Db, actor: BillingOperatorActor): Promise<void> {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, actor.userId))
    .limit(1);
  const email = user?.email ?? '';
  if (email.toLowerCase() !== actor.email.trim().toLowerCase()) {
    throw new BillingOperatorError('Operator identity does not match a Timeline user.');
  }
  if (!isPlatformAdminEmail(email, getEnv().PLATFORM_ADMIN_EMAILS)) {
    throw new BillingOperatorError('Only platform admins can change billing overrides.');
  }
}

function billingStateAfterOperatorCapRaise(
  planId: BillingPlanId,
  billingState: string,
  spendCapCents: number,
): string | null {
  if (spendCapCents <= 0) return null;
  if (billingState !== 'read_only' && billingState !== 'balance_exhausted') return null;
  return billingStateForComp(planId);
}

async function lockAccount(tx: Db, teamId: string) {
  const [team] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) throw new BillingOperatorError('Team not found.');
  const [existing] = await tx
    .select()
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, teamId))
    .limit(1)
    .for('update');
  if (existing) return existing;
  const [created] = await tx
    .insert(teamBillingAccounts)
    .values({
      teamId,
      planId: 'free',
      billingState: 'free',
      securityState: 'normal',
      entitlementsVersion: BILLING_ENTITLEMENTS_VERSION,
      spendCapCents: PLAN_CATALOG.free.defaultSpendCapCents,
      shadowBilling: true,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await tx
    .select()
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, teamId))
    .limit(1)
    .for('update');
  if (!again) throw new BillingOperatorError('Failed to open the billing account.');
  return again;
}

async function writeAudit(input: {
  tx: Db;
  teamId: string;
  actor: BillingOperatorActor;
  action: string;
  before: BillingOperatorSnapshot;
  after: BillingOperatorSnapshot;
}): Promise<void> {
  await input.tx.insert(billingOperatorAudit).values({
    teamId: input.teamId,
    actorUserId: input.actor.userId,
    actorEmail: input.actor.email.trim().toLowerCase(),
    action: input.action,
    before: input.before as unknown as Record<string, unknown>,
    after: input.after as unknown as Record<string, unknown>,
  });
}

export async function assignCompedPlan(input: {
  db: Db;
  actor: BillingOperatorActor;
  teamId: string;
  entitlementsPlanId: BillingPlanId;
  spendCapCents: number;
  reason: string;
  expiresAt: Date | null;
  now?: Date;
  /** Revoke the current Polar subscription after the comp is committed. */
  cancelPolarSubscription?: (subscriptionId: string) => Promise<void>;
}): Promise<void> {
  if (!isOperatorScopeReentry(input)) {
    return (await loadBillingOperator(input.db, input.actor, input.teamId)).assignCompedPlan(input);
  }
  const reason = input.reason.trim();
  if (reason.length < 3) throw new BillingOperatorError('A comp reason is required.');
  if (!Number.isInteger(input.spendCapCents) || input.spendCapCents < 0) {
    throw new BillingOperatorError('Spend cap must be a non-negative integer number of cents.');
  }
  const now = input.now ?? new Date();
  assertFutureExpiry(input.expiresAt, now);
  const polarSubscriptionId = await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await requirePlatformAdmin(db, input.actor);
    const existing = await lockAccount(db, input.teamId);
    if (existing.polarSubscriptionId && !input.cancelPolarSubscription) {
      throw new BillingOperatorError(
        'This workspace has a Polar subscription. Configure Polar before assigning a comp so the subscription fee can be revoked.',
      );
    }
    const before = billingOperatorSnapshot(existing);
    const billingState = billingStateForComp(input.entitlementsPlanId);
    const [updated] = await db
      .update(teamBillingAccounts)
      .set({
        arrangement: 'comped',
        planId: input.entitlementsPlanId,
        billingState,
        spendCapCents: input.spendCapCents,
        compReason: reason,
        compExpiresAt: input.expiresAt,
        updatedAt: now,
      })
      .where(eq(teamBillingAccounts.teamId, input.teamId))
      .returning();
    if (!updated) throw new BillingOperatorError('Failed to assign the comp.');
    await recordBillingPlan(db, input.teamId, input.entitlementsPlanId, now);
    await writeAudit({
      tx: db,
      teamId: input.teamId,
      actor: input.actor,
      action: 'assign_comp',
      before,
      after: billingOperatorSnapshot(updated),
    });
    return existing.polarSubscriptionId;
  });
  if (!polarSubscriptionId || !input.cancelPolarSubscription) return;
  try {
    await input.cancelPolarSubscription(polarSubscriptionId);
  } catch (error) {
    if (error instanceof BillingOperatorError) throw error;
    throw new BillingOperatorError(
      'The comp is saved and new Polar usage will not be ingested, but the existing Polar subscription could not be revoked. Retry the comp to stop the subscription fee.',
    );
  }
  await input.db
    .update(teamBillingAccounts)
    .set({ polarSubscriptionId: null, polarProductId: null, updatedAt: new Date() })
    .where(
      and(
        eq(teamBillingAccounts.teamId, input.teamId),
        eq(teamBillingAccounts.polarSubscriptionId, polarSubscriptionId),
      ),
    );
}

export async function clearCompedPlan(input: {
  db: Db;
  actor: BillingOperatorActor;
  teamId: string;
  now?: Date;
}): Promise<void> {
  if (!isOperatorScopeReentry(input)) {
    return (await loadBillingOperator(input.db, input.actor, input.teamId)).clearCompedPlan(input);
  }
  const now = input.now ?? new Date();
  await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await requirePlatformAdmin(db, input.actor);
    const existing = await lockAccount(db, input.teamId);
    if (existing.arrangement !== 'comped') {
      throw new BillingOperatorError('This team is not on a comped plan.');
    }
    if (existing.polarSubscriptionId) {
      throw new BillingOperatorError(
        'Revoke the Polar subscription before clearing this comp. The comp stays in place until that subscription is gone.',
      );
    }
    const [grant] = await db
      .select({ id: billingFreeGrants.id })
      .from(billingFreeGrants)
      .where(
        and(
          eq(billingFreeGrants.assignedTeamId, input.teamId),
          isNull(billingFreeGrants.revokedAt),
        ),
      )
      .limit(1);
    const unrestricted = Boolean(grant);
    const before = billingOperatorSnapshot(existing);
    const [updated] = await db
      .update(teamBillingAccounts)
      .set({
        arrangement: 'standard',
        planId: 'free',
        billingState: unrestricted ? 'free' : 'restricted',
        spendCapCents: unrestricted ? PLAN_CATALOG.free.defaultSpendCapCents : 0,
        compReason: null,
        compExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(teamBillingAccounts.teamId, input.teamId))
      .returning();
    if (!updated) throw new BillingOperatorError('Failed to clear the comp.');
    await recordBillingPlan(db, input.teamId, 'free', now);
    await writeAudit({
      tx: db,
      teamId: input.teamId,
      actor: input.actor,
      action: 'clear_comp',
      before,
      after: billingOperatorSnapshot(updated),
    });
  });
}

export async function setTeamPriceOverride(input: {
  db: Db;
  actor: BillingOperatorActor;
  teamId: string;
  override: TeamPriceOverride;
  expiresAt: Date | null;
  now?: Date;
}): Promise<void> {
  if (!isOperatorScopeReentry(input)) {
    return (await loadBillingOperator(input.db, input.actor, input.teamId)).setTeamPriceOverride(
      input,
    );
  }
  const override = assertPriceOverride(input.override);
  if (override.platformFeeCents !== undefined) {
    throw new BillingOperatorError(
      'Platform fee changes go through Enterprise checkout so Polar charges the same fee.',
    );
  }
  const now = input.now ?? new Date();
  assertFutureExpiry(input.expiresAt, now);
  await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await requirePlatformAdmin(db, input.actor);
    const existing = await lockAccount(db, input.teamId);
    const before = billingOperatorSnapshot(existing);
    const preservedFee = preservedEnterprisePlatformFee(existing);
    const [updated] = await db
      .update(teamBillingAccounts)
      .set({
        priceOverride: override,
        priceOverrideExpiresAt: input.expiresAt,
        ...(preservedFee ?? {}),
        updatedAt: now,
      })
      .where(eq(teamBillingAccounts.teamId, input.teamId))
      .returning();
    if (!updated) throw new BillingOperatorError('Failed to save the price override.');
    await writeAudit({
      tx: db,
      teamId: input.teamId,
      actor: input.actor,
      action: 'set_price_override',
      before,
      after: billingOperatorSnapshot(updated),
    });
  });
}

export async function clearTeamPriceOverride(input: {
  db: Db;
  actor: BillingOperatorActor;
  teamId: string;
  now?: Date;
}): Promise<void> {
  if (!isOperatorScopeReentry(input)) {
    return (await loadBillingOperator(input.db, input.actor, input.teamId)).clearTeamPriceOverride(
      input,
    );
  }
  const now = input.now ?? new Date();
  await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await requirePlatformAdmin(db, input.actor);
    const existing = await lockAccount(db, input.teamId);
    const before = billingOperatorSnapshot(existing);
    const preservedFee = preservedEnterprisePlatformFee(existing);
    const [updated] = await db
      .update(teamBillingAccounts)
      .set({
        priceOverride: null,
        priceOverrideExpiresAt: null,
        ...(preservedFee ?? {}),
        updatedAt: now,
      })
      .where(eq(teamBillingAccounts.teamId, input.teamId))
      .returning();
    if (!updated) throw new BillingOperatorError('Failed to clear the price override.');
    await writeAudit({
      tx: db,
      teamId: input.teamId,
      actor: input.actor,
      action: 'clear_price_override',
      before,
      after: billingOperatorSnapshot(updated),
    });
  });
}

export async function setTeamPolarDiscount(input: {
  db: Db;
  actor: BillingOperatorActor;
  teamId: string;
  polarDiscountId: string;
  expiresAt: Date | null;
  now?: Date;
}): Promise<void> {
  if (!isOperatorScopeReentry(input)) {
    return (await loadBillingOperator(input.db, input.actor, input.teamId)).setTeamPolarDiscount(
      input,
    );
  }
  const polarDiscountId = input.polarDiscountId.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(polarDiscountId)) {
    throw new BillingOperatorError('Polar discount id must be letters, numbers, _ or -.');
  }
  const now = input.now ?? new Date();
  assertFutureExpiry(input.expiresAt, now);
  await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await requirePlatformAdmin(db, input.actor);
    const existing = await lockAccount(db, input.teamId);
    const before = billingOperatorSnapshot(existing);
    const [updated] = await db
      .update(teamBillingAccounts)
      .set({
        polarDiscountId,
        polarDiscountExpiresAt: input.expiresAt,
        updatedAt: now,
      })
      .where(eq(teamBillingAccounts.teamId, input.teamId))
      .returning();
    if (!updated) throw new BillingOperatorError('Failed to save the Polar discount.');
    await writeAudit({
      tx: db,
      teamId: input.teamId,
      actor: input.actor,
      action: 'set_polar_discount',
      before,
      after: billingOperatorSnapshot(updated),
    });
  });
}

export async function clearTeamPolarDiscount(input: {
  db: Db;
  actor: BillingOperatorActor;
  teamId: string;
  now?: Date;
}): Promise<void> {
  if (!isOperatorScopeReentry(input)) {
    return (await loadBillingOperator(input.db, input.actor, input.teamId)).clearTeamPolarDiscount(
      input,
    );
  }
  const now = input.now ?? new Date();
  await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await requirePlatformAdmin(db, input.actor);
    const existing = await lockAccount(db, input.teamId);
    const before = billingOperatorSnapshot(existing);
    const [updated] = await db
      .update(teamBillingAccounts)
      .set({
        polarDiscountId: null,
        polarDiscountExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(teamBillingAccounts.teamId, input.teamId))
      .returning();
    if (!updated) throw new BillingOperatorError('Failed to clear the Polar discount.');
    await writeAudit({
      tx: db,
      teamId: input.teamId,
      actor: input.actor,
      action: 'clear_polar_discount',
      before,
      after: billingOperatorSnapshot(updated),
    });
  });
}

export async function setOperatorSpendCap(input: {
  db: Db;
  actor: BillingOperatorActor;
  teamId: string;
  spendCapCents: number;
  now?: Date;
}): Promise<void> {
  if (!isOperatorScopeReentry(input)) {
    return (await loadBillingOperator(input.db, input.actor, input.teamId)).setOperatorSpendCap(
      input,
    );
  }
  if (!Number.isInteger(input.spendCapCents) || input.spendCapCents < 0) {
    throw new BillingOperatorError('Spend cap must be a non-negative integer number of cents.');
  }
  const now = input.now ?? new Date();
  await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await requirePlatformAdmin(db, input.actor);
    const existing = await lockAccount(db, input.teamId);
    const before = billingOperatorSnapshot(existing);
    const restoredState = billingStateAfterOperatorCapRaise(
      existing.planId,
      existing.billingState,
      input.spendCapCents,
    );
    const [updated] = await db
      .update(teamBillingAccounts)
      .set({
        spendCapCents: input.spendCapCents,
        ...(restoredState ? { billingState: restoredState as typeof existing.billingState } : {}),
        updatedAt: now,
      })
      .where(eq(teamBillingAccounts.teamId, input.teamId))
      .returning();
    if (!updated) throw new BillingOperatorError('Failed to update the spend cap.');
    await writeAudit({
      tx: db,
      teamId: input.teamId,
      actor: input.actor,
      action: 'set_spend_cap',
      before,
      after: billingOperatorSnapshot(updated),
    });
  });
}

export async function findOperatorTeams(input: {
  db: Db;
  actor: BillingOperatorActor;
  query: string;
}): Promise<{ id: string; name: string; slug: string }[]> {
  await requirePlatformAdmin(input.db, input.actor);
  const query = input.query.trim();
  if (!query) return [];
  const pattern = `%${query.replace(/[%_\\]/gu, '')}%`;
  return input.db
    .select({ id: teams.id, name: teams.name, slug: teams.slug })
    .from(teams)
    .where(
      UUID_RE.test(query)
        ? or(eq(teams.id, query), ilike(teams.slug, pattern), ilike(teams.name, pattern))
        : or(ilike(teams.slug, pattern), ilike(teams.name, pattern)),
    )
    .orderBy(teams.name)
    .limit(20);
}

export async function listBillingOperatorAudit(input: {
  db: Db;
  actor: BillingOperatorActor;
  teamId: string;
  limit?: number;
}): Promise<
  {
    id: string;
    action: string;
    actorEmail: string;
    before: BillingOperatorSnapshot;
    after: BillingOperatorSnapshot;
    createdAt: Date;
  }[]
> {
  if (!isOperatorScopeReentry(input)) {
    return (
      await loadBillingOperator(input.db, input.actor, input.teamId)
    ).listBillingOperatorAudit(input);
  }
  await requirePlatformAdmin(input.db, input.actor);
  const rows = await input.db
    .select()
    .from(billingOperatorAudit)
    .where(eq(billingOperatorAudit.teamId, input.teamId))
    .orderBy(desc(billingOperatorAudit.createdAt))
    .limit(input.limit ?? 50);
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorEmail: row.actorEmail,
    before: row.before as unknown as BillingOperatorSnapshot,
    after: row.after as unknown as BillingOperatorSnapshot,
    createdAt: row.createdAt,
  }));
}

const ENTERPRISE_CHECKOUT_BLOCKED_STATES = new Set(['canceled', 'deletion_scheduled']);

export async function startEnterpriseCheckout(input: {
  db: Db;
  actor: BillingOperatorActor;
  teamId: string;
  platformFeeCents: number;
  includedActiveMembers?: number;
  additionalMemberCents?: number;
  meteredDiscountPercent?: number;
  spendCapCents?: number;
  productId: string;
  successUrl: string;
  provider: BillingProvider;
  now?: Date;
}): Promise<{ url: string }> {
  if (!isOperatorScopeReentry(input)) {
    return (await loadBillingOperator(input.db, input.actor, input.teamId)).startEnterpriseCheckout(
      input,
    );
  }
  if (!input.productId.trim()) {
    throw new BillingOperatorError('POLAR_PRODUCT_ID_ENTERPRISE is not configured.');
  }
  if (input.spendCapCents !== undefined) {
    if (!Number.isInteger(input.spendCapCents) || input.spendCapCents < 0) {
      throw new BillingOperatorError('Spend cap must be a non-negative integer number of cents.');
    }
  }
  let override: TeamPriceOverride;
  try {
    override = assertPriceOverride({
      platformFeeCents: input.platformFeeCents,
      ...(input.includedActiveMembers !== undefined
        ? { includedActiveMembers: input.includedActiveMembers }
        : {}),
      ...(input.additionalMemberCents !== undefined
        ? { additionalMemberCents: input.additionalMemberCents }
        : {}),
      ...(input.meteredDiscountPercent !== undefined
        ? { meteredDiscountPercent: input.meteredDiscountPercent }
        : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid Enterprise price.';
    throw new BillingOperatorError(message);
  }
  const now = input.now ?? new Date();
  const prepared = await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await requirePlatformAdmin(db, input.actor);
    const existing = await lockAccount(db, input.teamId);
    assertEnterpriseCheckoutAllowed(existing);
    const [owner] = await db
      .select({ email: users.email })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(
        and(
          eq(teamMembers.teamId, input.teamId),
          eq(teamMembers.role, 'owner'),
          isNull(teamMembers.removedAt),
        ),
      )
      .limit(1);
    if (!owner?.email) {
      throw new BillingOperatorError(
        'The team needs an active owner email before Enterprise checkout.',
      );
    }
    const merged = assertPriceOverride({
      ...(activePriceOverride(existing, now) ?? {}),
      ...override,
    });
    const terms: PendingEnterpriseTerms = {
      ...merged,
      platformFeeCents: merged.platformFeeCents ?? input.platformFeeCents,
      ...(input.spendCapCents !== undefined ? { spendCapCents: input.spendCapCents } : {}),
    };
    return {
      email: owner.email,
      discountId: activePolarDiscountId(existing, now),
      terms,
    };
  });

  let checkout: { url: string; id: string };
  try {
    await input.provider.ensureCustomer({
      externalId: input.teamId,
      email: prepared.email,
    });
    checkout = await input.provider.createCheckoutSession({
      externalCustomerId: input.teamId,
      customerEmail: prepared.email,
      productId: input.productId,
      successUrl: input.successUrl,
      amount: input.platformFeeCents,
      ...(prepared.discountId ? { discountId: prepared.discountId } : {}),
    });
    const url = polarCheckoutUrl(checkout.url);
    if (!url || checkout.id.trim().length === 0) {
      throw new BillingOperatorError('Polar returned a checkout URL that is not on polar.sh.');
    }
    checkout = { url, id: checkout.id.trim() };
  } catch (error) {
    if (error instanceof BillingOperatorError) throw error;
    throw new BillingOperatorError(
      'Polar checkout could not be opened; retry to get a checkout link.',
    );
  }

  await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await requirePlatformAdmin(db, input.actor);
    const existing = await lockAccount(db, input.teamId);
    assertEnterpriseCheckoutAllowed(existing);
    const parsed = readPendingEnterpriseTerms(existing.pendingEnterpriseTerms);
    const pendingEnterpriseTerms: StoredPendingEnterpriseTerms = {
      byCheckoutId: {
        ...parsed.byCheckoutId,
        [checkout.id]: prepared.terms,
      },
    };
    const before = billingOperatorSnapshot(existing);
    const [updated] = await db
      .update(teamBillingAccounts)
      .set({
        pendingEnterpriseTerms,
        updatedAt: now,
      })
      .where(eq(teamBillingAccounts.teamId, input.teamId))
      .returning();
    if (!updated) throw new BillingOperatorError('Failed to save the Enterprise terms.');
    await writeAudit({
      tx: db,
      teamId: input.teamId,
      actor: input.actor,
      action: 'start_enterprise_checkout',
      before,
      after: billingOperatorSnapshot(updated),
    });
  });
  return { url: checkout.url };
}

function assertEnterpriseCheckoutAllowed(existing: {
  arrangement: string;
  polarSubscriptionId: string | null;
  billingState: string;
}): void {
  if (existing.arrangement === 'comped') {
    throw new BillingOperatorError('Clear the comp before opening an Enterprise checkout.');
  }
  if (
    existing.polarSubscriptionId &&
    !ENTERPRISE_CHECKOUT_BLOCKED_STATES.has(existing.billingState)
  ) {
    throw new BillingOperatorError(
      'Cancel the current Polar subscription before opening an Enterprise checkout so two subscriptions are not billed.',
    );
  }
}

export async function listOpenUnbilledAlerts(input: {
  db: Db;
  actor: BillingOperatorActor;
  teamId: string;
  limit?: number;
}): Promise<
  {
    id: string;
    teamId: string;
    meterId: string;
    periodYm: string;
    reason: string;
    detail: string | null;
    createdAt: Date;
  }[]
> {
  if (!isOperatorScopeReentry(input)) {
    return (await loadBillingOperator(input.db, input.actor, input.teamId)).listOpenUnbilledAlerts(
      input,
    );
  }
  await requirePlatformAdmin(input.db, input.actor);
  const rows = await input.db
    .select({
      id: billingUnbilledAlerts.id,
      teamId: billingUnbilledAlerts.teamId,
      meterId: billingUnbilledAlerts.meterId,
      periodYm: billingUnbilledAlerts.periodYm,
      reason: billingUnbilledAlerts.reason,
      detail: billingUnbilledAlerts.detail,
      createdAt: billingUnbilledAlerts.createdAt,
    })
    .from(billingUnbilledAlerts)
    .where(
      and(isNull(billingUnbilledAlerts.resolvedAt), eq(billingUnbilledAlerts.teamId, input.teamId)),
    )
    .orderBy(desc(billingUnbilledAlerts.createdAt))
    .limit(input.limit ?? 50);
  return rows;
}

export async function readOperatorBillingAccount(input: {
  db: Db;
  actor: BillingOperatorActor;
  teamId: string;
}): Promise<typeof teamBillingAccounts.$inferSelect | null> {
  if (!isOperatorScopeReentry(input)) {
    return (await loadBillingOperator(input.db, input.actor, input.teamId)).readAccount(input);
  }
  await requirePlatformAdmin(input.db, input.actor);
  const [row] = await input.db
    .select()
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, input.teamId))
    .limit(1);
  return row ?? null;
}

function scopedOperatorInput<T extends object>(db: Db, teamId: string, input: T): T {
  return {
    ...input,
    db,
    teamId,
    [FROM_BILLING_OPERATOR_SCOPE]: true,
  };
}

/** Team-scoped operator reads and writes. `teamId` is fixed by `withTeam`. */
export function createBillingOperatorScope(deps: { db: Db; teamId: string }) {
  const { db, teamId } = deps;
  return {
    assignCompedPlan(input: Parameters<typeof assignCompedPlan>[0]) {
      return assignCompedPlan(scopedOperatorInput(db, teamId, input));
    },
    clearCompedPlan(input: Parameters<typeof clearCompedPlan>[0]) {
      return clearCompedPlan(scopedOperatorInput(db, teamId, input));
    },
    setTeamPriceOverride(input: Parameters<typeof setTeamPriceOverride>[0]) {
      return setTeamPriceOverride(scopedOperatorInput(db, teamId, input));
    },
    clearTeamPriceOverride(input: Parameters<typeof clearTeamPriceOverride>[0]) {
      return clearTeamPriceOverride(scopedOperatorInput(db, teamId, input));
    },
    setTeamPolarDiscount(input: Parameters<typeof setTeamPolarDiscount>[0]) {
      return setTeamPolarDiscount(scopedOperatorInput(db, teamId, input));
    },
    clearTeamPolarDiscount(input: Parameters<typeof clearTeamPolarDiscount>[0]) {
      return clearTeamPolarDiscount(scopedOperatorInput(db, teamId, input));
    },
    setOperatorSpendCap(input: Parameters<typeof setOperatorSpendCap>[0]) {
      return setOperatorSpendCap(scopedOperatorInput(db, teamId, input));
    },
    listBillingOperatorAudit(input: Parameters<typeof listBillingOperatorAudit>[0]) {
      return listBillingOperatorAudit(scopedOperatorInput(db, teamId, input));
    },
    startEnterpriseCheckout(input: Parameters<typeof startEnterpriseCheckout>[0]) {
      return startEnterpriseCheckout(scopedOperatorInput(db, teamId, input));
    },
    listOpenUnbilledAlerts(input: Parameters<typeof listOpenUnbilledAlerts>[0]) {
      return listOpenUnbilledAlerts(scopedOperatorInput(db, teamId, input));
    },
    readAccount(input: Parameters<typeof readOperatorBillingAccount>[0]) {
      return readOperatorBillingAccount(scopedOperatorInput(db, teamId, input));
    },
  };
}

export async function lookupOperatorActor(db: Db, email: string): Promise<BillingOperatorActor> {
  const normalized = email.trim().toLowerCase();
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`)
    .limit(1);
  if (!user) throw new BillingOperatorError('No Timeline user exists for that email.');
  return { userId: user.id, email: user.email };
}
