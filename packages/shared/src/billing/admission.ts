import { randomUUID } from 'node:crypto';

import type { FreeAllowanceRemaining } from '#src/billing/status.js';

import {
  ASK_AI_RESERVE_CUSTOMER_CHARGE_CENTS,
  ASK_AI_RESERVATION_TTL_MS,
  MEETING_MAX_DURATION_MINUTES_BY_PLAN,
  RECALL_RESERVATION_TTL_MS,
  customerAiChargeCentsFromOpenRouterUsd,
  recallChargeCents,
  type BillingPlanId,
} from '#src/billing/catalog.js';

export type BillingReserveFailureCode =
  | 'security_blocked'
  | 'free_allowance_reached'
  | 'usage_limit_reached'
  | 'spend_cap_reached';

export type AskBillingError = BillingReserveFailureCode;

/** Minimal billing surface used by Ask / Recall admission helpers. */
export interface BillingAdmissionScope {
  getAccount(): Promise<{ planId: BillingPlanId }>;
  getDashboard(): Promise<{ freeRemaining: FreeAllowanceRemaining }>;
  reserve(input: {
    operationId: string;
    meterId: 'ai' | 'recall_minutes';
    reservedNativeUnits: number;
    reservedChargeCents: number;
    ttlMs?: number;
    metadata?: Record<string, unknown>;
  }): Promise<
    | { ok: true; reservation: unknown; reused: boolean; alreadySettled?: boolean }
    | { ok: false; code: BillingReserveFailureCode }
  >;
  settle(input: {
    operationId: string;
    meterId: 'ai' | 'recall_minutes';
    nativeUnits: number;
    customerChargeCents: number;
    providerCostCents?: number;
    operationClass?: string;
    provider?: string;
    model?: string;
    source?: string;
    deliverySurface?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ ok: true; duplicate: boolean; ledger?: unknown }>;
  release(operationId: string): Promise<{
    ok: true;
    missing: boolean;
    alreadyFinal?: boolean;
  }>;
}

export function askOperationId(deliverySurface: string, turnId: string = randomUUID()): string {
  return `ask:${deliverySurface}:${turnId}`;
}

export function recallOperationId(meetingId: string): string {
  return `recall:${meetingId}`;
}

export function mapAskBillingError(code: BillingReserveFailureCode): AskBillingError {
  return code;
}

export function askBillingUserMessage(error: AskBillingError): string {
  switch (error) {
    case 'security_blocked':
      return 'This workspace cannot run paid AI right now. Contact support if that looks wrong.';
    case 'free_allowance_reached':
      return 'Free AI allowance is used up for this period. Add a payment method in Billing (or ask an admin) to continue.';
    case 'usage_limit_reached':
      return 'Usage balance is too low for this Ask. Top up or raise the spend cap in Billing.';
    case 'spend_cap_reached':
      return 'This workspace hit its spend cap. Raise the cap in Billing to continue Ask.';
  }
}

export function recallBillingUserMessage(code: BillingReserveFailureCode): string {
  switch (code) {
    case 'security_blocked':
      return 'This workspace cannot start meeting notetakers right now.';
    case 'free_allowance_reached':
      return 'Free meeting minutes are used up for this period. Add a payment method in Billing (or ask an admin) to continue.';
    case 'usage_limit_reached':
      return 'Usage balance is too low to start a meeting notetaker. Top up or raise the spend cap in Billing.';
    case 'spend_cap_reached':
      return 'This workspace hit its spend cap. Raise the cap in Billing before inviting a notetaker.';
  }
}

export async function reserveAskAi(
  billing: BillingAdmissionScope,
  input: {
    operationId: string;
    deliverySurface: string;
    reservedChargeCents?: number;
  },
): Promise<{ ok: true } | { ok: false; code: BillingReserveFailureCode }> {
  const reservedChargeCents = input.reservedChargeCents ?? ASK_AI_RESERVE_CUSTOMER_CHARGE_CENTS;
  const reserved = await billing.reserve({
    operationId: input.operationId,
    meterId: 'ai',
    reservedNativeUnits: reservedChargeCents,
    reservedChargeCents,
    ttlMs: ASK_AI_RESERVATION_TTL_MS,
    metadata: {
      operation_class: 'agent_ask',
      delivery_surface: input.deliverySurface,
    },
  });
  if (!reserved.ok) return reserved;
  return { ok: true };
}

export async function settleAskAiFromOpenRouterUsd(
  billing: BillingAdmissionScope,
  input: {
    operationId: string;
    openRouterUsd: number;
    deliverySurface: string;
    model?: string;
    minCustomerChargeCents?: number;
  },
): Promise<void> {
  const { providerCostCents, customerChargeExactCents } = customerAiChargeCentsFromOpenRouterUsd(
    Math.max(0, input.openRouterUsd),
  );
  const nativeUnits = Math.max(customerChargeExactCents, input.minCustomerChargeCents ?? 0);
  await billing.settle({
    operationId: input.operationId,
    meterId: 'ai',
    nativeUnits,
    customerChargeCents: Math.round(nativeUnits),
    providerCostCents,
    operationClass: 'agent_ask',
    provider: 'openrouter',
    ...(input.model ? { model: input.model } : {}),
    source: 'ask',
    deliverySurface: input.deliverySurface,
    metadata: {
      openrouter_usd: input.openRouterUsd,
      ...(input.minCustomerChargeCents
        ? { conservative_min_customer_charge_cents: input.minCustomerChargeCents }
        : {}),
    },
  });
}

export async function releaseBillingReservation(
  billing: BillingAdmissionScope,
  operationId: string,
): Promise<void> {
  await billing.release(operationId);
}

/** Leave a Recall bot that joined, then release the reservation. */
export async function abortRecallJoinAfterProviderAccept(input: {
  billing: BillingAdmissionScope;
  operationId: string;
  leaveMeeting?: (botId: string) => Promise<void>;
  botId?: string;
}): Promise<void> {
  if (input.botId && input.leaveMeeting) {
    await input.leaveMeeting(input.botId).catch(() => undefined);
  }
  await releaseBillingReservation(input.billing, input.operationId).catch(() => undefined);
}

export async function releaseRecallMeetingMinutes(
  billing: BillingAdmissionScope,
  input: { meetingId: string },
): Promise<void> {
  await releaseBillingReservation(billing, recallOperationId(input.meetingId));
}

function parseIsoDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Joining + in-call minutes, capped by the reserved duration. */
export function recallBillableMinutes(input: {
  joinStartedAt?: Date | string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  chunkEndMs?: number | null;
  reservedMinutes?: number | null;
}): number {
  const joinStartedAt =
    input.joinStartedAt instanceof Date ? input.joinStartedAt : parseIsoDate(input.joinStartedAt);
  const start = joinStartedAt ?? input.startedAt ?? null;
  const end = input.endedAt ?? null;
  let minutes = 0;
  if (start && end && end.getTime() > start.getTime()) {
    minutes = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 60_000));
  } else if (input.chunkEndMs && input.chunkEndMs > 0) {
    minutes = Math.max(1, Math.ceil(input.chunkEndMs / 60_000));
  }
  if (typeof input.reservedMinutes === 'number' && input.reservedMinutes > 0) {
    minutes = Math.min(minutes, Math.trunc(input.reservedMinutes));
  }
  return minutes;
}

