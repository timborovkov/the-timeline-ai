import { billingOperatorAudit, teamBillingAccounts, teams, users, type Db } from '@timeline/db';
import { desc, eq, ilike, or, sql } from 'drizzle-orm';

import {
  BILLING_ENTITLEMENTS_VERSION,
  PLAN_CATALOG,
  type BillingPlanId,
} from '#src/billing/catalog.js';
import {
  assertFutureExpiry,
  assertPriceOverride,
  billingOperatorSnapshot,
  billingStateForComp,
  isPlatformAdminEmail,
  type BillingOperatorSnapshot,
  type TeamPriceOverride,
} from '#src/billing/operator.js';
import { getEnv } from '#src/env.js';

export class BillingOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingOperatorError';
  }
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
}): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new BillingOperatorError('A comp reason is required.');
  if (!Number.isInteger(input.spendCapCents) || input.spendCapCents < 0) {
    throw new BillingOperatorError('Spend cap must be a non-negative integer number of cents.');
  }
  const now = input.now ?? new Date();
  assertFutureExpiry(input.expiresAt, now);
  await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await requirePlatformAdmin(db, input.actor);
    const existing = await lockAccount(db, input.teamId);
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
    await writeAudit({
      tx: db,
      teamId: input.teamId,
      actor: input.actor,
      action: 'assign_comp',
      before,
      after: billingOperatorSnapshot(updated),
    });
  });
}

export async function clearCompedPlan(input: {
  db: Db;
  actor: BillingOperatorActor;
  teamId: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await requirePlatformAdmin(db, input.actor);
    const existing = await lockAccount(db, input.teamId);
    if (existing.arrangement !== 'comped') {
      throw new BillingOperatorError('This team is not on a comped plan.');
    }
    const before = billingOperatorSnapshot(existing);
    const [updated] = await db
      .update(teamBillingAccounts)
      .set({
        arrangement: 'standard',
        planId: 'free',
        billingState: 'free',
        compReason: null,
        compExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(teamBillingAccounts.teamId, input.teamId))
      .returning();
    if (!updated) throw new BillingOperatorError('Failed to clear the comp.');
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
  const override = assertPriceOverride(input.override);
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
        priceOverride: override,
        priceOverrideExpiresAt: input.expiresAt,
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
  const now = input.now ?? new Date();
  await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await requirePlatformAdmin(db, input.actor);
    const existing = await lockAccount(db, input.teamId);
    const before = billingOperatorSnapshot(existing);
    const [updated] = await db
      .update(teamBillingAccounts)
      .set({
        priceOverride: null,
        priceOverrideExpiresAt: null,
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
  const polarDiscountId = input.polarDiscountId.trim();
  if (!polarDiscountId) throw new BillingOperatorError('Polar discount id is required.');
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
  if (!Number.isInteger(input.spendCapCents) || input.spendCapCents < 0) {
    throw new BillingOperatorError('Spend cap must be a non-negative integer number of cents.');
  }
  const now = input.now ?? new Date();
  await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    await requirePlatformAdmin(db, input.actor);
    const existing = await lockAccount(db, input.teamId);
    const before = billingOperatorSnapshot(existing);
    const [updated] = await db
      .update(teamBillingAccounts)
      .set({ spendCapCents: input.spendCapCents, updatedAt: now })
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
