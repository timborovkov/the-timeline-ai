import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  BillingProvider,
  CreateCheckoutInput,
  PolarUsageEvent,
  UpdateSubscriptionInput,
} from '#src/billing/provider.js';

import { getEnv } from '#src/env.js';

export type PolarServer = 'sandbox' | 'production';

function polarBaseUrl(server: PolarServer): string {
  return server === 'sandbox' ? 'https://sandbox-api.polar.sh/v1' : 'https://api.polar.sh/v1';
}

export function isPolarBillingConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.POLAR_ACCESS_TOKEN && env.POLAR_PRODUCT_ID_PAYG);
}

export function createPolarBillingProvider(options?: {
  accessToken?: string;
  server?: PolarServer;
}): BillingProvider | null {
  const env = getEnv();
  const accessToken = options?.accessToken ?? env.POLAR_ACCESS_TOKEN;
  if (!accessToken) return null;
  const server = options?.server ?? env.POLAR_SERVER;
  const base = polarBaseUrl(server);

  async function polarFetch(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    headers.set('Accept', 'application/json');
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return fetch(`${base}${path}`, {
      ...init,
      headers,
    });
  }

  return {
    async ensureCustomer(input) {
      const list = await polarFetch(
        `/customers/?external_id=${encodeURIComponent(input.externalId)}&limit=1`,
      );
      if (list.ok) {
        const body = (await list.json()) as { items?: { id: string }[] };
        if (body.items?.[0]?.id) return { id: body.items[0].id };
      }
      const created = await polarFetch('/customers/', {
        method: 'POST',
        body: JSON.stringify({
          external_id: input.externalId,
          email: input.email,
          name: input.name,
        }),
      });
      if (!created.ok) {
        throw new Error(`Polar create customer failed: ${created.status}`);
      }
      const row = (await created.json()) as { id: string };
      return { id: row.id };
    },

    async createCheckoutSession(input: CreateCheckoutInput) {
      const created = await polarFetch('/checkouts/', {
        method: 'POST',
        body: JSON.stringify({
          products: [input.productId],
          success_url: input.successUrl,
          customer_email: input.customerEmail,
          customer_external_id: input.externalCustomerId,
          ...(input.discountId ? { discount_id: input.discountId } : {}),
        }),
      });
      if (!created.ok) {
        throw new Error(`Polar checkout failed: ${created.status}`);
      }
      const row = (await created.json()) as { id: string; url: string };
      return { id: row.id, url: row.url };
    },

    async createCustomerPortalSession(input) {
      const created = await polarFetch('/customer-sessions/', {
        method: 'POST',
        body: JSON.stringify({
          external_customer_id: input.externalCustomerId,
          return_url: input.returnUrl,
        }),
      });
      if (!created.ok) {
        throw new Error(`Polar customer portal failed: ${created.status}`);
      }
      const row = (await created.json()) as { customer_portal_url?: string; url?: string };
      const url = row.customer_portal_url ?? row.url;
      if (!url) throw new Error('Polar customer portal missing url');
      return { url };
    },

    async updateSubscription(input: UpdateSubscriptionInput) {
      const updated = await polarFetch(`/subscriptions/${input.subscriptionId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          product_id: input.productId,
          proration_behavior: 'prorate',
          ...(input.discountId ? { discount_id: input.discountId } : {}),
        }),
      });
      if (updated.ok) return { ok: true as const };
      // Polar needs a stored payment method change or the subscription is
      // locked/canceled — send the owner to the customer portal instead of
      // opening a second checkout that would stack subscriptions.
      if (updated.status === 402 || updated.status === 403 || updated.status === 409) {
        return { ok: false as const, code: 'portal_required' as const };
      }
      throw new Error(`Polar subscription update failed: ${updated.status}`);
    },

    async ingestUsage(event: PolarUsageEvent) {
      const res = await polarFetch('/events/ingest', {
        method: 'POST',
        body: JSON.stringify({
          events: [
            {
              name: event.name,
              ...(event.id ? { id: event.id } : {}),
              external_customer_id: event.externalCustomerId,
              metadata: { units: event.units, ...(event.metadata ?? {}) },
            },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`Polar event ingest failed: ${res.status}`);
      }
    },
  };
}

/**
 * Verify Polar webhook signatures (Standard Webhooks / whsec_ prefix).
 * Rejects missing headers, malformed timestamps, and timestamps outside a
 * 5-minute tolerance (replay / clock-skew), then fail-closes on HMAC mismatch.
 */
export function verifyPolarWebhookSignature(input: {
  body: string;
  headers: Headers | Record<string, string | null | undefined>;
  secret: string;
  now?: Date;
  toleranceSec?: number;
}): boolean {
  const get = (name: string): string | null => {
    if (input.headers instanceof Headers) return input.headers.get(name);
    const direct = input.headers[name] ?? input.headers[name.toLowerCase()];
    return direct ?? null;
  };
  const webhookId = get('webhook-id') ?? get('svix-id');
  const timestamp = get('webhook-timestamp') ?? get('svix-timestamp');
  const signatureHeader = get('webhook-signature') ?? get('svix-signature');
  if (!webhookId || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = (input.now ?? new Date()).getTime() / 1000;
  const tolerance = input.toleranceSec ?? 5 * 60;
  if (Math.abs(nowSec - ts) > tolerance) return false;

  const secret = input.secret.startsWith('whsec_')
    ? Buffer.from(input.secret.slice('whsec_'.length), 'base64')
    : Buffer.from(input.secret, 'utf8');

  const signed = `${webhookId}.${timestamp}.${input.body}`;
  const expected = createHmac('sha256', secret).update(signed).digest('base64');
  const candidates = signatureHeader.split(' ').map((part) => {
    const [, value] = part.split(',');
    return value ?? part;
  });
  const expectedBuf = Buffer.from(expected);
  return candidates.some((candidate) => {
    try {
      const got = Buffer.from(candidate);
      return got.length === expectedBuf.length && timingSafeEqual(got, expectedBuf);
    } catch {
      return false;
    }
  });
}

export function polarProductIdForPlan(plan: 'payg' | 'team' | 'business'): string | undefined {
  const env = getEnv();
  switch (plan) {
    case 'payg':
      return env.POLAR_PRODUCT_ID_PAYG;
    case 'team':
      return env.POLAR_PRODUCT_ID_TEAM;
    case 'business':
      return env.POLAR_PRODUCT_ID_BUSINESS;
  }
}

export function polarTopUpProductId(): string | undefined {
  return getEnv().POLAR_PRODUCT_ID_TOPUP;
}

export function isPolarTopUpConfigured(): boolean {
  return Boolean(getEnv().POLAR_ACCESS_TOKEN && polarTopUpProductId());
}

const POLAR_PLAN_CHANGE_CANCELED_STATES = new Set(['canceled', 'deletion_scheduled']);

/** Paid workspaces already have a Polar subscription; do not open a second one. */
export function polarSubscriptionIdForPlanChange(account: {
  planId: string;
  billingState: string;
  polarSubscriptionId: string | null;
}): string | undefined {
  if (!account.polarSubscriptionId) return undefined;
  if (account.planId !== 'payg' && account.planId !== 'team' && account.planId !== 'business') {
    return undefined;
  }
  if (POLAR_PLAN_CHANGE_CANCELED_STATES.has(account.billingState)) {
    return undefined;
  }
  return account.polarSubscriptionId;
}

/**
 * Free → paid uses Polar checkout. Paid → paid updates the existing
 * subscription (or the customer portal when Polar cannot PATCH in place).
 * Enterprise is contractual — never open a second self-serve checkout.
 */
export async function createPlanChangeSession(input: {
  provider: BillingProvider;
  account: {
    planId: string;
    billingState: string;
    polarSubscriptionId: string | null;
  };
  productId: string;
  externalCustomerId: string;
  customerEmail: string;
  successUrl: string;
  portalReturnUrl: string;
  discountId?: string;
}): Promise<{ url: string }> {
  if (input.account.planId === 'enterprise') {
    throw new Error(
      'Enterprise plan changes go through support or the Polar customer portal, not self-serve checkout.',
    );
  }
  const subscriptionId = polarSubscriptionIdForPlanChange(input.account);
  if (subscriptionId) {
    try {
      const updated = await input.provider.updateSubscription({
        subscriptionId,
        productId: input.productId,
        ...(input.discountId ? { discountId: input.discountId } : {}),
      });
      if (updated.ok) return { url: input.successUrl };
    } catch {
      // Polar could not change the product in place.
    }
    const portal = await input.provider.createCustomerPortalSession({
      externalCustomerId: input.externalCustomerId,
      returnUrl: input.portalReturnUrl,
    });
    return { url: portal.url };
  }
  return input.provider.createCheckoutSession({
    externalCustomerId: input.externalCustomerId,
    customerEmail: input.customerEmail,
    productId: input.productId,
    successUrl: input.successUrl,
    ...(input.discountId ? { discountId: input.discountId } : {}),
  });
}
