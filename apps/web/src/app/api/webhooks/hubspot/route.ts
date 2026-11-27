import { getEnv } from '@timeline/shared/env';
import {
  hubspotWebhookBatches,
  verifyHubSpotSignature,
  recordHubspotWakeup,
} from '@timeline/shared/integrations';

import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';
import {
  readCappedTextBody,
  payloadTooLargeResponse,
  REQUEST_BODY_LIMITS,
} from '@/lib/request-body';
import { appUrl } from '@/lib/site-url';

export async function POST(req: Request) {
  const body = await readCappedTextBody(req, REQUEST_BODY_LIMITS.integrationWebhook);
  if (body.tooLarge) return payloadTooLargeResponse();
  const secret = getEnv().HUBSPOT_CLIENT_SECRET;
  if (
    !secret ||
    !verifyHubSpotSignature(
      secret,
      appUrl('/api/webhooks/hubspot').toString(),
      body.text,
      req.headers,
    )
  )
    return Response.json({ error: 'invalid_signature' }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(body.text);
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const batches = hubspotWebhookBatches(payload);
  if (!batches) return Response.json({ error: 'invalid_batch' }, { status: 400 });
  const enqueuePortal = async ({ portal, key }: { portal: string; key: string }) => {
    const recorded = await recordHubspotWakeup(db, portal, key);
    if (recorded.deliveryId)
      await (
        await requireRedisQueue()
      ).enqueueWebhookDeliveryJob({ deliveryId: recorded.deliveryId });
  };
  for (let i = 0; i < batches.length; i += 8)
    await Promise.all(batches.slice(i, i + 8).map(enqueuePortal));
  return Response.json({ ok: true });
}