export function meetingReserveMinutesForPlan(
  planId: BillingPlanId,
  freeRemaining: FreeAllowanceRemaining,
): number {
  const maxDuration = MEETING_MAX_DURATION_MINUTES_BY_PLAN[planId];
  if (planId === 'free') {
    return Math.min(maxDuration, Math.max(0, freeRemaining.recallMinutes));
  }
  return maxDuration;
}

export async function reserveRecallMeetingMinutes(
  billing: BillingAdmissionScope,
  input: { meetingId: string },
): Promise<
  | { ok: true; operationId: string; reservedMinutes: number }
  | { ok: false; code: BillingReserveFailureCode }
> {
  const operationId = recallOperationId(input.meetingId);
  const [account, dashboard] = await Promise.all([billing.getAccount(), billing.getDashboard()]);
  const reservedMinutes = meetingReserveMinutesForPlan(account.planId, dashboard.freeRemaining);
  if (reservedMinutes <= 0) {
    return { ok: false, code: 'free_allowance_reached' };
  }
  const reservedChargeCents = recallChargeCents(reservedMinutes);
  const reserved = await billing.reserve({
    operationId,
    meterId: 'recall_minutes',
    reservedNativeUnits: reservedMinutes,
    reservedChargeCents,
    ttlMs: RECALL_RESERVATION_TTL_MS,
    metadata: {
      operation_class: 'meeting_bot',
      meeting_id: input.meetingId,
      reserved_minutes: reservedMinutes,
    },
  });
  if (!reserved.ok) return reserved;
  return { ok: true, operationId, reservedMinutes };
}

export async function settleRecallMeetingMinutes(
  billing: BillingAdmissionScope,
  input: { meetingId: string; minutes: number; source?: string },
): Promise<void> {
  const minutes = Math.max(0, Math.trunc(input.minutes));
  const customerChargeCents = recallChargeCents(minutes);
  await billing.settle({
    operationId: recallOperationId(input.meetingId),
    meterId: 'recall_minutes',
    nativeUnits: minutes,
    customerChargeCents,
    operationClass: 'meeting_bot',
    provider: 'recall',
    source: input.source ?? 'meeting_finalize',
    metadata: { meeting_id: input.meetingId },
  });
}

function reservedMinutesFromMetadata(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const raw = (metadata as Record<string, unknown>).reserved_recall_minutes;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function joinStartedAtFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const raw = (metadata as Record<string, unknown>).reserved_recall_started_at;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

/**
 * Terminal no-show / waiting-room time is billable. Settle elapsed joining +
 * in-call minutes when any elapsed; otherwise release the unused reservation.
 * Retry no-shows must keep calling `releaseRecallMeetingMinutes` so the same
 * `recall:{meetingId}` operation can lock again.
 */
export async function settleElapsedRecallMeetingMinutes(
  billing: BillingAdmissionScope,
  input: {
    meetingId: string;
    joinStartedAt?: Date | string | null;
    startedAt?: Date | null;
    endedAt?: Date | null;
    reservedMinutes?: number | null;
    metadata?: unknown;
    source?: string;
  },
): Promise<void> {
  const minutes = recallBillableMinutes({
    joinStartedAt: input.joinStartedAt ?? joinStartedAtFromMetadata(input.metadata),
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    reservedMinutes: input.reservedMinutes ?? reservedMinutesFromMetadata(input.metadata),
  });
  if (minutes <= 0) {
    await releaseRecallMeetingMinutes(billing, { meetingId: input.meetingId });
    return;
  }
  await settleRecallMeetingMinutes(billing, {
    meetingId: input.meetingId,
    minutes,
    source: input.source ?? 'meeting_no_show',
  });
}
