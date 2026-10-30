export interface PolarUsageEvent {
  externalCustomerId: string;
  name: string;
  units: number;
  /** Stable Polar event id so retries do not double-ingest. */
  id?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCheckoutInput {
  externalCustomerId: string;
  customerEmail: string;
  productId: string;
  successUrl: string;
  discountId?: string;
  /** Custom-price amount in cents. Polar ignores this on a fixed price. */
  amount?: number;
}

export interface UpdateSubscriptionInput {
  subscriptionId: string;
  productId: string;
  discountId?: string;
}

export type UpdateSubscriptionResult = { ok: true } | { ok: false; code: 'portal_required' };

/**
 * Polar has no merchant expire endpoint. `expired` means the session is gone
 * or Polar reported `expired` / `failed`. `already_paid` means payment started.
 * `still_open` means the session is still payable, so a second link must wait.
 */
export type ExpireCheckoutResult = 'expired' | 'already_paid' | 'still_open';

export interface BillingProvider {
  /** Resolve a code or trusted operator assignment in the configured Polar organization. */
  resolveDiscount(input: {
    code?: string;
    discountId?: string;
    productId: string;
  }): Promise<string>;
  ensureCustomer(input: {
    externalId: string;
    email: string;
    name?: string;
  }): Promise<{ id: string }>;
  createCheckoutSession(input: CreateCheckoutInput): Promise<{ url: string; id: string }>;
  /**
   * Retire one checkout before another link is issued.
   * Fail closed with `still_open` when Polar leaves the session payable.
   */
  expireCheckout(checkoutId: string): Promise<ExpireCheckoutResult>;
  createCustomerPortalSession(input: {
    externalCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  updateSubscription(input: UpdateSubscriptionInput): Promise<UpdateSubscriptionResult>;
  /** Cancel immediately so a comp stops the platform fee. 404 and already-canceled are success. */
  revokeSubscription(subscriptionId: string): Promise<void>;
  ingestUsage(event: PolarUsageEvent): Promise<void>;
  /**
   * Event names with an active metered price on this product.
   * Null means the catalog could not be read. An empty list means it was
   * read and the meter is absent. A matching product id is not a substitute.
   */
  listPricedEventNames(productId: string): Promise<readonly string[] | null>;
}

/** Timeline meter events. Keep aligned with TIMELINE_METERED_EVENT_NAMES. */
const POLAR_PRICED_EVENT_NAMES = [
  'timeline_ai_eur_cents',
  'timeline_recall_minutes',
  'timeline_email_units',
  'timeline_storage_gb_month',
  'timeline_accepted_sources',
  'timeline_extra_member_days',
] as const;

/** In-memory provider for unit/e2e tests — no network. */
export function createFakeBillingProvider(): BillingProvider & {
  events: PolarUsageEvent[];
  customers: Map<string, { id: string; email: string }>;
  subscriptionUpdates: UpdateSubscriptionInput[];
  revokedSubscriptionIds: string[];
  checkouts: CreateCheckoutInput[];
  expiredCheckoutIds: string[];
  /** Per-product priced events. Missing keys default to every Timeline meter. */
  pricedEventNamesByProduct: Map<string, readonly string[] | null>;
} {
  const events: PolarUsageEvent[] = [];
  const customers = new Map<string, { id: string; email: string }>();
  const subscriptionUpdates: UpdateSubscriptionInput[] = [];
  const revokedSubscriptionIds: string[] = [];
  const checkouts: CreateCheckoutInput[] = [];
  const expiredCheckoutIds: string[] = [];
  const pricedEventNamesByProduct = new Map<string, readonly string[] | null>();
  return {
    events,
    customers,
    subscriptionUpdates,
    revokedSubscriptionIds,
    checkouts,
    expiredCheckoutIds,
    pricedEventNamesByProduct,
    resolveDiscount(input) {
      if (input.discountId) return Promise.resolve(input.discountId);
      return Promise.reject(
        new Error('Fake provider has no discount catalog; mock resolveDiscount.'),
      );
    },
    ensureCustomer(input) {
      const existing = customers.get(input.externalId);
      if (existing) return Promise.resolve(existing);
      const created = { id: `cus_fake_${input.externalId.slice(0, 8)}`, email: input.email };
      customers.set(input.externalId, created);
      return Promise.resolve(created);
    },
    createCheckoutSession(input) {
      checkouts.push(input);
      const amount = input.amount === undefined ? '' : `&amount=${String(input.amount)}`;
      return Promise.resolve({
        id: `chk_fake_${String(checkouts.length)}`,
        url: `https://sandbox.polar.sh/checkout/fake?product=${input.productId}${amount}`,
      });
    },
    expireCheckout(checkoutId) {
      expiredCheckoutIds.push(checkoutId);
      return Promise.resolve('expired');
    },
    createCustomerPortalSession(input) {
      return Promise.resolve({
        url: `https://sandbox.polar.sh/portal/fake?customer=${input.externalCustomerId}`,
      });
    },
    updateSubscription(input) {
      subscriptionUpdates.push(input);
      return Promise.resolve({ ok: true });
    },
    revokeSubscription(subscriptionId) {
      revokedSubscriptionIds.push(subscriptionId);
      return Promise.resolve();
    },
    ingestUsage(event) {
      events.push(event);
      return Promise.resolve();
    },
    listPricedEventNames(productId) {
      if (pricedEventNamesByProduct.has(productId)) {
        return Promise.resolve(pricedEventNamesByProduct.get(productId) ?? null);
      }
      return Promise.resolve(POLAR_PRICED_EVENT_NAMES);
    },
  };
}
