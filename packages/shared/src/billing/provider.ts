export interface PolarUsageEvent {
  externalCustomerId: string;
  name: string;
  units: number;
  metadata?: Record<string, unknown>;
}

export interface CreateCheckoutInput {
  externalCustomerId: string;
  customerEmail: string;
  productId: string;
  successUrl: string;
  discountId?: string;
}

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
  ingestUsage(event: PolarUsageEvent): Promise<void>;
}

/** In-memory provider for unit/e2e tests — no network. */
export function createFakeBillingProvider(): BillingProvider & {
  events: PolarUsageEvent[];
  customers: Map<string, { id: string; email: string }>;
} {
  const events: PolarUsageEvent[] = [];
  const customers = new Map<string, { id: string; email: string }>();
  return {
    events,
    customers,
    async ensureCustomer(input) {
      const existing = customers.get(input.externalId);
      if (existing) return existing;
      const created = { id: `cus_fake_${input.externalId.slice(0, 8)}`, email: input.email };
      customers.set(input.externalId, created);
      return created;
    },
    async createCheckoutSession(input) {
      return {
        id: `chk_fake_${input.productId.slice(0, 8)}`,
        url: `https://sandbox.polar.sh/checkout/fake?product=${input.productId}`,
      };
    },
    async createCustomerPortalSession(input) {
      return {
        url: `https://sandbox.polar.sh/portal/fake?customer=${input.externalCustomerId}`,
      };
    },
    async ingestUsage(event) {
      events.push(event);
    },
  };
}
