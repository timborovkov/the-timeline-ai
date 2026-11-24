import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { TEAM_MONTHLY_SEAT_CENTS } from '#src/billing/catalog.js';
import { createPolarIdentityApi, PolarIdentityError } from '#src/billing/polar-identity-api.js';
import {
  isMonthlyUsdTeamCheckoutProduct,
  TIMELINE_METERED_EVENT_NAMES,
} from '#src/billing/polar-setup.js';
import type {
  BillingProvider,
  CreateCheckoutInput,
  PendingEnterpriseCheckout,
  PendingTeamCheckout,
  PolarUsageEvent,
  UpdateSubscriptionInput,
} from '#src/billing/provider.js';
import { getEnv } from '#src/env.js';

export type PolarServer = 'sandbox' | 'production';

/** Safe messages for the customer; never expose provider bodies or submitted codes. */
export class PolarDiscountError extends Error {
  readonly code: 'ineligible' | 'unavailable';
  constructor(code: 'ineligible' | 'unavailable') {
    super(
      code === 'ineligible'
        ? 'That discount is invalid or not eligible for this plan or customer. No plan change was completed.'
        : 'Polar could not apply the discount right now. Please retry. We will not continue at full price.',
    );
    this.name = 'PolarDiscountError';
    this.code = code;
  }
}

const polarDiscountSchema = z.object({
  id: z.string().min(1),
  organization_id: z.string().min(1),
  code: z.string().nullable(),
  starts_at: z.iso.datetime({ offset: true }).nullable(),
  ends_at: z.iso.datetime({ offset: true }).nullable(),
  max_redemptions: z.number().int().nonnegative().nullable(),
  redemptions_count: z.number().int().nonnegative(),
  products: z.array(z.object({ id: z.string().min(1) })),
});

async function discountWriteError(response: Response): Promise<PolarDiscountError> {
  // Only a structured discount rejection is an eligibility error. Auth, rate
  // limits, server errors and unrelated validation failures are provider failures.
  if (response.status === 422) {
    const body: unknown = await response.json().catch(() => null);
    const parsed = z
      .object({ detail: z.array(z.object({ loc: z.array(z.union([z.string(), z.number()])) })) })
      .safeParse(body);
    if (
      parsed.success &&
      parsed.data.detail.some(
        (item) => item.loc.includes('discount_id') || item.loc.includes('discount_code'),
      )
    ) {
      return new PolarDiscountError('ineligible');
    }
  }
  return new PolarDiscountError('unavailable');
}

function polarBaseUrl(server: PolarServer): string {
  return server === 'sandbox' ? 'https://sandbox-api.polar.sh/v1' : 'https://api.polar.sh/v1';
}

export function isPolarBillingConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.POLAR_ACCESS_TOKEN && env.POLAR_PRODUCT_ID_TEAM);
}

/** Polar's get-by-external-id route. List Customers does not filter on this id. */
export function polarCustomerByExternalIdPath(externalId: string): string {
  return `/customers/external/${encodeURIComponent(externalId)}`;
}

/**
 * Use a Polar customer only when the record is the one this workspace asked for.
 * A list row, a mismatched lookup, or a create response for someone else is refused.
 */
export function polarCustomerIdForExternalId(
  customer: { id?: unknown; external_id?: unknown },
  externalId: string,
): string {
  if (typeof customer.id !== 'string' || customer.id.length === 0) {
    throw new Error('Polar customer response is missing an id');
  }
  if (customer.external_id !== externalId) {
    throw new Error('Polar customer external_id does not match this workspace');
  }
  return customer.id;
}

const TEAM_CHECKOUT_METADATA_KEY = 'timeline_team_checkout';
const TEAM_CHECKOUT_WITHOUT_ASSIGNED_DISCOUNT = 'standard';
const ENTERPRISE_CHECKOUT_METADATA_KEY = 'timeline_enterprise_checkout';

