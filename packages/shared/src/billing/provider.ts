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
}

export interface UpdateSubscriptionInput {
  subscriptionId: string;
  productId: string;
  discountId?: string;
}

export type UpdateSubscriptionResult = { ok: true } | { ok: false; code: 'portal_required' };

export interface BillingProvider {
  ensureCustomer(input: {
    externalId: string;
    email: string;
    name?: string;
  }): Promise<{ id: string }>;
  createCheckoutSession(input: CreateCheckoutInput): Promise<{ url: string; id: string }>;
  createCustomerPortalSession(input: {
    externalCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  updateSubscription(input: UpdateSubscriptionInput): Promise<UpdateSubscriptionResult>;
  ingestUsage(event: PolarUsageEvent): Promise<void>;
}

/** In-memory provider for unit/e2e tests — no network. */
export function createFakeBillingProvider(): BillingProvider & {
  events: PolarUsageEvent[];
  customers: Map<string, { id: string; email: string }>;
  subscriptionUpdates: UpdateSubscriptionInput[];
} {
  const events: PolarUsageEvent[] = [];
  const customers = new Map<string, { id: string; email: string }>();
  const subscriptionUpdates: UpdateSubscriptionInput[] = [];
  return {
    events,
    customers,
    subscriptionUpdates,
    ensureCustomer(input) {
      const existing = customers.get(input.externalId);
      if (existing) return Promise.resolve(existing);
      const created = { id: `cus_fake_${input.externalId.slice(0, 8)}`, email: input.email };
      customers.set(input.externalId, created);
      return Promise.resolve(created);
    },
    createCheckoutSession(input) {
      return Promise.resolve({
        id: `chk_fake_${input.productId.slice(0, 8)}`,
        url: `https://sandbox.polar.sh/checkout/fake?product=${input.productId}`,
      });
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
    ingestUsage(event) {
      events.push(event);
      return Promise.resolve();
    },
  };
}
