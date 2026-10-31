import type {
  PolarIdentityApi,
  PolarPerson,
  PolarCustomerIdentity,
  PolarMemberIdentity,
} from '#src/billing/polar-identity-api.js';

export interface PolarUsageEvent {
  externalCustomerId: string;
  name: string;
  units: number;
  /** Stable Polar event id so retries do not double-ingest. */
  id?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCheckoutInput {
  customerId?: string;
  memberId?: string;
  externalCustomerId: string;
  customerEmail: string;
  productId: string;
  successUrl: string;
  discountId?: string;
  /** Custom-price amount in cents. Polar ignores this on a fixed price. */
  amount?: number;
}

export interface UpdateSubscriptionInput {
  customerId?: string;
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
  identity?: PolarIdentityApi;
  /** Resolve a code or trusted operator assignment in the configured Polar organization. */
  resolveDiscount(input: {
    code?: string;
    discountId?: string;
    productId: string;
  }): Promise<string>;
  ensureCustomer(input: {
    owner?: PolarPerson;
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
    customerId?: string;
    memberId?: string;
    externalCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  updateSubscription(input: UpdateSubscriptionInput): Promise<UpdateSubscriptionResult>;
  /** Cancel immediately so a comp stops the platform fee. 404 and already-canceled are success. */
  revokeSubscription(subscriptionId: string, customerId?: string): Promise<void>;
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
export function createFakeBillingProvider(options?: { teamIdentity?: boolean }): BillingProvider & {
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
  const identityCustomers = new Map<string, PolarCustomerIdentity>();
  const identityMembers = new Map<string, PolarMemberIdentity>();
  const identity: PolarIdentityApi = {
    server: 'sandbox',
    organizationId: 'org-synthetic',
    customer(teamId, id) {
      const row = identityCustomers.get(teamId);
      if (id && row?.id !== id) return Promise.reject(new Error('identity conflict'));
      return Promise.resolve(row ?? null);
    },
    create(teamId, _name, owner) {
      const row: PolarCustomerIdentity = {
        id: `cus_fake_${teamId.slice(0, 8)}`,
        external_id: teamId,
        organization_id: 'org-synthetic',
        type: 'team',
      };
      identityCustomers.set(teamId, row);
      customers.set(teamId, { id: row.id, email: owner.email });
      const member: PolarMemberIdentity = {
        id: `mem_${teamId}_${owner.userId}`,
        customer_id: row.id,
        external_id: owner.userId,
        email: owner.email,
        role: 'owner',
      };
      identityMembers.set(member.id, member);
      return Promise.resolve(row);
    },
    convert(teamId) {
      const row = identityCustomers.get(teamId);
      if (!row) return Promise.reject(new Error('customer missing'));
      row.type = 'team';
      return Promise.resolve(row);
    },
    clearEmail(teamId) {
      const row = identityCustomers.get(teamId);
      if (row) row.email = null;
      return Promise.resolve();
    },
    members(customerId) {
      return Promise.resolve(
        [...identityMembers.values()].filter((member) => member.customer_id === customerId),
      );
    },
    saveMember(customerId, person, role, id) {
      if (role === 'owner')
        for (const member of identityMembers.values())
          if (member.customer_id === customerId && member.role === 'owner')
            member.role = 'billing_manager';
      const row: PolarMemberIdentity = {
        id: id ?? `mem_${customerId}_${person.userId}`,
        customer_id: customerId,
        external_id: id ? (identityMembers.get(id)?.external_id ?? null) : person.userId,
        email: person.email,
        role,
      };
      identityMembers.set(row.id, row);
      return Promise.resolve(row);
    },
    removeMember(_customerId, id) {
      identityMembers.delete(id);
      return Promise.resolve();
    },
    assertSubscription() {
      return Promise.resolve();
    },
  };

  return {
    ...(options?.teamIdentity ? { identity } : {}),
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
