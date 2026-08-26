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
 * Commercial plan + payment lifecycle (Polar subscriptions / prepaid wallet).
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
  /** Prepaid wallet balance in euro cents. */
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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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
