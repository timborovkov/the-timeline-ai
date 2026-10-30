import { randomUUID } from 'node:crypto';

import {
  billingMemberDayLedger,
  billingOperatorAudit,
  billingUsageCounters,
  billingUsageLedger,
  billingUsageReservations,
  documentVersions,
  documents,
  rawEvents,
  teamBillingAccounts,
  teamMembers,
  teams,
  type Db,
  type TeamMemberPriorInterval,
} from '@timeline/db';
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import {
  settleAskAiFromOpenRouterUsd,
  type BillingReserveFailureCode,
} from '#src/billing/admission.js';
import { scopedAiOperationId } from '#src/billing/ai-call.js';
import {
  BACKGROUND_AI_RESERVE_CUSTOMER_CHARGE_CENTS,
  type BillingMeterId,
  type BillingPlanId,
  PLAN_CATALOG,
  customerAiChargeCentsFromOpenRouterUsd,
  recallChargeCents,
} from '#src/billing/catalog.js';
import {
  cumulativeChargeDeltaCents,
  daysInPeriodYm,
  memberDayChargeDelta,
} from '#src/billing/charge.js';
import {
  BILLING_SYSTEM_USER_ID,
  getBillingContext,
  runWithBillingContext,
  type BillingAlsContext,
} from '#src/billing/context.js';
import { BillingAdmissionError } from '#src/billing/errors.js';
import {
  openRouterFinishFromCaughtError,
  openRouterUsdCostFromFinishEvent,
  type OpenRouterFinishEvent,
} from '#src/billing/openrouter-usage.js';
import {
  assertPriceOverride,
  effectiveBillingPlanId,
  resolveTeamCommercialTerms,
  type BillingOperatorAccount,
} from '#src/billing/operator.js';
import { billingPlanIdOnDay, rollIncludedDiscountIfElapsed } from '#src/billing/plan-history.js';
import { applyElapsedScheduledCancellations } from '#src/billing/polar-webhook.js';
import { createPolarBillingProvider } from '#src/billing/polar.js';
import { leaveOverdueRecallBots } from '#src/billing/recall-leave.js';
import {
  expireStaleBillingReservations,
  reservationKeepsProviderResult,
} from '#src/billing/reservations.js';
import { createBillingScope, flushPendingPolarUsageIngest } from '#src/billing/scope.js';
import { shadowBillingFromChargesEnabled } from '#src/billing/shadow.js';
import { childLogger } from '#src/logger.js';

const GIB = 1024 ** 3;
const log = childLogger('billing:runtime');

