import { handlePolarWebhookEvent, verifyPolarWebhookSignature } from '@timeline/shared/billing';
import { getEnv } from '@timeline/shared/env';

import { db } from '@/lib/db';

export const runtime = 'nodejs';

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

  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const result = await handlePolarWebhookEvent({
    db,
    payload: payload as Parameters<typeof handlePolarWebhookEvent>[0]['payload'],
    chargesEnabled: env.BILLING_CHARGES_ENABLED,
    products: {
      ...(env.POLAR_PRODUCT_ID_PAYG ? { payg: env.POLAR_PRODUCT_ID_PAYG } : {}),
      ...(env.POLAR_PRODUCT_ID_TEAM ? { team: env.POLAR_PRODUCT_ID_TEAM } : {}),
      ...(env.POLAR_PRODUCT_ID_BUSINESS ? { business: env.POLAR_PRODUCT_ID_BUSINESS } : {}),
      ...(env.POLAR_PRODUCT_ID_TOPUP ? { topup: env.POLAR_PRODUCT_ID_TOPUP } : {}),
    },
  });
  return Response.json(result);
}
