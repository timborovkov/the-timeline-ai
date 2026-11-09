export const BILLING_METERS = [
  { key: 'ai', eventName: 'timeline_ai_eur_cents' },
  { key: 'recall_minutes', eventName: 'timeline_recall_minutes' },
  { key: 'email_units', eventName: 'timeline_email_units' },
  { key: 'storage_gb_month', eventName: 'timeline_storage_gb_month' },
  { key: 'accepted_sources', eventName: 'timeline_accepted_sources' },
  // Member-day usage is ingested as member-month fractions at the catalog price.
  { key: 'member_days', eventName: 'timeline_extra_member_days' },
] as const;

export type BillingMeterId = (typeof BILLING_METERS)[number]['key'];
export type TimelineMeteredEventName = (typeof BILLING_METERS)[number]['eventName'];
export const TIMELINE_METERED_EVENT_NAMES = BILLING_METERS.map((meter) => meter.eventName);

export function polarEventNameForMeter(meter: BillingMeterId): string | null {
  return BILLING_METERS.find((descriptor) => descriptor.key === meter)?.eventName ?? null;
}

export function billingMeterIdForPolarEvent(name: string): BillingMeterId | null {
  return BILLING_METERS.find((descriptor) => descriptor.eventName === name)?.key ?? null;
}