export function periodYm(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function daysInUtcMonth(date = new Date()): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function billingScope(ctx: Pick<BillingAlsContext, 'db' | 'teamId' | 'userId'>) {
  const provider = createPolarBillingProvider() ?? undefined;
  return createBillingScope({
    db: ctx.db,
    teamId: ctx.teamId,
    userId: ctx.userId,
    ensureMember: () => Promise.resolve('owner'),
    ...(provider ? { provider } : {}),
  });
}

async function currentMeterNativeUnits(
  db: Db,
  teamId: string,
  meterId: BillingMeterId,
  period = periodYm(),
): Promise<number> {
  const [row] = await db
    .select()
    .from(billingUsageCounters)
    .where(
      and(
        eq(billingUsageCounters.teamId, teamId),
        eq(billingUsageCounters.periodYm, period),
        eq(billingUsageCounters.meterId, meterId),
      ),
    )
    .limit(1);
  return row ? Number(row.nativeUnits) : 0;
}

export async function runWorkerBilling<T>(
  db: Db,
  teamId: string,
  operationClass: string,
  fn: () => Promise<T>,
  options?: { skipMeters?: ReadonlySet<BillingMeterId>; operationId?: string },
): Promise<T> {
  return runWithBillingContext(
    {
      db,
      teamId,
      userId: BILLING_SYSTEM_USER_ID,
      operationClass,
      source: 'worker',
      deliverySurface: 'worker',
      ...(options?.skipMeters ? { skipMeters: options.skipMeters } : {}),
      ...(options?.operationId ? { operationId: options.operationId } : {}),
    },
    fn,
  );
}

export async function settleTeamMeter(input: {
  db: Db;
  teamId: string;
  userId?: string;
  operationId: string;
  meterId: BillingMeterId;
  nativeUnits: number;
  customerChargeCents: number;
  operationClass?: string;
  provider?: string;
  source?: string;
  billable?: boolean;
  /**
   * Extra member-days already happened. Skip the allowance reserve, and still
   * refuse paused billing states so the janitor retries after billing recovers.
   */
  persistWhenDenied?: boolean;
  /**
   * Usage already happened on an earlier day, plan, or period. Keep the
   * suspended/terminated block and skip today's allowance, spend cap, and
   * billing-state admission. Pending Recall, email, Ask, worker, and
   * failed-attempt drains already settle their reservation and do not reserve
   * again. Member-days stay on `persistWhenDenied`.
   */
  recoverHistorical?: boolean;
  /** Price a replayed day on the plan in force then, not the live plan. */
  pricingPlanId?: BillingPlanId;
  /** Extra-member price of that historical plan. Null means the plan has no seat price. */
  pricingAdditionalMemberCents?: number | null;
  pricingMemberDiscountPercent?: number | null;
  pricingPeriodYm?: string;
  usageAt?: Date;
}): Promise<{ ok: true; duplicate: boolean } | { ok: false; code: BillingReserveFailureCode }> {
  const userId = input.userId ?? BILLING_SYSTEM_USER_ID;
  const billing = billingScope({ db: input.db, teamId: input.teamId, userId });
  const settleInput = {
    operationId: input.operationId,
    meterId: input.meterId,
    nativeUnits: input.nativeUnits,
    customerChargeCents: input.customerChargeCents,
    ...(input.operationClass ? { operationClass: input.operationClass } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.billable !== undefined ? { billable: input.billable } : {}),
    ...(input.pricingPlanId ? { pricingPlanId: input.pricingPlanId } : {}),
    ...(input.pricingAdditionalMemberCents !== undefined
      ? { pricingAdditionalMemberCents: input.pricingAdditionalMemberCents }
      : {}),
    ...(input.pricingMemberDiscountPercent !== undefined
      ? { pricingMemberDiscountPercent: input.pricingMemberDiscountPercent }
      : {}),
    ...(input.pricingPeriodYm ? { pricingPeriodYm: input.pricingPeriodYm } : {}),
    ...(input.usageAt ? { usageAt: input.usageAt } : {}),
  };
  if (input.recoverHistorical || input.persistWhenDenied) {
    const account = await billing.getAccount();
    if (account.securityState === 'suspended' || account.securityState === 'terminated') {
      return { ok: false, code: 'security_blocked' };
    }
    if (
      !input.recoverHistorical &&
      (account.billingState === 'past_due' ||
        account.billingState === 'payment_retry' ||
        account.billingState === 'canceled' ||
        account.billingState === 'deletion_scheduled' ||
        account.billingState === 'restricted')
    ) {
      return { ok: false, code: 'usage_limit_reached' };
    }
    const settled = await billing.settle(settleInput);
    return { ok: true, duplicate: settled.duplicate };
  }
  const reserved = await billing.reserve({
    operationId: input.operationId,
    meterId: input.meterId,
    reservedNativeUnits: input.nativeUnits,
    reservedChargeCents: input.customerChargeCents,
  });
  if (!reserved.ok) return reserved;
  if (reserved.alreadySettled) return { ok: true, duplicate: true };
  const settled = await billing.settle(settleInput);
  return { ok: true, duplicate: settled.duplicate };
}

export async function meterAcceptedSources(input: {
  db: Db;
  teamId: string;
  userId?: string;
  rawEventIds: string[];
}): Promise<{ ok: true; duplicate: boolean } | { ok: false; code: BillingReserveFailureCode }> {
  if (input.rawEventIds.length === 0) return { ok: true, duplicate: true };
  let previous = await currentMeterNativeUnits(input.db, input.teamId, 'accepted_sources');
  let duplicate = true;
  for (const rawEventId of input.rawEventIds) {
    const next = previous + 1;
    const result = await settleTeamMeter({
      db: input.db,
      teamId: input.teamId,
      ...(input.userId ? { userId: input.userId } : {}),
      operationId: `accepted_source:${rawEventId}`,
      meterId: 'accepted_sources',
      nativeUnits: 1,
      customerChargeCents: cumulativeChargeDeltaCents({
        meterId: 'accepted_sources',
        previousNativeUnits: previous,
        nextNativeUnits: next,
      }),
      operationClass: 'ingest',
      source: 'event_writer',
    });
    if (!result.ok) return result;
    if (!result.duplicate) duplicate = false;
    previous = next;
  }
  return { ok: true, duplicate };
}

/**
 * One accepted-source settlement under a caller-chosen operation id.
 * Meeting capture uses `accepted_source:meeting:<id>` so live utterance
 * embeds and the consolidated transcript share one source item.
 */
export async function meterAcceptedSourceOperation(input: {
  db: Db;
  teamId: string;
  userId?: string;
  operationId: string;
}): Promise<{ ok: true; duplicate: boolean } | { ok: false; code: BillingReserveFailureCode }> {
  const previous = await currentMeterNativeUnits(input.db, input.teamId, 'accepted_sources');
  return settleTeamMeter({
    db: input.db,
    teamId: input.teamId,
    ...(input.userId ? { userId: input.userId } : {}),
    operationId: input.operationId,
    meterId: 'accepted_sources',
    nativeUnits: 1,
    customerChargeCents: cumulativeChargeDeltaCents({
      meterId: 'accepted_sources',
      previousNativeUnits: previous,
      nextNativeUnits: previous + 1,
    }),
    operationClass: 'ingest',
    source: 'event_writer',
  });
}

async function mergeRawEventMetadata(
  db: Db,
  rawEventId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const json = JSON.stringify(patch);
  await db
    .update(rawEvents)
    .set({
      sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${json}::jsonb`,
    })
    .where(eq(rawEvents.id, rawEventId));
}

/**
 * Count one ingested raw event before AI enrichment. A denied meter keeps the
 * row and stamps `billing_enrichment_deferred` for the janitor flush.
 */
export async function admitAcceptedSourceEnrichment(input: {
  db: Db;
  teamId: string;
  userId?: string;
  rawEventId: string;
}): Promise<boolean> {
  const metered = await meterAcceptedSources({
    db: input.db,
    teamId: input.teamId,
    ...(input.userId ? { userId: input.userId } : {}),
    rawEventIds: [input.rawEventId],
  });
  if (!metered.ok) {
    log.warn(
      { teamId: input.teamId, code: metered.code, rawEventId: input.rawEventId },
      'accepted-source billing admission failed; storing raw event without AI enrichment',
    );
    await mergeRawEventMetadata(input.db, input.rawEventId, {
      billing_enrichment_deferred: true,
    });
    return false;
  }
  return true;
}

/**
 * One accepted source for a meeting, shared by live chunk embeds and the
 * consolidated transcript. When `rawEventId` is set, denial defers that row.
 */
export async function admitMeetingSourceEnrichment(input: {
  db: Db;
  teamId: string;
  meetingId: string;
  userId?: string;
  rawEventId?: string;
}): Promise<boolean> {
  const metered = await meterAcceptedSourceOperation({
    db: input.db,
    teamId: input.teamId,
    ...(input.userId ? { userId: input.userId } : {}),
    operationId: `accepted_source:meeting:${input.meetingId}`,
  });
  if (!metered.ok) {
    log.warn(
      { teamId: input.teamId, code: metered.code, meetingId: input.meetingId },
      'meeting accepted-source admission failed; skipping transcript enrichment',
    );
    if (input.rawEventId) {
      await mergeRawEventMetadata(input.db, input.rawEventId, {
        billing_enrichment_deferred: true,
      });
    }
    return false;
  }
  return true;
}

/**
 * Count an audio capture before transcription. Denial stamps
 * `transcription_deferred` so the audio flush can retry the same meter.
 */
export async function admitAudioTranscription(input: {
  db: Db;
  teamId: string;
  userId?: string;
  rawEventId: string;
}): Promise<boolean> {
  const metered = await meterAcceptedSources({
    db: input.db,
    teamId: input.teamId,
    ...(input.userId ? { userId: input.userId } : {}),
    rawEventIds: [input.rawEventId],
  });
  if (!metered.ok) {
    log.warn(
      { teamId: input.teamId, code: metered.code, rawEventId: input.rawEventId },
      'accepted-source billing admission failed; deferring audio transcription',
    );
    await mergeRawEventMetadata(input.db, input.rawEventId, { transcription_deferred: true });
    return false;
  }
  return true;
}

export async function reserveEmailUnits(input: {
  db: Db;
  teamId: string;
  userId?: string;
  operationId: string;
  units: number;
}): Promise<
  { ok: true; alreadySettled?: boolean } | { ok: false; code: BillingReserveFailureCode }
> {
  const units = Math.max(0, Math.trunc(input.units));
  if (units === 0) return { ok: true };
  const previous = await currentMeterNativeUnits(input.db, input.teamId, 'email_units');
  const billing = billingScope({
    db: input.db,
    teamId: input.teamId,
    userId: input.userId ?? BILLING_SYSTEM_USER_ID,
  });
  const reserved = await billing.reserve({
    operationId: input.operationId,
    meterId: 'email_units',
    reservedNativeUnits: units,
    reservedChargeCents: cumulativeChargeDeltaCents({
      meterId: 'email_units',
      previousNativeUnits: previous,
      nextNativeUnits: previous + units,
    }),
  });
  if (!reserved.ok) return reserved;
  return { ok: true, ...(reserved.alreadySettled ? { alreadySettled: true as const } : {}) };
}

export async function settleEmailUnits(input: {
  db: Db;
  teamId: string;
  userId?: string;
  operationId: string;
  units: number;
  operationClass: string;
}): Promise<{ ok: true } | { ok: false; code: BillingReserveFailureCode }> {
  const units = Math.max(0, Math.trunc(input.units));
  if (units === 0) return { ok: true };
  const previous = await currentMeterNativeUnits(input.db, input.teamId, 'email_units');
  const billing = billingScope({
    db: input.db,
    teamId: input.teamId,
    userId: input.userId ?? BILLING_SYSTEM_USER_ID,
  });
  // Stamp before settle. A throw after Postmark already accepted the mail
  // leaves the reservation for the janitor instead of expiring the charge.
  await billing.patchReservationMetadata(input.operationId, {
    pending_settlement: true,
    pending_meter: 'email_units',
    pending_email_units: units,
    pending_operation_class: input.operationClass,
  });
  await billing.settle({
    operationId: input.operationId,
    meterId: 'email_units',
    nativeUnits: units,
    customerChargeCents: cumulativeChargeDeltaCents({
      meterId: 'email_units',
      previousNativeUnits: previous,
      nextNativeUnits: previous + units,
    }),
    operationClass: input.operationClass,
    provider: 'postmark',
    source: 'email',
  });
  return { ok: true };
}

export async function releaseEmailUnits(input: {
  db: Db;
  teamId: string;
  userId?: string;
  operationId: string;
}): Promise<void> {
  const billing = billingScope({
    db: input.db,
    teamId: input.teamId,
    userId: input.userId ?? BILLING_SYSTEM_USER_ID,
  });
  await billing.release(input.operationId);
}

export async function meterEmailUnits(input: {
  db: Db;
  teamId: string;
  userId?: string;
  operationId: string;
  units: number;
  operationClass: string;
}): Promise<{ ok: true } | { ok: false; code: BillingReserveFailureCode }> {
  const units = Math.max(0, Math.trunc(input.units));
  if (units === 0) return { ok: true };
  const reserved = await reserveEmailUnits(input);
  if (!reserved.ok) return reserved;
  return settleEmailUnits(input);
}

function jsonSafeProviderValue(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return undefined;
  }
}

function reservationMetadataRecord(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return metadata ?? {};
}

interface StoredFailedAttempt {
  operationId: string;
  openRouterUsd: number;
  usageAt: string;
  operationClass: string;
  model?: string;
  source?: string;
  deliverySurface?: string;
  billable: boolean;
}

function storedFailedAttempts(metadata: Record<string, unknown>): StoredFailedAttempt[] {
  const raw = metadata.pending_failed_attempts;
  if (!Array.isArray(raw)) return [];
  const attempts: StoredFailedAttempt[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.operation_id !== 'string' || row.operation_id.length === 0) continue;
    const usd = metadataNumber({ openrouter_usd: row.openrouter_usd }, 'openrouter_usd');
    if (usd === undefined || usd <= 0) continue;
    if (typeof row.usage_at !== 'string' || Number.isNaN(new Date(row.usage_at).getTime())) {
      continue;
    }
    const attempt: StoredFailedAttempt = {
      operationId: row.operation_id,
      openRouterUsd: usd,
      usageAt: row.usage_at,
      operationClass: typeof row.operation_class === 'string' ? row.operation_class : 'worker_ai',
      billable: row.billable !== false,
    };
    if (typeof row.model === 'string') attempt.model = row.model;
    if (typeof row.source === 'string') attempt.source = row.source;
    if (typeof row.delivery_surface === 'string') attempt.deliverySurface = row.delivery_surface;
    attempts.push(attempt);
  }
  return attempts;
}

function failedAttemptMetadata(attempt: StoredFailedAttempt): Record<string, unknown> {
  return {
    operation_id: attempt.operationId,
    openrouter_usd: attempt.openRouterUsd,
    usage_at: attempt.usageAt,
    operation_class: attempt.operationClass,
    billable: attempt.billable,
    ...(attempt.model ? { model: attempt.model } : {}),
    ...(attempt.source ? { source: attempt.source } : {}),
    ...(attempt.deliverySurface ? { delivery_surface: attempt.deliverySurface } : {}),
  };
}

/**
 * Write every saved failed attempt to the ledger, then clear the marker.
 * The marker stays when settle throws, so a later retry can commit it
 * without calling the provider again for that attempt.
 */
async function commitStoredFailedAttempts(input: {
  db: Db;
  teamId: string;
  operationId: string;
  billing: ReturnType<typeof billingScope>;
}): Promise<void> {
  const [row] = await input.db
    .select()
    .from(billingUsageReservations)
    .where(
      and(
        eq(billingUsageReservations.teamId, input.teamId),
        eq(billingUsageReservations.operationId, input.operationId),
      ),
    )
    .limit(1);
  if (!row) return;
  const metadata = reservationMetadataRecord(row.metadata);
  const attempts = storedFailedAttempts(metadata);
  if (attempts.length === 0) {
    if (metadata.pending_failed_attempt_settlement === true) {
      await reviveReservationForSettlement(input.db, row);
      await input.billing.patchReservationMetadata(input.operationId, {
        pending_failed_attempts: [],
        pending_failed_attempt_settlement: false,
      });
    }
    return;
  }
  await reviveReservationForSettlement(input.db, row);
  for (const attempt of attempts) {
    const { providerCostCents, customerChargeExactCents } = customerAiChargeCentsFromOpenRouterUsd(
      attempt.openRouterUsd,
    );
    await input.billing.settle({
      operationId: attempt.operationId,
      meterId: 'ai',
      nativeUnits: customerChargeExactCents,
      customerChargeCents: Math.round(customerChargeExactCents),
      providerCostCents,
      operationClass: attempt.operationClass,
      provider: 'openrouter',
      ...(attempt.model ? { model: attempt.model } : {}),
      ...(attempt.source ? { source: attempt.source } : {}),
      ...(attempt.deliverySurface ? { deliverySurface: attempt.deliverySurface } : {}),
      billable: attempt.billable,
      usageAt: new Date(attempt.usageAt),
      metadata: {
        openrouter_usd: attempt.openRouterUsd,
        failed_attempt_for: input.operationId,
      },
    });
  }
  await input.billing.patchReservationMetadata(input.operationId, {
    pending_failed_attempts: [],
    pending_failed_attempt_settlement: false,
  });
}

/**
 * Wrap a provider AI call: reserve worst-case, run, settle exact OpenRouter USD.
 * No-ops when no billing ALS is set (tests, unmetered internal paths).
 */
function aiMeteringOperationId(
  ctx: BillingAlsContext,
  input: {
    operationClass: string;
    operationId?: string;
    stage?: string;
    callMaterial?: readonly string[];
  },
): string {
  if (input.operationId) return input.operationId;
  if (!ctx.operationId) return `ai:${input.operationClass}:${randomUUID()}`;
  const material = input.callMaterial;
  if (!material || material.length === 0) {
    throw new Error(
      `AI metering under job ${ctx.operationId} requires callMaterial so another call in the job cannot replay this result`,
    );
  }
  return scopedAiOperationId({
    parentOperationId: ctx.operationId,
    stage: input.stage ?? input.operationClass,
    material,
  });
}

export async function withAiMetering<T>(
  input: {
    operationClass?: string;
    model?: string;
    reservedChargeCents?: number;
    /**
     * Full cache key for this call. Use only when the id already distinguishes
     * the call from every other call in the job (a transcription chunk, for
     * example). Omit it to derive job id + stage + callMaterial.
     */
    operationId?: string;
    /** Short name of this step inside the job. Defaults to operationClass. */
    stage?: string;
    /**
     * Stable inputs for this call: model, prompt, schema, and payload.
     * Required when the billing context has a job operation id and this call
     * does not pass its own operationId.
     */
    callMaterial?: readonly string[];
  },
  fn: () => Promise<{ value: T; finish?: OpenRouterFinishEvent }>,
): Promise<T> {
  const ctx = getBillingContext();
  if (!ctx || ctx.skipMeters?.has('ai')) {
    return (await fn()).value;
  }
  const operationClass = input.operationClass ?? ctx.operationClass;
  const operationId = aiMeteringOperationId(ctx, {
    operationClass,
    ...(input.operationId ? { operationId: input.operationId } : {}),
    ...(input.stage ? { stage: input.stage } : {}),
    ...(input.callMaterial ? { callMaterial: input.callMaterial } : {}),
  });
  const reservedChargeCents =
    input.reservedChargeCents ?? BACKGROUND_AI_RESERVE_CUSTOMER_CHARGE_CENTS;
  const billing = billingScope(ctx);
  await commitStoredFailedAttempts({
    db: ctx.db,
    teamId: ctx.teamId,
    operationId,
    billing,
  });
  const reserved = await billing.reserve({
    operationId,
    meterId: 'ai',
    reservedNativeUnits: reservedChargeCents,
    reservedChargeCents,
    metadata: {
      operation_class: operationClass,
      source: ctx.source ?? 'worker',
    },
  });
  if (!reserved.ok) throw new BillingAdmissionError(reserved.code);
  const existingMeta = reservationMetadataRecord(reserved.reservation.metadata);
  const skipProvider =
    reserved.alreadySettled === true ||
    (reserved.reused && existingMeta.provider_completed === true);

  const settleUsd = async (settleOperationId: string, usd: number) => {
    const { providerCostCents, customerChargeExactCents } =
      customerAiChargeCentsFromOpenRouterUsd(usd);
    await billing.settle({
      operationId: settleOperationId,
      meterId: 'ai',
      nativeUnits: customerChargeExactCents,
      customerChargeCents: Math.round(customerChargeExactCents),
      providerCostCents,
      operationClass,
      provider: 'openrouter',
      ...(input.model ? { model: input.model } : {}),
      ...(ctx.source ? { source: ctx.source } : {}),
      ...(ctx.deliverySurface ? { deliverySurface: ctx.deliverySurface } : {}),
      billable: ctx.billable !== false,
      metadata: {
        openrouter_usd: usd,
      },
    });
  };

  if (skipProvider) {
    if (!reserved.alreadySettled) {
      const usd = typeof existingMeta.openrouter_usd === 'number' ? existingMeta.openrouter_usd : 0;
      await settleUsd(operationId, usd);
    }
    return existingMeta.provider_value as T;
  }

  let value: T;
  let finish: OpenRouterFinishEvent | undefined;
  try {
    ({ value, finish } = await fn());
  } catch (err) {
    const failedFinish = openRouterFinishFromCaughtError(err);
    const failedUsd = failedFinish ? openRouterUsdCostFromFinishEvent(failedFinish) : 0;
    if (failedUsd > 0) {
      const attemptId = await nextFailedAttemptOperationId(ctx.db, ctx.teamId, operationId);
      const [current] = await ctx.db
        .select({ metadata: billingUsageReservations.metadata })
        .from(billingUsageReservations)
        .where(
          and(
            eq(billingUsageReservations.teamId, ctx.teamId),
            eq(billingUsageReservations.operationId, operationId),
          ),
        )
        .limit(1);
      const existing = storedFailedAttempts(reservationMetadataRecord(current?.metadata));
      const attempt: StoredFailedAttempt = {
        operationId: attemptId,
        openRouterUsd: failedUsd,
        usageAt: new Date().toISOString(),
        operationClass,
        billable: ctx.billable !== false,
      };
      if (input.model) attempt.model = input.model;
      if (ctx.source) attempt.source = ctx.source;
      if (ctx.deliverySurface) attempt.deliverySurface = ctx.deliverySurface;
      const attempts = existing.some((row) => row.operationId === attemptId)
        ? existing
        : [...existing, attempt];
      await billing.patchReservationMetadata(operationId, {
        pending_failed_attempts: attempts.map(failedAttemptMetadata),
        pending_failed_attempt_settlement: true,
      });
      try {
        await commitStoredFailedAttempts({
          db: ctx.db,
          teamId: ctx.teamId,
          operationId,
          billing,
        });
      } catch {
        throw err;
      }
    }
    await billing.release(operationId);
    throw err;
  }
  const usd = finish ? openRouterUsdCostFromFinishEvent(finish) : 0;
  const providerValue = jsonSafeProviderValue(value);
  await billing.patchReservationMetadata(operationId, {
    provider_completed: true,
    worker_settlement_pending: true,
    openrouter_usd: usd,
    operation_class: operationClass,
    ...(input.model ? { model: input.model } : {}),
    ...(ctx.source ? { source: ctx.source } : {}),
    ...(ctx.deliverySurface ? { delivery_surface: ctx.deliverySurface } : {}),
    ...(ctx.billable === false ? { billable: false } : {}),
    ...(providerValue === undefined ? {} : { provider_value: providerValue }),
  });
  // Keep the reservation if settle fails after OpenRouter work succeeded.
  // Releasing here would let a worker retry mint a new `ai:` operation id
  // and pay the provider a second time while the first call stays uncharged.
  await settleUsd(operationId, usd);
  return value;
}

async function nextFailedAttemptOperationId(
  db: Db,
  teamId: string,
  operationId: string,
): Promise<string> {
  const rows = await db
    .select({ operationId: billingUsageLedger.operationId })
    .from(billingUsageLedger)
    .where(eq(billingUsageLedger.teamId, teamId));
  const prefix = `${operationId}:failed:`;
  const count = rows.filter((row) => row.operationId.startsWith(prefix)).length;
  return `${prefix}${count + 1}`;
}

export async function snapshotTeamStorageGbMonth(input: {
  db: Db;
  teamId: string;
  day?: string;
}): Promise<{ gb: number; settled: boolean }> {
  const days = input.day
    ? [input.day]
    : await absentOperationDays(
        input.db,
        input.teamId,
        storageSnapshotBackfillRange(),
        (day) => `storage_gb:${input.teamId}:${day}`,
      );
  const [account] = await input.db
    .select()
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, input.teamId))
    .limit(1);
  const livePlan = account ? effectiveBillingPlanId(account) : 'free';
  let lastGb = 0;
  let settled = false;
  for (const day of days) {
    const gb = await storageGbOnUtcDay(input.db, input.teamId, day);
    lastGb = gb;
    if (gb <= 0) continue;
    const gbMonthSlice = gb / daysInUtcMonth(new Date(`${day}T00:00:00.000Z`));
    const replayPeriodYm = day.slice(0, 7);
    const usageAt = new Date(`${day}T12:00:00.000Z`);
    const previous = await currentMeterNativeUnits(
      input.db,
      input.teamId,
      'storage_gb_month',
      replayPeriodYm,
    );
    const pricingPlanId = await billingPlanIdOnDay({
      db: input.db,
      teamId: input.teamId,
      day,
      account: account ?? { planId: 'free' },
    });
    const differentPlan = pricingPlanId !== livePlan;
    const recoverHistorical = storageDayRecoversWithoutLiveAdmission({
      day,
      pricingPlanId,
      livePlanId: livePlan,
      pricingPeriodYm: replayPeriodYm,
    });
    const result = await settleTeamMeter({
      db: input.db,
      teamId: input.teamId,
      operationId: `storage_gb:${input.teamId}:${day}`,
      meterId: 'storage_gb_month',
      nativeUnits: gbMonthSlice,
      customerChargeCents: cumulativeChargeDeltaCents({
        meterId: 'storage_gb_month',
        previousNativeUnits: previous,
        nextNativeUnits: previous + gbMonthSlice,
      }),
      operationClass: 'storage_snapshot',
      source: 'janitor',
      usageAt,
      pricingPeriodYm: replayPeriodYm,
      ...(recoverHistorical ? { recoverHistorical: true } : {}),
      ...(differentPlan ? { pricingPlanId } : {}),
    });
    settled = result.ok || settled;
  }
  return { gb: lastGb, settled };
}

async function storageGbOnUtcDay(db: Db, teamId: string, day: string): Promise<number> {
  const startOfDay = new Date(`${day}T00:00:00.000Z`);
  const endOfDay = new Date(`${day}T23:59:59.999Z`);
  const [row] = await db
    .select({
      bytes: sql<number>`COALESCE(SUM(${documentVersions.byteSize}), 0)`,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(documentVersions.teamId, teamId),
        sql`${documentVersions.byteSize} IS NOT NULL`,
        sql`${documentVersions.createdAt} <= ${endOfDay}`,
        or(isNull(documents.deletedAt), sql`${documents.deletedAt} >= ${startOfDay}`),
        sql`NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(${documents.metadata} -> 'absence_intervals') = 'array'
              THEN ${documents.metadata} -> 'absence_intervals'
              ELSE '[]'::jsonb
            END
          ) AS absence(interval)
          WHERE (absence.interval ->> 'startedAt')::timestamptz < ${startOfDay}
            AND (absence.interval ->> 'endedAt')::timestamptz >= ${endOfDay}
        )`,
      ),
    );
  return (row?.bytes ?? 0) / GIB;
}

/** Days in the trailing 31-day window, including the previous calendar month. */
function lookbackDays(): string[] {
  const today = utcDay();
  return utcDaysInclusive(addUtcDays(today, -31), today);
}

function storageSnapshotBackfillRange(): string[] {
  return lookbackDays();
}

/**
 * A missed day, another plan, or another month is usage that already happened.
 * Today's snapshot on the live plan still reserves against current admission.
 */
function storageDayRecoversWithoutLiveAdmission(input: {
  day: string;
  pricingPlanId: BillingPlanId;
  livePlanId: BillingPlanId;
  pricingPeriodYm: string;
}): boolean {
  if (input.day < utcDay()) return true;
  if (input.pricingPlanId !== input.livePlanId) return true;
  return input.pricingPeriodYm !== utcDay().slice(0, 7);
}

function addUtcDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDay(date);
}

function utcDaysInclusive(from: string, to: string): string[] {
  if (from > to) return [];
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = addUtcDays(cursor, 1);
  }
  return days;
}

function memberDayBackfillRange(): string[] {
  return lookbackDays();
}

async function absentOperationDays(
  db: Db,
  teamId: string,
  days: string[],
  operationIdForDay: (day: string) => string,
): Promise<string[]> {
  if (days.length === 0) return [];
  const ids = days.map(operationIdForDay);
  const rows = await db
    .select({ operationId: billingUsageLedger.operationId })
    .from(billingUsageLedger)
    .where(
      and(eq(billingUsageLedger.teamId, teamId), inArray(billingUsageLedger.operationId, ids)),
    );
  const present = new Set(rows.map((row) => row.operationId));
  return days.filter((day) => !present.has(operationIdForDay(day)));
}

function intervalOverlapsUtcDay(startedAt: Date, endedAt: Date | null, day: string): boolean {
  const startOfDay = new Date(`${day}T00:00:00.000Z`);
  const endOfDay = new Date(`${day}T23:59:59.999Z`);
  if (startedAt > endOfDay) return false;
  return endedAt === null || endedAt >= startOfDay;
}

function membersActiveOnDay<
  T extends {
    createdAt: Date;
    removedAt: Date | null;
    priorIntervals?: TeamMemberPriorInterval[] | null;
  },
>(members: T[], day: string): T[] {
  return members.filter((member) => {
    if (intervalOverlapsUtcDay(member.createdAt, member.removedAt, day)) return true;
    return (member.priorIntervals ?? []).some((interval) =>
      intervalOverlapsUtcDay(new Date(interval.startedAt), new Date(interval.endedAt), day),
    );
  });
}

function isBillingPlanId(value: string): value is BillingPlanId {
  return value in PLAN_CATALOG;
}

async function planEntitlementForMemberDay(input: {
  db: Db;
  teamId: string;
  day: string;
  account: BillingOperatorAccount;
}): Promise<{
  planId: BillingPlanId;
  included: number | null;
  additionalMemberCents: number | null;
  meteredDiscountPercent: number | null;
}> {
  const [existing] = await input.db
    .select({
      planId: billingMemberDayLedger.planId,
      createdAt: billingMemberDayLedger.createdAt,
      pricingTerms: billingMemberDayLedger.pricingTerms,
    })
    .from(billingMemberDayLedger)
    .where(
      and(
        eq(billingMemberDayLedger.teamId, input.teamId),
        eq(billingMemberDayLedger.day, input.day),
      ),
    )
    .orderBy(asc(billingMemberDayLedger.createdAt))
    .limit(1);
  const stampedPlanId =
    existing?.planId && isBillingPlanId(existing.planId) ? existing.planId : null;
  if (stampedPlanId && existing?.pricingTerms) {
    return {
      planId: stampedPlanId,
      included: existing.pricingTerms.includedActiveMembers,
      additionalMemberCents: existing.pricingTerms.additionalMemberCents,
      meteredDiscountPercent: existing.pricingTerms.meteredDiscountPercent,
    };
  }
  // A missed day has no stamp yet. One helper applies plan history, comp
  // expiry, and a contractual Enterprise plan before the first write.
  const planId =
    stampedPlanId ??
    (await billingPlanIdOnDay({
      db: input.db,
      teamId: input.teamId,
      day: input.day,
      account: input.account,
    }));
  // The first daily fact fixes the pricing instant. For missed days, use
  // end-of-day terms. Audit before/after snapshots also recover cleared or
  // replaced overrides; expiry is evaluated at usage time, never at replay time.
  const at = new Date(
    Math.min(
      Date.now(),
      existing?.createdAt.getTime() ?? Infinity,
      new Date(`${input.day}T23:59:59.999Z`).getTime(),
    ),
  );
  const [previous] = await input.db
    .select()
    .from(billingOperatorAudit)
    .where(
      and(eq(billingOperatorAudit.teamId, input.teamId), lte(billingOperatorAudit.createdAt, at)),
    )
    .orderBy(desc(billingOperatorAudit.createdAt))
    .limit(1);
  const [next] = previous
    ? []
    : await input.db
        .select()
        .from(billingOperatorAudit)
        .where(
          and(
            eq(billingOperatorAudit.teamId, input.teamId),
            gt(billingOperatorAudit.createdAt, at),
          ),
        )
        .orderBy(asc(billingOperatorAudit.createdAt))
        .limit(1);
  const snapshot = previous?.after ?? next?.before;
  // Fresh current-day facts use the locked live account (including Enterprise
  // terms activated by a webhook). Legacy/backfilled facts use audit history.
  const source =
    !existing && input.day === utcDay()
      ? input.account
      : snapshot?.planId === planId
        ? snapshot
        : input.account;
  const override =
    source.planId === planId && source.priceOverride
      ? assertPriceOverride(source.priceOverride)
      : null;
  const rawExpiry = source.priceOverrideExpiresAt;
  const expiresAt =
    typeof rawExpiry === 'string' || rawExpiry instanceof Date ? new Date(rawExpiry) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime()))
    throw new Error('Invalid historical price override expiry');
  const terms = resolveTeamCommercialTerms(
    {
      planId,
      billingState: 'free',
      spendCapCents: 0,
      priceOverride: override,
      priceOverrideExpiresAt: expiresAt,
    },
    at,
  );
  return {
    planId,
    included: terms.includedActiveMembers,
    additionalMemberCents: terms.additionalMemberCents,
    meteredDiscountPercent: terms.meteredDiscountPercent,
  };
}

async function accrueTeamMemberDaysForDay(input: {
  db: Db;
  teamId: string;
  day: string;
  planId: BillingPlanId;
  meteredDiscountPercent: number | null;
  included: number | null;
  additionalMemberCents: number | null;
}): Promise<{ extraMembers: number; chargeCents: number }> {
  const { day, planId, included } = input;
  const additionalMemberCents = input.additionalMemberCents;
  if (
    planId === 'free' ||
    included === null ||
    additionalMemberCents === null ||
    additionalMemberCents <= 0
  ) {
    return { extraMembers: 0, chargeCents: 0 };
  }
  const billableRows = await input.db
    .select({ userId: billingMemberDayLedger.userId })
    .from(billingMemberDayLedger)
    .where(
      and(
        eq(billingMemberDayLedger.teamId, input.teamId),
        eq(billingMemberDayLedger.day, day),
        eq(billingMemberDayLedger.billable, true),
      ),
    )
    .orderBy(asc(billingMemberDayLedger.userId));
  const extraRows = billableRows.slice(included);
  if (extraRows.length === 0) {
    return { extraMembers: 0, chargeCents: 0 };
  }
  const period = day.slice(0, 7);
  let previousNative = await currentMeterNativeUnits(input.db, input.teamId, 'member_days', period);
  const daysInMonth = daysInPeriodYm(period);
  let chargeCents = 0;
  for (const extra of extraRows) {
    const nextChargeCents = memberDayChargeDelta({
      previousNativeUnits: previousNative,
      nextNativeUnits: previousNative + 1,
      centsPerMemberMonth: additionalMemberCents,
      daysInMonth,
    });
    const result = await settleTeamMeter({
      db: input.db,
      teamId: input.teamId,
      operationId: `member_days:${input.teamId}:${day}:${extra.userId}`,
      meterId: 'member_days',
      nativeUnits: 1,
      customerChargeCents: nextChargeCents,
      operationClass: 'member_day',
      source: 'janitor',
      billable: true,
      persistWhenDenied: true,
      usageAt: new Date(`${day}T12:00:00.000Z`),
      pricingPeriodYm: period,
      pricingPlanId: planId,
      pricingAdditionalMemberCents: additionalMemberCents,
      pricingMemberDiscountPercent: input.meteredDiscountPercent,
    });
    if (result.ok && !result.duplicate) {
      previousNative += 1;
      chargeCents += nextChargeCents;
    }
  }
  return { extraMembers: extraRows.length, chargeCents };
}

export async function accrueTeamMemberDays(input: {
  db: Db;
  teamId: string;
  day?: string;
}): Promise<{ extraMembers: number; chargeCents: number }> {
  const days = input.day ? [input.day] : memberDayBackfillRange();
  if (days.length === 0) {
    return { extraMembers: 0, chargeCents: 0 };
  }

  const roster = await input.db
    .select({
      userId: teamMembers.userId,
      role: teamMembers.role,
      createdAt: teamMembers.createdAt,
      removedAt: teamMembers.removedAt,
      priorIntervals: teamMembers.priorIntervals,
    })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, input.teamId));

  let extraMembers = 0;
  let chargeCents = 0;
  for (const day of days) {
    const members = input.day
      ? roster.filter((member) => member.removedAt === null)
      : membersActiveOnDay(roster, day);
    // Serialize the first daily facts with operator changes. Every member on
    // the day, including later arrivals and zero-charge seats, shares this stamp.
    const entitlement = await input.db.transaction(async (tx) => {
      const db = tx as unknown as Db;
      const [account] = await db
        .select()
        .from(teamBillingAccounts)
        .where(eq(teamBillingAccounts.teamId, input.teamId))
        .limit(1)
        .for('update');
      const terms = await planEntitlementForMemberDay({
        db,
        teamId: input.teamId,
        day,
        account: account ?? { planId: 'free', billingState: 'free', spendCapCents: 0 },
      });
      const pricingTerms = {
        includedActiveMembers: terms.included,
        additionalMemberCents: terms.additionalMemberCents,
        meteredDiscountPercent: terms.meteredDiscountPercent,
      };
      for (const member of members) {
        await db
          .insert(billingMemberDayLedger)
          .values({
            teamId: input.teamId,
            userId: member.userId,
            day,
            planId: terms.planId,
            role: member.role,
            billable: terms.planId !== 'free',
            chargeCents: 0,
            pricingTerms,
          })
          .onConflictDoNothing();
      }
      // Nullable migration rows are recovered once from the operator history.
      await db
        .update(billingMemberDayLedger)
        .set({ pricingTerms })
        .where(
          and(
            eq(billingMemberDayLedger.teamId, input.teamId),
            eq(billingMemberDayLedger.day, day),
            isNull(billingMemberDayLedger.pricingTerms),
          ),
        );
      return terms;
    });
    const result = await accrueTeamMemberDaysForDay({
      db: input.db,
      teamId: input.teamId,
      day,
      planId: entitlement.planId,
      included: entitlement.included,
      additionalMemberCents: entitlement.additionalMemberCents,
      meteredDiscountPercent: entitlement.meteredDiscountPercent,
    });
    extraMembers = result.extraMembers;
    chargeCents += result.chargeCents;
  }
  return { extraMembers, chargeCents };
}

/**
 * Finish Ask settlements that recorded provider usage and then failed to
 * write the ledger. One row's failure does not stop the rest of the tick.
 */
async function reviveReservationForSettlement(
  db: Db,
  row: typeof billingUsageReservations.$inferSelect,
): Promise<void> {
  if (row.state === 'reserved') return;
  await db
    .update(billingUsageReservations)
    .set({ state: 'reserved', updatedAt: new Date() })
    .where(
      and(
        eq(billingUsageReservations.id, row.id),
        inArray(billingUsageReservations.state, ['expired', 'released']),
      ),
    );
}

async function settleCompletedWorkerAiReservation(
  db: Db,
  row: typeof billingUsageReservations.$inferSelect,
  metadata: Record<string, unknown>,
): Promise<void> {
  await reviveReservationForSettlement(db, row);
  const usd =
    metadataNumber(metadata, 'openrouter_usd') ??
    metadataNumber(metadata, 'pending_openrouter_usd') ??
    0;
  const { providerCostCents, customerChargeExactCents } =
    customerAiChargeCentsFromOpenRouterUsd(usd);
  const operationClass =
    typeof metadata.operation_class === 'string' ? metadata.operation_class : 'worker_ai';
  const model = typeof metadata.model === 'string' ? metadata.model : undefined;
  const source = typeof metadata.source === 'string' ? metadata.source : 'worker';
  const deliverySurface =
    typeof metadata.delivery_surface === 'string' ? metadata.delivery_surface : undefined;
  const billing = createBillingScope({
    db,
    teamId: row.teamId,
    userId: BILLING_SYSTEM_USER_ID,
    ensureMember: () => Promise.resolve('owner'),
  });
  await billing.settle({
    operationId: row.operationId,
    meterId: 'ai',
    nativeUnits: customerChargeExactCents,
    customerChargeCents: Math.round(customerChargeExactCents),
    providerCostCents,
    operationClass,
    provider: 'openrouter',
    ...(model ? { model } : {}),
    source,
    ...(deliverySurface ? { deliverySurface } : {}),
    billable: metadata.billable !== false,
    metadata: { openrouter_usd: usd },
  });
}

/**
 * Finish settlements that recorded provider usage and then failed to write
 * the ledger. Ask rows use `pending_settlement`. Worker AI rows use
 * `worker_settlement_pending` / `provider_completed`. Failed provider attempts
 * use `pending_failed_attempt_settlement` and are drained before the TTL
 * sweep, including a row that already expired. One row's failure does not
 * stop the rest of the tick.
 */
export async function settlePendingBillingReservations(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(billingUsageReservations)
    .where(
      or(
        and(
          eq(billingUsageReservations.state, 'reserved'),
          sql`coalesce(${billingUsageReservations.metadata}->>'pending_settlement', '') = 'true'`,
        ),
        and(
          inArray(billingUsageReservations.state, ['reserved', 'expired']),
          or(
            sql`coalesce(${billingUsageReservations.metadata}->>'worker_settlement_pending', '') = 'true'`,
            sql`coalesce(${billingUsageReservations.metadata}->>'provider_completed', '') = 'true'`,
            sql`coalesce(${billingUsageReservations.metadata}->>'pending_failed_attempt_settlement', '') = 'true'`,
          ),
        ),
      ),
    );
  let settled = 0;
  for (const row of rows) {
    const metadata = reservationMetadataRecord(row.metadata);
    const billing = createBillingScope({
      db,
      teamId: row.teamId,
      userId: BILLING_SYSTEM_USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    if (metadata.pending_failed_attempt_settlement === true) {
      try {
        await commitStoredFailedAttempts({
          db,
          teamId: row.teamId,
          operationId: row.operationId,
          billing,
        });
      } catch (err) {
        log.warn(
          { err, teamId: row.teamId, operationId: row.operationId },
          'pending failed-attempt settlement failed',
        );
        continue;
      }
      if (
        metadata.pending_meter !== 'email_units' &&
        metadata.pending_settlement !== true &&
        !reservationKeepsProviderResult(metadata)
      ) {
        await billing.release(row.operationId);
        settled += 1;
        continue;
      }
    }
    if (metadata.pending_meter === 'recall_minutes') {
      const minutes = Math.max(
        0,
        Math.trunc(metadataNumber(metadata, 'pending_recall_minutes') ?? 0),
      );
      const meetingId =
        typeof metadata.meeting_id === 'string' ? metadata.meeting_id : row.operationId;
      const source =
        typeof metadata.pending_source === 'string' ? metadata.pending_source : 'meeting_recall';
      try {
        await billing.settle({
          operationId: row.operationId,
          meterId: 'recall_minutes',
          nativeUnits: minutes,
          customerChargeCents: recallChargeCents(minutes),
          operationClass: 'meeting_bot',
          provider: 'recall',
          source,
          metadata: { meeting_id: meetingId },
        });
        settled += 1;
      } catch (err) {
        log.warn(
          { err, teamId: row.teamId, operationId: row.operationId },
          'pending recall settlement failed',
        );
      }
      continue;
    }
    if (metadata.pending_meter === 'email_units') {
      const units = metadataNumber(metadata, 'pending_email_units') ?? 0;
      const operationClass =
        typeof metadata.pending_operation_class === 'string'
          ? metadata.pending_operation_class
          : 'email_outbound';
      try {
        await settleEmailUnits({
          db,
          teamId: row.teamId,
          operationId: row.operationId,
          units,
          operationClass,
        });
        settled += 1;
      } catch (err) {
        log.warn(
          { err, teamId: row.teamId, operationId: row.operationId },
          'pending email settlement failed',
        );
      }
      continue;
    }
    if (reservationKeepsProviderResult(metadata) && metadata.pending_settlement !== true) {
      try {
        await settleCompletedWorkerAiReservation(db, row, metadata);
        settled += 1;
      } catch (err) {
        log.warn(
          { err, teamId: row.teamId, operationId: row.operationId },
          'pending worker settlement failed',
        );
      }
      continue;
    }
    const openRouterUsd = metadataNumber(metadata, 'pending_openrouter_usd') ?? 0;
    const deliverySurface =
      typeof metadata.pending_delivery_surface === 'string'
        ? metadata.pending_delivery_surface
        : 'ask';
    const model = typeof metadata.pending_model === 'string' ? metadata.pending_model : undefined;
    const minCustomerChargeCents = metadataNumber(metadata, 'pending_min_customer_charge_cents');
    try {
      await settleAskAiFromOpenRouterUsd(billing, {
        operationId: row.operationId,
        openRouterUsd,
        deliverySurface,
        ...(model ? { model } : {}),
        ...(minCustomerChargeCents !== undefined ? { minCustomerChargeCents } : {}),
      });
      settled += 1;
    } catch (err) {
      log.warn(
        { err, teamId: row.teamId, operationId: row.operationId },
        'pending billing settlement failed',
      );
    }
  }
  return settled;
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number | undefined {
  const value = metadata[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export async function runBillingMaintenanceTick(db: Db): Promise<{ teams: number }> {
  await leaveOverdueRecallBots(db);
  await settlePendingBillingReservations(db);
  await expireStaleBillingReservations({ db });
  await reconcileShadowBillingFromChargesEnabled(db);
  const polarProvider = createPolarBillingProvider();
  if (polarProvider) {
    await flushPendingPolarUsageIngest({ db, provider: polarProvider });
  }
  await applyElapsedScheduledCancellations(db);
  const rows = await db.select({ id: teams.id }).from(teams);
  for (const team of rows) {
    try {
      await resetIncludedDiscountIfPeriodElapsed({ db, teamId: team.id });
      await snapshotTeamStorageGbMonth({ db, teamId: team.id });
      await accrueTeamMemberDays({ db, teamId: team.id });
    } catch {
      // Keep the janitor tick alive if one workspace's ledger fails.
    }
  }
  return { teams: rows.length };
}

async function reconcileShadowBillingFromChargesEnabled(db: Db): Promise<void> {
  const shadowBilling = shadowBillingFromChargesEnabled();
  await db
    .update(teamBillingAccounts)
    .set({ shadowBilling, updatedAt: new Date() })
    .where(eq(teamBillingAccounts.shadowBilling, !shadowBilling));
}

export async function resetIncludedDiscountIfPeriodElapsed(input: {
  db: Db;
  teamId: string;
  now?: Date;
}): Promise<boolean> {
  return input.db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, input.teamId))
      .limit(1)
      .for('update');
    if (!account) return false;
    const rolled = await rollIncludedDiscountIfElapsed(tx, account, input.now ?? new Date(), {
      openMissingBounds: true,
    });
    return rolled.rolled;
  });
}
