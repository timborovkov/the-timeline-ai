import {
  createPolarBillingProvider,
  handlePolarWebhookEvent,
  isIgnorablePolarWebhookFailure,
  resolvePolarWebhookTeamId,
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
import { reportHandledEvent } from '@/lib/sentry-report';

export const runtime = 'nodejs';

const log = childLogger('web:api:polar-webhook');

function acknowledgeIgnoredPolarWebhook(ignored: string): Response {
  log.warn({ ignored }, 'polar webhook acknowledged');
  reportHandledEvent({
    message: 'polar_webhook_ignored',
    surface: 'api',
    operation: 'polar_webhook',
    level: 'warning',
    tags: { reason: ignored },
  });
  return Response.json({ ok: true, ignored });
}

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

  const resolvedTeam = resolvePolarWebhookTeamId(payload);
  if ('ignored' in resolvedTeam && resolvedTeam.ignored === 'invalid_external_customer') {
    return acknowledgeIgnoredPolarWebhook(resolvedTeam.ignored);
  }

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
    if (result.ignored === 'invalid_external_customer' || result.ignored === 'unknown_team') {
      return acknowledgeIgnoredPolarWebhook(result.ignored);
    }
    return Response.json(result);
  } catch (err) {
    if (isIgnorablePolarWebhookFailure(err)) {
      return acknowledgeIgnoredPolarWebhook('invalid_external_customer');
    }
    throw err;
  }
}
