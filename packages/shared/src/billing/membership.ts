import { TEAM_MONTHLY_USAGE_PER_SEAT_CENTS } from '#src/billing/catalog.js';

export const FULL_MEMBER_ROLES = ['owner', 'admin', 'member'] as const;
export type FullMemberRole = (typeof FULL_MEMBER_ROLES)[number];

export function isFullMemberRole(role: string | null | undefined): role is FullMemberRole {
  return FULL_MEMBER_ROLES.some((fullRole) => fullRole === role);
}

/** Capacity is acquired only when crossing into a full-member role. */
export function fullMemberSeatsToAcquire(
  currentRole: string | null,
  nextRole: string | null,
): number {
  return !isFullMemberRole(currentRole) && isFullMemberRole(nextRole) ? 1 : 0;
}

export interface TeamSeatTerms {
  paidSeats: number;
  highWaterSeats: number;
  includedUsageCents: number;
}

/** Only confirmed increases over the period high-water mark earn another grant. */
export function applyConfirmedSeatQuantity(input: {
  prior: TeamSeatTerms | null;
  paidSeats: number;
  periodStart: Date;
  periodEnd: Date;
  confirmedAt: Date;
}): { terms: TeamSeatTerms; grantCents: number } {
  const { prior, paidSeats, periodStart, periodEnd, confirmedAt } = input;
  const highWaterSeats = Math.max(prior?.highWaterSeats ?? 0, paidSeats);
  const remaining = Math.max(
    0,
    Math.min(
      1,
      (periodEnd.getTime() - confirmedAt.getTime()) / (periodEnd.getTime() - periodStart.getTime()),
    ),
  );
  const grantCents = prior
    ? Math.round(
        (highWaterSeats - prior.highWaterSeats) * TEAM_MONTHLY_USAGE_PER_SEAT_CENTS * remaining,
      )
    : paidSeats * TEAM_MONTHLY_USAGE_PER_SEAT_CENTS;
  return {
    grantCents,
    terms: {
      paidSeats,
      highWaterSeats,
      includedUsageCents: (prior?.includedUsageCents ?? 0) + grantCents,
    },
  };
}

export function teamSeatQuantityChange(input: {
  desired: number;
  current: number;
  pending: number | null;
  activating: boolean;
}): 'invoice' | 'next_period' | null {
  const { desired, current, pending, activating } = input;
  if (desired > current) return activating ? 'invoice' : null;
  if (desired === current) return pending === null ? null : 'next_period';
  if (pending === desired || (activating && pending === null)) return null;
  return 'next_period';
}