const enterpriseCheckoutSchema = z.object({
  id: z.string().min(1),
  url: z.url({ protocol: /^https$/ }),
  customer_id: z.string(),
  product: z.object({ id: z.string() }),
  status: z.enum(['open', 'confirmed', 'succeeded']),
  currency: z.string(),
  amount: z.number().int(),
  expires_at: z.iso.datetime({ offset: true }),
  discount_id: z.string().nullable(),
  metadata: z.object({ [ENTERPRISE_CHECKOUT_METADATA_KEY]: z.string() }),
});

const teamCheckoutSchema = z.object({
  id: z.string().min(1),
  url: z.url({ protocol: /^https$/ }),
  customer_id: z.string(),
  product: z.object({ id: z.string() }),
  status: z.enum(['open', 'confirmed']),
  currency: z.string(),
  amount: z.number().int(),
  seats: z.number().int().nullable(),
  min_seats: z.number().int().nullable(),
  max_seats: z.number().int().nullable(),
  expires_at: z.iso.datetime({ offset: true }),
  discount_id: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()),
});

function fixedTeamCheckoutSeats(row: z.infer<typeof teamCheckoutSchema>): number | null {
  const { seats } = row;
  return row.status === 'open' &&
    Date.parse(row.expires_at) > Date.now() &&
    row.currency === 'usd' &&
    seats !== null &&
    row.min_seats === seats &&
    row.max_seats === seats &&
    row.amount === seats * TEAM_MONTHLY_SEAT_CENTS
    ? seats
    : null;
}

const seatSubscriptionSchema = z
  .object({
    id: z.string(),
    customer_id: z.string(),
    product_id: z.string(),
    currency: z.literal('usd'),
    recurring_interval: z.literal('month'),
    recurring_interval_count: z.literal(1),
    seats: z.number().int().min(1).max(1000),
    status: z.string(),
    current_period_start: z.iso.datetime({ offset: true }),
    current_period_end: z.iso.datetime({ offset: true }),
    cancel_at_period_end: z.boolean().optional(),
    ends_at: z.iso.datetime({ offset: true }).nullish(),
    ended_at: z.iso.datetime({ offset: true }).nullish(),
    modified_at: z.iso.datetime({ offset: true }).nullish(),
    created_at: z.iso.datetime({ offset: true }),
    pending_update: z
      .object({ seats: z.number().int().min(1).max(1000).nullable() })
      .nullable()
      .optional(),
  })
  .transform((row) => {
    const periodEnd = new Date(row.current_period_end);
    const cancellation = row.ends_at
      ? { cancelEffectiveAt: new Date(row.ends_at) }
      : row.cancel_at_period_end === undefined
        ? {}
        : { cancelEffectiveAt: row.cancel_at_period_end ? periodEnd : null };
    return {
      id: row.id,
      customerId: row.customer_id,
      productId: row.product_id,
      seats: row.seats,
      pendingSeats: row.pending_update?.seats ?? null,
      status: row.status,
      periodStart: new Date(row.current_period_start),
      periodEnd,
      modifiedAt: new Date(row.modified_at ?? row.created_at),
      ...(row.ended_at !== undefined
        ? { endedAt: row.ended_at === null ? null : new Date(row.ended_at) }
        : {}),
      ...cancellation,
    };
  });

