import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

/**
 * Commercial plan + payment lifecycle (Polar subscriptions, invoiced in arrears).
 * Independent from `team_security_state` — a paid balance never clears a
 * security suspension.
 */
export const teamBillingState = pgEnum('team_billing_state', [
  'free',
  'payg_active',
  'team_active',
  'business_active',
  'enterprise_active',
  'balance_exhausted',
  'payment_retry',
  'past_due',
  'grace',
  'restricted',
  'read_only',
  'canceled',
  'deletion_scheduled',
]);

export const teamSecurityState = pgEnum('team_security_state', [
  'normal',
  'challenged',
  'restricted',
  'suspended',
  'terminated',
]);

export const billingPlanId = pgEnum('billing_plan_id', [
  'free',
  'payg',
  'team',
  'business',
  'enterprise',
]);

export const billingMeterId = pgEnum('billing_meter_id', [
  'ai',
  'recall_minutes',
  'email_units',
  'storage_gb_month',
  'accepted_sources',
  'member_days',
]);

export const usageReservationState = pgEnum('usage_reservation_state', [
  'reserved',
  'settled',
  'released',
  'expired',
]);

export const usageLedgerKind = pgEnum('usage_ledger_kind', [
  'settlement',
  'reversal',
  'grant',
  'top_up',
  'member_day',
  'discount_applied',
  'adjustment',
]);

/** Per-team commercial + Polar linkage. One row per team. */
export const teamBillingAccounts = pgTable('team_billing_accounts', {
  teamId: uuid('team_id')
    .primaryKey()
    .references(() => teams.id, { onDelete: 'cascade' }),
  planId: billingPlanId('plan_id').notNull().default('free'),
  billingState: teamBillingState('billing_state').notNull().default('free'),
  securityState: teamSecurityState('security_state').notNull().default('normal'),
  entitlementsVersion: text('entitlements_version').notNull().default('v1'),
  polarCustomerId: text('polar_customer_id'),
  polarSubscriptionId: text('polar_subscription_id'),
  polarProductId: text('polar_product_id'),
  /** Hard monthly overage spend ceiling in euro cents (customer-controlled). */
  spendCapCents: integer('spend_cap_cents').notNull().default(0),
  /**
   * Retired prepaid-wallet columns. New reservations do not debit or credit
   * them. A historical `wallet_lock_cents` stamp can still unwind
   * `reserved_balance_cents` on settle, release, or expiry.
   */
  walletBalanceCents: integer('wallet_balance_cents').notNull().default(0),
  reservedBalanceCents: integer('reserved_balance_cents').notNull().default(0),
  autoReloadEnabled: boolean('auto_reload_enabled').notNull().default(false),
  autoReloadThresholdCents: integer('auto_reload_threshold_cents'),
  autoReloadAmountCents: integer('auto_reload_amount_cents'),
  /** Included invoice discount remaining this period (Team/Business), euro cents. */
  includedDiscountRemainingCents: integer('included_discount_remaining_cents').notNull().default(0),
  periodStartedAt: timestamp('period_started_at', { withTimezone: true }),
  periodEndsAt: timestamp('period_ends_at', { withTimezone: true }),
  /**
   * Polar subscription `modified_at` last applied to this row. Wallet, spend-cap,
   * and shadow writes bump `updated_at` and must not hide newer Polar events.
   */
  polarEventModifiedAt: timestamp('polar_event_modified_at', { withTimezone: true }),
  shadowBilling: boolean('shadow_billing').notNull().default(true),
  /**
   * `standard` bills through Polar. `comped` skips new Polar charges and
   * revokes the current subscription.
   */
  arrangement: text('arrangement').$type<'standard' | 'comped'>().notNull().default('standard'),
  compReason: text('comp_reason'),
  compExpiresAt: timestamp('comp_expires_at', { withTimezone: true }),
  priceOverride: jsonb('price_override').$type<{
    platformFeeCents?: number;
    includedActiveMembers?: number;
    additionalMemberCents?: number;
    meteredDiscountPercent?: number;
  } | null>(),
  priceOverrideExpiresAt: timestamp('price_override_expires_at', { withTimezone: true }),
  /**
   * Enterprise checkout terms waiting for the first paid subscription.
   * They do not change plan, entitlements, or the live price override.
   */
  pendingEnterpriseTerms: jsonb('pending_enterprise_terms').$type<{
    platformFeeCents: number;
    includedActiveMembers?: number;
    additionalMemberCents?: number;
    meteredDiscountPercent?: number;
    spendCapCents?: number;
  } | null>(),
  polarDiscountId: text('polar_discount_id'),
  polarDiscountExpiresAt: timestamp('polar_discount_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Plan effective-at history. Storage replay prices a missed day with the plan
 * that was in force then, not the live plan.
 */
export const billingPlanHistory = pgTable(
  'billing_plan_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    planId: billingPlanId('plan_id').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('billing_plan_history_team_effective_idx').on(table.teamId, table.effectiveAt)],
);

/** Append-only platform-operator history for comp and price overrides. */
export const billingOperatorAudit = pgTable(
  'billing_operator_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email').notNull(),
    action: text('action').notNull(),
    before: jsonb('before').$type<Record<string, unknown>>().notNull(),
    after: jsonb('after').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('billing_operator_audit_team_created_idx').on(table.teamId, table.createdAt)],
);

/**
 * Payable usage that has no matching active Polar subscription price.
 * One open row per team, meter, period, and reason. Resolved when a later
 * ingest sends the meter.
 */
export const billingUnbilledAlerts = pgTable(
  'billing_unbilled_alerts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    meterId: text('meter_id').notNull(),
    periodYm: text('period_ym').notNull(),
    reason: text('reason').notNull(),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('billing_unbilled_alerts_open_unq')
      .on(table.teamId, table.meterId, table.periodYm, table.reason)
      .where(sql`${table.resolvedAt} IS NULL`),
  ],
);

