import { teamBillingAccounts } from '@timeline/db';
import { verifyPolarWebhookSignature } from '@timeline/shared/billing';
import { getEnv } from '@timeline/shared/env';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';

export const runtime = 'nodejs';

interface PolarWebhookPayload {
  type?: string;
  data?: {
    id?: string;
    status?: string;
    product_id?: string;
    customer?: { external_id?: string; id?: string };
    customer_id?: string;
    external_customer_id?: string;
  };
}

function planFromProductId(productId: string | undefined): 'payg' | 'team' | 'business' | null {
  const env = getEnv();
  if (!productId) return null;
  if (productId === env.POLAR_PRODUCT_ID_PAYG) return 'payg';
  if (productId === env.POLAR_PRODUCT_ID_TEAM) return 'team';
  if (productId === env.POLAR_PRODUCT_ID_BUSINESS) return 'business';
  return null;
}

function billingStateForPlan(plan: 'payg' | 'team' | 'business') {
  switch (plan) {
    case 'payg':
      return 'payg_active' as const;
    case 'team':
      return 'team_active' as const;
    case 'business':
      return 'business_active' as const;
  }
}

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  const secret = env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const body = await req.text();
  const ok = verifyPolarWebhookSignature({
    body,
    headers: req.headers,
    secret,
  });
  if (!ok) {
    return Response.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: PolarWebhookPayload;
  try {
    payload = JSON.parse(body) as PolarWebhookPayload;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const teamId = payload.data?.customer?.external_id ?? payload.data?.external_customer_id ?? null;
  if (!teamId) {
    return Response.json({ ok: true, ignored: 'missing_external_customer' });
  }

  const type = payload.type ?? '';
  if (
    type === 'subscription.created' ||
    type === 'subscription.active' ||
    type === 'subscription.updated' ||
    type === 'order.paid'
  ) {
    const plan = planFromProductId(payload.data?.product_id);
    if (plan) {
      const catalog = getEnv();
      const included = plan === 'team' ? 6_000 : plan === 'business' ? 25_000 : 0;
      await db
        .insert(teamBillingAccounts)
        .values({
          teamId,
          planId: plan,
          billingState: billingStateForPlan(plan),
          polarCustomerId: payload.data?.customer?.id ?? payload.data?.customer_id ?? null,
          polarSubscriptionId: payload.data?.id ?? null,
          polarProductId: payload.data?.product_id ?? null,
          spendCapCents: plan === 'payg' ? 2_500 : plan === 'team' ? 10_000 : 50_000,
          includedDiscountRemainingCents: included,
          shadowBilling: !catalog.BILLING_CHARGES_ENABLED,
        })
        .onConflictDoUpdate({
          target: [teamBillingAccounts.teamId],
          set: {
            planId: plan,
            billingState: billingStateForPlan(plan),
            polarCustomerId: payload.data?.customer?.id ?? payload.data?.customer_id ?? null,
            polarSubscriptionId: payload.data?.id ?? null,
            polarProductId: payload.data?.product_id ?? null,
            includedDiscountRemainingCents: included,
            updatedAt: new Date(),
          },
        });
    }
  }

  if (type === 'subscription.canceled' || type === 'subscription.revoked') {
    await db
      .update(teamBillingAccounts)
      .set({
        billingState: 'canceled',
        planId: 'free',
        updatedAt: new Date(),
      })
      .where(eq(teamBillingAccounts.teamId, teamId));
  }

  return Response.json({ ok: true });
}
