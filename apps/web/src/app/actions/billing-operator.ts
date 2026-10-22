'use server';

import { isBillingPlanId, parseOperatorExpiry } from '@timeline/shared/billing/operator';
import {
  assignCompedPlan,
  BillingOperatorError,
  clearCompedPlan,
  clearTeamPolarDiscount,
  clearTeamPriceOverride,
  setOperatorSpendCap,
  setTeamPolarDiscount,
  setTeamPriceOverride,
} from '@timeline/shared/billing/operator-store';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

async function actor() {
  const session = await auth();
  if (!session?.user.id || !session.user.email) redirect('/sign-in');
  return { userId: session.user.id, email: session.user.email };
}

function formString(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function teamIdFrom(formData: FormData): string {
  const teamId = formString(formData.get('teamId'));
  if (!teamId) throw new BillingOperatorError('Team id is required.');
  return teamId;
}

function eurosToCents(raw: FormDataEntryValue | null, label: string): number {
  const value = formString(raw);
  if (!value) throw new BillingOperatorError(`${label} is required.`);
  const euros = Number(value);
  if (!Number.isFinite(euros) || euros < 0) {
    throw new BillingOperatorError(`${label} must be a non-negative euro amount.`);
  }
  return Math.round(euros * 100);
}

function optionalEurosToCents(raw: FormDataEntryValue | null): number | undefined {
  const value = formString(raw);
  if (!value) return undefined;
  const euros = Number(value);
  if (!Number.isFinite(euros) || euros < 0) {
    throw new BillingOperatorError('Prices must be non-negative euro amounts.');
  }
  return Math.round(euros * 100);
}

function optionalInt(raw: FormDataEntryValue | null): number | undefined {
  const value = formString(raw);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new BillingOperatorError('Enter a whole number.');
  return parsed;
}

function back(teamId: string, error?: string): never {
  const params = new URLSearchParams({ team: teamId });
  if (error) params.set('error', error);
  else params.set('notice', 'saved');
  redirect(`/app/admin/billing?${params.toString()}`);
}

function isNextRedirect(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    String(error.digest).startsWith('NEXT_REDIRECT')
  );
}

function run(teamId: string, work: () => Promise<void>): Promise<void> {
  return work().then(
    () => {
      back(teamId);
    },
    (error: unknown) => {
      if (isNextRedirect(error)) throw error;
      const message = error instanceof Error ? error.message : 'Operator change failed.';
      back(teamId, message);
    },
  );
}

export async function assignCompedPlanAction(formData: FormData): Promise<void> {
  const teamId = teamIdFrom(formData);
  const plan = formString(formData.get('plan'));
  if (!isBillingPlanId(plan)) {
    back(teamId, 'Choose a plan.');
  }
  await run(teamId, async () => {
    await assignCompedPlan({
      db,
      actor: await actor(),
      teamId,
      entitlementsPlanId: plan,
      spendCapCents: eurosToCents(formData.get('spendCapEuros'), 'Spend cap'),
      reason: formString(formData.get('reason')),
      expiresAt: parseOperatorExpiry(formString(formData.get('expires'))),
    });
  });
}

export async function clearCompedPlanAction(formData: FormData): Promise<void> {
  const teamId = teamIdFrom(formData);
  await run(teamId, async () => {
    await clearCompedPlan({ db, actor: await actor(), teamId });
  });
}

export async function setPriceOverrideAction(formData: FormData): Promise<void> {
  const teamId = teamIdFrom(formData);
  await run(teamId, async () => {
    const platformFeeCents = optionalEurosToCents(formData.get('platformFeeEuros'));
    const includedActiveMembers = optionalInt(formData.get('includedMembers'));
    const additionalMemberCents = optionalEurosToCents(formData.get('memberEuros'));
    const meteredDiscountPercent = optionalInt(formData.get('meteredDiscountPercent'));
    await setTeamPriceOverride({
      db,
      actor: await actor(),
      teamId,
      override: {
        ...(platformFeeCents !== undefined ? { platformFeeCents } : {}),
        ...(includedActiveMembers !== undefined ? { includedActiveMembers } : {}),
        ...(additionalMemberCents !== undefined ? { additionalMemberCents } : {}),
        ...(meteredDiscountPercent !== undefined ? { meteredDiscountPercent } : {}),
      },
      expiresAt: parseOperatorExpiry(formString(formData.get('expires'))),
    });
  });
}

export async function clearPriceOverrideAction(formData: FormData): Promise<void> {
  const teamId = teamIdFrom(formData);
  await run(teamId, async () => {
    await clearTeamPriceOverride({ db, actor: await actor(), teamId });
  });
}

export async function setPolarDiscountAction(formData: FormData): Promise<void> {
  const teamId = teamIdFrom(formData);
  await run(teamId, async () => {
    await setTeamPolarDiscount({
      db,
      actor: await actor(),
      teamId,
      polarDiscountId: formString(formData.get('polarDiscountId')),
      expiresAt: parseOperatorExpiry(formString(formData.get('expires'))),
    });
  });
}

export async function clearPolarDiscountAction(formData: FormData): Promise<void> {
  const teamId = teamIdFrom(formData);
  await run(teamId, async () => {
    await clearTeamPolarDiscount({ db, actor: await actor(), teamId });
  });
}

export async function setOperatorSpendCapAction(formData: FormData): Promise<void> {
  const teamId = teamIdFrom(formData);
  await run(teamId, async () => {
    await setOperatorSpendCap({
      db,
      actor: await actor(),
      teamId,
      spendCapCents: eurosToCents(formData.get('spendCapEuros'), 'Spend cap'),
    });
  });
}