/**
 * One Free commercial grant per verified person. Extra workspaces do not mint
 * another Free allowance (pricing strategy §6).
 */
export const billingFreeGrants = pgTable(
  'billing_free_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignedTeamId: uuid('assigned_team_id').references(() => teams.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('billing_free_grants_user_active_unq')
      .on(table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

/** Append-only, idempotent usage settlement. */
export const billingUsageLedger = pgTable(
  'billing_usage_ledger',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    operationId: text('operation_id').notNull(),
    kind: usageLedgerKind('kind').notNull(),
    meterId: billingMeterId('meter_id').notNull(),
    /** Native quantity in the meter's unit (AI charge cents, minutes, …). */
    nativeUnits: numeric('native_units', { precision: 20, scale: 6 }).notNull(),
    providerCostCents: integer('provider_cost_cents'),
    customerChargeCents: integer('customer_charge_cents').notNull().default(0),
    billable: boolean('billable').notNull().default(true),
    nonBillableReason: text('non_billable_reason'),
    operationClass: text('operation_class'),
    provider: text('provider'),
    model: text('model'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    source: text('source'),
    deliverySurface: text('delivery_surface'),
    reservationId: uuid('reservation_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('billing_usage_ledger_team_operation_unq').on(table.teamId, table.operationId),
    index('billing_usage_ledger_team_occurred_idx').on(table.teamId, table.occurredAt),
    index('billing_usage_ledger_team_meter_idx').on(table.teamId, table.meterId, table.occurredAt),
  ],
);

/** Worst-case cost reservation before provider work. */
export const billingUsageReservations = pgTable(
  'billing_usage_reservations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    operationId: text('operation_id').notNull(),
    meterId: billingMeterId('meter_id').notNull(),
    reservedNativeUnits: numeric('reserved_native_units', { precision: 20, scale: 6 }).notNull(),
    reservedChargeCents: integer('reserved_charge_cents').notNull(),
    state: usageReservationState('state').notNull().default('reserved'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('billing_usage_reservations_team_operation_unq').on(
      table.teamId,
      table.operationId,
    ),
    index('billing_usage_reservations_team_state_idx').on(table.teamId, table.state),
  ],
);

/** Fast monthly rollups derived from the ledger (recomputable). */
export const billingUsageCounters = pgTable(
  'billing_usage_counters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    periodYm: text('period_ym').notNull(),
    meterId: billingMeterId('meter_id').notNull(),
    nativeUnits: numeric('native_units', { precision: 20, scale: 6 }).notNull().default('0'),
    customerChargeCents: integer('customer_charge_cents').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('billing_usage_counters_team_period_meter_unq').on(
      table.teamId,
      table.periodYm,
      table.meterId,
    ),
  ],
);

/** Immutable daily active-seat facts for €2/member proration. */
export const billingMemberDayLedger = pgTable(
  'billing_member_day_ledger',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    planId: billingPlanId('plan_id').notNull(),
    role: text('role').notNull(),
    billable: boolean('billable').notNull().default(true),
    chargeCents: integer('charge_cents').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('billing_member_day_ledger_team_user_day_unq').on(
      table.teamId,
      table.userId,
      table.day,
    ),
    index('billing_member_day_ledger_team_day_idx').on(table.teamId, table.day),
  ],
);