export function createPolarBillingProvider(options?: {
  accessToken?: string;
  server?: PolarServer;
  organizationId?: string;
}): BillingProvider | null {
  const env = getEnv();
  const accessToken = options?.accessToken ?? env.POLAR_ACCESS_TOKEN;
  if (!accessToken) return null;
  const server = options?.server ?? env.POLAR_SERVER;
  const base = polarBaseUrl(server);
  const organizationId = options?.organizationId ?? env.POLAR_ORGANIZATION_ID;

  async function polarFetch(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    headers.set('Accept', 'application/json');
    headers.set('User-Agent', 'Timeline-Billing/1.0');
    headers.set('Polar-Version', '2026-10');
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return fetch(`${base}${path}`, {
      ...init,
      headers,
      signal: init?.signal ?? AbortSignal.timeout(15_000),
    });
  }

  const identity = createPolarIdentityApi(polarFetch, server, organizationId);
  return {
    identity,
    async resolveDiscount(input) {
      if (!organizationId) throw new PolarDiscountError('unavailable');
      try {
        let match: z.infer<typeof polarDiscountSchema> | undefined;
        if (input.discountId) {
          const response = await polarFetch(`/discounts/${encodeURIComponent(input.discountId)}`);
          if (response.status === 404) throw new PolarDiscountError('ineligible');
          if (!response.ok) throw new PolarDiscountError('unavailable');
          match = polarDiscountSchema.parse(await response.json());
          if (match.id !== input.discountId) throw new PolarDiscountError('unavailable');
        } else {
          const code = input.code?.trim().toLowerCase();
          if (!code) throw new PolarDiscountError('ineligible');
          // List's query parameter searches names, not codes. Scan every page
          // within the organization and compare codes exactly (case-insensitive).
          for (let page = 1; ; page++) {
            const query = new URLSearchParams({
              organization_id: organizationId,
              limit: '100',
              page: String(page),
            });
            const response = await polarFetch(`/discounts/?${query.toString()}`);
            if (!response.ok) throw new PolarDiscountError('unavailable');
            const result = z
              .object({
                items: z.array(polarDiscountSchema),
                pagination: z.object({ max_page: z.number().int().nonnegative() }),
              })
              .parse(await response.json());
            match = result.items.find(
              (item) =>
                item.organization_id === organizationId && item.code?.toLowerCase() === code,
            );
            if (match || page >= result.pagination.max_page) break;
          }
        }
        const now = Date.now();
        if (
          match?.organization_id !== organizationId ||
          (match.starts_at !== null && Date.parse(match.starts_at) > now) ||
          (match.ends_at !== null && Date.parse(match.ends_at) <= now) ||
          (match.max_redemptions !== null && match.redemptions_count >= match.max_redemptions) ||
          (match.products.length > 0 &&
            !match.products.some((product) => product.id === input.productId))
        ) {
          throw new PolarDiscountError('ineligible');
        }
        // Currency, price applicability, concurrent redemptions and per-customer
        // limits (including payment-card identity) are enforced by Polar itself.
        return match.id;
      } catch (error) {
        if (error instanceof PolarDiscountError) throw error;
        throw new PolarDiscountError('unavailable');
      }
    },
    async ensureCustomer(input) {
      if (!input.owner || !input.name)
        throw new PolarIdentityError('configuration', 'owner_required');
      const customer =
        (await identity.customer(input.externalId)) ??
        (await identity.create(input.externalId, input.name, input.owner));
      if (customer.type !== 'team')
        throw new PolarIdentityError('configuration', 'conversion_required');
      return { id: customer.id };
    },

    async createCheckoutSession(input: CreateCheckoutInput) {
      if (!input.customerId) throw new PolarIdentityError('identity_conflict', 'checkout_customer');
      const customer = await identity.customer(input.externalCustomerId, input.customerId);
      if (customer?.type !== 'team')
        throw new PolarIdentityError('identity_conflict', 'checkout_customer');
      if (input.seats !== undefined) {
        if (!Number.isSafeInteger(input.seats) || input.seats < 1 || input.seats > 1000) {
          throw new Error('Invalid Team seat quantity.');
        }
        const response = await polarFetch(`/products/${encodeURIComponent(input.productId)}`);
        const product: unknown = response.ok ? await response.json() : null;
        const productIdentity = z
          .object({ id: z.string(), organization_id: z.string() })
          .safeParse(product);
        if (
          !productIdentity.success ||
          productIdentity.data.id !== input.productId ||
          productIdentity.data.organization_id !== organizationId ||
          !isMonthlyUsdTeamCheckoutProduct(product)
        ) {
          throw new Error(
            'Configured Team product does not have the expected monthly USD seat pricing.',
          );
        }
      }
      const created = await polarFetch('/checkouts/', {
        method: 'POST',
        body: JSON.stringify({
          products: [input.productId],
          success_url: input.successUrl,
          customer_id: input.customerId,
          ...(input.seats !== undefined
            ? {
                currency: 'usd',
                allow_trial: false,
                seats: input.seats,
                min_seats: input.seats,
                max_seats: input.seats,
                metadata: {
                  [TEAM_CHECKOUT_METADATA_KEY]:
                    input.discountId ?? TEAM_CHECKOUT_WITHOUT_ASSIGNED_DISCOUNT,
                },
              }
            : {}),
          ...(input.enterpriseQuoteKey
            ? {
                currency: 'usd',
                metadata: { [ENTERPRISE_CHECKOUT_METADATA_KEY]: input.enterpriseQuoteKey },
              }
            : {}),
          allow_discount_codes: !input.discountId,
          ...(input.discountId ? { discount_id: input.discountId } : {}),
          ...(typeof input.amount === 'number' ? { amount: input.amount } : {}),
        }),
      });
      if (!created.ok) {
        if (input.discountId) throw await discountWriteError(created);
        throw new Error(`Polar checkout failed: ${created.status}`);
      }
      const body: unknown = await created.json();
      if (input.seats !== undefined) {
        const row = teamCheckoutSchema.parse(body);
        if (
          row.customer_id !== input.customerId ||
          row.product.id !== input.productId ||
          fixedTeamCheckoutSeats(row) !== input.seats
        )
          throw new Error('Polar did not confirm the Team checkout quote.');
      }
      if (input.enterpriseQuoteKey) {
        const row = enterpriseCheckoutSchema.parse(body);
        if (
          row.customer_id !== input.customerId ||
          row.product.id !== input.productId ||
          row.status !== 'open' ||
          Date.parse(row.expires_at) <= Date.now() ||
          row.currency !== 'usd' ||
          row.amount !== input.amount ||
          row.discount_id !== (input.discountId ?? null) ||
          row.metadata[ENTERPRISE_CHECKOUT_METADATA_KEY] !== input.enterpriseQuoteKey
        ) {
          throw new Error('Polar did not confirm the Enterprise checkout quote.');
        }
      }
      const row = z
        .object({
          id: z.string().min(1),
          url: z.url({ protocol: /^https$/ }),
          discount_id: z.string().nullish(),
        })
        .parse(body);
      if (input.discountId && row.discount_id !== input.discountId) {
        throw new PolarDiscountError('unavailable');
      }
      return { id: row.id, url: row.url };
    },

    async listPendingTeamCheckouts(input) {
      if (!organizationId) throw new PolarIdentityError('configuration', 'checkout_organization');
      const pending: PendingTeamCheckout[] = [];
      for (let page = 1; ; page++) {
        const query = new URLSearchParams({
          organization_id: organizationId,
          customer_id: input.customerId,
          product_id: input.productId,
          limit: '100',
          page: String(page),
        });
        query.append('status', 'open');
        query.append('status', 'confirmed');
        const response = await polarFetch(`/checkouts/?${query.toString()}`);
        if (!response.ok) throw new Error(`Polar checkout recovery failed: ${response.status}`);
        const result = z
          .object({
            items: z.array(z.object({ metadata: z.record(z.string(), z.unknown()) }).loose()),
            pagination: z.object({ max_page: z.number().int().nonnegative() }),
          })
          .parse(await response.json());
        for (const item of result.items) {
          const intent = item.metadata[TEAM_CHECKOUT_METADATA_KEY];
          if (typeof intent !== 'string') continue;
          const row = teamCheckoutSchema.parse(item);
          if (row.customer_id !== input.customerId || row.product.id !== input.productId)
            throw new PolarIdentityError('identity_conflict', 'checkout_customer');
          const discountId = intent === TEAM_CHECKOUT_WITHOUT_ASSIGNED_DISCOUNT ? null : intent;
          pending.push({
            id: row.id,
            url: row.url,
            status: row.status,
            seats:
              discountId && discountId !== row.discount_id ? null : fixedTeamCheckoutSeats(row),
            discountId,
          });
        }
        if (page >= result.pagination.max_page) return pending;
      }
    },

    async listPendingEnterpriseCheckouts(customerId) {
      if (!organizationId) throw new PolarIdentityError('configuration', 'checkout_organization');
      const pending: PendingEnterpriseCheckout[] = [];
      for (let page = 1; ; page++) {
        const query = new URLSearchParams({
          organization_id: organizationId,
          customer_id: customerId,
          limit: '100',
          page: String(page),
        });
        for (const status of ['open', 'confirmed', 'succeeded']) query.append('status', status);
        const response = await polarFetch(`/checkouts/?${query.toString()}`);
        if (!response.ok) throw new Error(`Polar checkout recovery failed: ${response.status}`);
        const result = z
          .object({
            items: z.array(z.object({ metadata: z.record(z.string(), z.unknown()) }).loose()),
            pagination: z.object({ max_page: z.number().int().nonnegative() }),
          })
          .parse(await response.json());
        for (const item of result.items) {
          if (!(ENTERPRISE_CHECKOUT_METADATA_KEY in item.metadata)) continue;
          const row = enterpriseCheckoutSchema.parse(item);
          if (row.customer_id !== customerId)
            throw new PolarIdentityError('identity_conflict', 'checkout_customer');
          pending.push({
            id: row.id,
            url: row.url,
            status: row.status,
            productId: row.product.id,
            amount: row.amount,
            currency: row.currency,
            discountId: row.discount_id,
            expiresAt: new Date(row.expires_at),
            quoteKey: row.metadata[ENTERPRISE_CHECKOUT_METADATA_KEY],
          });
        }
        if (page >= result.pagination.max_page) return pending;
      }
    },

    async listReconciledCheckoutIds(input) {
      if (!organizationId) throw new PolarIdentityError('configuration', 'checkout_organization');
      const remaining = new Set(input.checkoutIds);
      const reconciled: string[] = [];
      for (let page = 1; remaining.size > 0; page++) {
        const query = new URLSearchParams({
          organization_id: organizationId,
          customer_id: input.customerId,
          limit: '100',
          page: String(page),
        });
        const response = await polarFetch(`/subscriptions/?${query.toString()}`);
        if (!response.ok)
          throw new Error(`Polar checkout subscription read failed: ${response.status}`);
        const result = z
          .object({
            items: z.array(
              z.object({
                id: z.string(),
                customer_id: z.string(),
                checkout_id: z.string().nullish(),
                status: z.string(),
                ended_at: z.iso.datetime({ offset: true }).nullish(),
                ends_at: z.iso.datetime({ offset: true }).nullish(),
              }),
            ),
            pagination: z.object({ max_page: z.number().int().nonnegative() }),
          })
          .parse(await response.json());
        for (const subscription of result.items) {
          if (subscription.customer_id !== input.customerId)
            throw new PolarIdentityError('identity_conflict', 'checkout_subscription');
          const checkoutId = subscription.checkout_id;
          if (!checkoutId || !remaining.has(checkoutId)) continue;
          const end = subscription.ended_at ?? subscription.ends_at;
          const ended =
            subscription.status === 'revoked' ||
            (subscription.status === 'canceled' && end && Date.parse(end) <= Date.now());
          if (subscription.id === input.currentSubscriptionId || ended) {
            reconciled.push(checkoutId);
            remaining.delete(checkoutId);
          }
        }
        if (page >= result.pagination.max_page) break;
      }
      return reconciled;
    },

    async expireCheckout(checkoutId) {
      const path = `/checkouts/${encodeURIComponent(checkoutId)}`;
      const current = await polarFetch(path);
      if (current.status === 404) return 'expired';
      if (!current.ok) {
        throw new Error(`Polar checkout read failed: ${current.status}`);
      }
      const row = (await current.json()) as { status?: string };
      const status = (row.status ?? '').trim().toLowerCase();
      if (status === 'expired' || status === 'failed') return 'expired';
      if (status === 'succeeded' || status === 'confirmed') return 'already_paid';
      if (status !== 'open') {
        throw new Error(`Polar checkout status is ${status || 'unknown'}`);
      }
      return 'still_open';
    },

    async createCustomerPortalSession(input) {
      if (!input.customerId || !input.memberId)
        throw new PolarIdentityError('identity_conflict', 'portal_identity');
      const customer = await identity.customer(input.externalCustomerId, input.customerId);
      const members = await identity.members(input.customerId);
      if (
        customer?.type !== 'team' ||
        !members.some(
          (member) =>
            member.id === input.memberId && ['owner', 'billing_manager'].includes(member.role),
        )
      )
        throw new PolarIdentityError('forbidden', 'portal_member');
      const created = await polarFetch('/customer-sessions/', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: input.customerId,
          member_id: input.memberId,
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

    async cancelSubscriptionRenewal(subscriptionId: string, customerId: string) {
      if (!customerId) throw new PolarIdentityError('identity_conflict', 'subscription_customer');
      await identity.assertSubscription(customerId, subscriptionId);
      const response = await polarFetch(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ cancel_at_period_end: true }),
      });
      if (!response.ok) throw new Error(`Polar cancellation failed: ${response.status}`);
      const result = (await response.json()) as { cancel_at_period_end?: boolean; status?: string };
      if (!result.cancel_at_period_end && result.status !== 'canceled')
        throw new Error('Polar did not confirm cancellation');
    },

    async revokeSubscription(subscriptionId: string, customerId?: string) {
      if (!customerId) throw new PolarIdentityError('identity_conflict', 'subscription_customer');
      await identity.assertSubscription(customerId, subscriptionId);
      const res = await polarFetch(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        method: 'DELETE',
      });
      if (res.ok || res.status === 404) return;
      if (res.status === 403) {
        const body = await res.text();
        if (body.includes('AlreadyCanceled')) return;
      }
      throw new Error(`Polar subscription revoke failed: ${res.status}`);
    },

    async getTeamSeatSubscription(subscriptionId) {
      const response = await polarFetch(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
      if (!response.ok) throw new Error(`Polar seat read failed: ${response.status}`);
      return seatSubscriptionSchema.parse(await response.json());
    },
    async updateTeamSeatSubscription(input) {
      const response = await polarFetch(
        `/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ seats: input.seats, proration_behavior: input.proration }),
        },
      );
      if (!response.ok) throw new Error(`Polar seat update failed: ${response.status}`);
      return seatSubscriptionSchema.parse(await response.json());
    },

    async updateSubscription(input: UpdateSubscriptionInput) {
      if (!input.customerId)
        throw new PolarIdentityError('identity_conflict', 'subscription_customer');
      await identity.assertSubscription(input.customerId, input.subscriptionId);
      const updated = await polarFetch(`/subscriptions/${input.subscriptionId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          product_id: input.productId,
          proration_behavior: 'prorate',
          ...(input.discountId ? { discount_id: input.discountId } : {}),
        }),
      });
      if (updated.ok) {
        if (input.discountId) {
          const row = (await updated.json()) as { discount_id?: string };
          if (row.discount_id !== input.discountId) throw new PolarDiscountError('unavailable');
        }
        return { ok: true as const };
      }
      if (input.discountId) throw await discountWriteError(updated);
      // Polar needs a stored payment method change or the subscription is
      // locked/canceled — send the owner to the customer portal instead of
      // opening a second checkout that would stack subscriptions.
      if (updated.status === 402 || updated.status === 403 || updated.status === 409) {
        return { ok: false as const, code: 'portal_required' as const };
      }
      throw new Error(`Polar subscription update failed: ${updated.status}`);
    },

    async ingestUsage(event: PolarUsageEvent) {
      const customer = await identity.customer(event.externalCustomerId);
      if (customer?.type !== 'team')
        throw new PolarIdentityError('identity_conflict', 'usage_customer');
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

    async listPricedEventNames(productId: string) {
      const productRes = await polarFetch(`/products/${encodeURIComponent(productId)}`);
      if (!productRes.ok) return null;
      const product = (await productRes.json()) as {
        prices?: { meter_id?: string | null; is_archived?: boolean }[];
      };
      const pricedMeterIds = new Set(
        (product.prices ?? []).flatMap((price) =>
          price.meter_id && price.is_archived !== true ? [price.meter_id] : [],
        ),
      );
      if (pricedMeterIds.size === 0) return [];
      const metersRes = await polarFetch('/meters/?limit=100');
      if (!metersRes.ok) return null;
      const meters = (await metersRes.json()) as {
        items?: { id?: string; filter?: { clauses?: { value?: string }[] } }[];
      };
      const wanted = new Set<string>(TIMELINE_METERED_EVENT_NAMES);
      const events: string[] = [];
      for (const meter of meters.items ?? []) {
        if (!meter.id || !pricedMeterIds.has(meter.id)) continue;
        const value = meter.filter?.clauses?.[0]?.value;
        if (!value || !wanted.has(value) || events.includes(value)) continue;
        events.push(value);
      }
      return events;
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

const SELF_SERVE_CHECKOUT_PLANS = ['team'] as const;

export type SelfServeCheckoutPlan = (typeof SELF_SERVE_CHECKOUT_PLANS)[number];

/** Runtime allowlist for owner/admin checkout. Enterprise stays on the operator path. */
export function selfServeCheckoutPlan(plan: string): SelfServeCheckoutPlan | undefined {
  for (const candidate of SELF_SERVE_CHECKOUT_PLANS) {
    if (plan === candidate) return candidate;
  }
  return undefined;
}

export function polarProductIdForPlan(plan: string): string | undefined {
  const selfServe = selfServeCheckoutPlan(plan);
  if (!selfServe) return undefined;
  return getEnv().POLAR_PRODUCT_ID_TEAM;
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
 * Enterprise checkout is operator-only — never open a self-serve checkout.
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
  customerId?: string;
  memberId?: string;
  successUrl: string;
  portalReturnUrl: string;
  discountId?: string;
  seats?: number;
}): Promise<{ url: string; id?: string }> {
  if (input.account.planId === 'enterprise') {
    throw new Error(
      'Enterprise checkout is opened by a platform operator. Plan changes are not self-serve.',
    );
  }
  const subscriptionId = polarSubscriptionIdForPlanChange(input.account);
  if (subscriptionId && input.seats !== undefined) {
    if (input.account.planId !== 'team')
      throw new Error(
        'An existing legacy subscription must be retired before moving to Team seat pricing.',
      );
    return {
      url: (
        await input.provider.createCustomerPortalSession({
          externalCustomerId: input.externalCustomerId,
          ...(input.customerId ? { customerId: input.customerId } : {}),
          ...(input.memberId ? { memberId: input.memberId } : {}),
          returnUrl: input.portalReturnUrl,
        })
      ).url,
    };
  }
  if (subscriptionId) {
    try {
      const updated = await input.provider.updateSubscription({
        subscriptionId,
        ...(input.customerId ? { customerId: input.customerId } : {}),
        productId: input.productId,
        ...(input.discountId ? { discountId: input.discountId } : {}),
      });
      if (updated.ok) return { url: input.successUrl };
    } catch (error) {
      if (error instanceof PolarIdentityError) throw error;
      if (input.discountId) {
        if (error instanceof PolarDiscountError) throw error;
        throw new PolarDiscountError('unavailable');
      }
      // Polar could not change the product in place.
    }
    if (input.discountId) throw new PolarDiscountError('unavailable');
    const portal = await input.provider.createCustomerPortalSession({
      externalCustomerId: input.externalCustomerId,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.memberId ? { memberId: input.memberId } : {}),
      returnUrl: input.portalReturnUrl,
    });
    return { url: portal.url };
  }
  return input.provider.createCheckoutSession({
    externalCustomerId: input.externalCustomerId,
    ...(input.customerId ? { customerId: input.customerId } : {}),
    customerEmail: input.customerEmail,
    productId: input.productId,
    successUrl: input.successUrl,
    ...(input.seats !== undefined ? { seats: input.seats } : {}),
    ...(input.discountId ? { discountId: input.discountId } : {}),
  });
}
