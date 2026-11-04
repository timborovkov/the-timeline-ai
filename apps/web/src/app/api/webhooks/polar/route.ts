import {
  createPolarBillingProvider,
  handlePolarWebhookEvent,
  isIgnorablePolarWebhookFailure,
  verifyPolarWebhookSignature,
} from '@timeline/shared/billing';
import { getEnv } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';

import { db } from '@/lib/db';
import {
  payloadTooLargeResponse,
  readCappedTextBody,
  REQUEST_BODY_LIMITS,
} from '@/lib/request-body';

export const runtime = 'nodejs';

const log = childLogger('web:api:polar-webhook');

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  const secret = env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const bodyResult = await readCappedTextBody(req, REQUEST_BODY_LIMITS.integrationWebhook);
  if (bodyResult.tooLarge) return payloadTooLargeResponse();
  const body = bodyResult.text;
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

  const provider = createPolarBillingProvider();
  if (!provider) return Response.json({ error: 'provider_not_configured' }, { status: 503 });
  try {
    const result = await handlePolarWebhookEvent({
      db,
      payload: payload as Parameters<typeof handlePolarWebhookEvent>[0]['payload'],
      chargesEnabled: env.BILLING_CHARGES_ENABLED,
      products: {
        ...(env.POLAR_PRODUCT_ID_PAYG ? { payg: env.POLAR_PRODUCT_ID_PAYG } : {}),
        ...(env.POLAR_PRODUCT_ID_TEAM ? { team: env.POLAR_PRODUCT_ID_TEAM } : {}),
        ...(env.POLAR_PRODUCT_ID_BUSINESS ? { business: env.POLAR_PRODUCT_ID_BUSINESS } : {}),
        ...(env.POLAR_PRODUCT_ID_ENTERPRISE ? { enterprise: env.POLAR_PRODUCT_ID_ENTERPRISE } : {}),
      },
      provider,
    });
    return Response.json(result);
  } catch (err) {
    if (isIgnorablePolarWebhookFailure(err)) {
      log.warn({ err }, 'polar webhook acknowledged invalid team identifier');
      return Response.json({ ok: true, ignored: 'invalid_external_customer' });
    }
    throw err;
  }
}
