import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

export function verifyHubSpotSignature(
  secret: string,
  url: string,
  body: string,
  headers: Headers,
  now = Date.now(),
) {
  if (!secret) return false;
  const signature = headers.get('x-hubspot-signature-v3');
  if (signature) {
    const timestamp = headers.get('x-hubspot-request-timestamp');
    if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300_000)
      return false;
    const expected = createHmac('sha256', secret)
      .update('POST' + url + body + timestamp)
      .digest();
    const actual = Buffer.from(signature, 'base64');
    return actual.length === expected.length && timingSafeEqual(expected, actual);
  }
  if (headers.get('x-hubspot-signature-version') !== 'v1') return false;
  const legacy = headers.get('x-hubspot-signature');
  if (!legacy || !/^[a-f\d]{64}$/i.test(legacy)) return false;
  return timingSafeEqual(
    createHash('sha256')
      .update(secret + body)
      .digest(),
    Buffer.from(legacy, 'hex'),
  );
}

// Retain only portal and event identity. Payload values may describe an unselected pipeline.
const notification = z.object({
  portalId: z.number().int().positive(),
  objectId: z.number().int().positive().optional(),
  objectTypeId: z.string().optional(),
  fromObjectTypeId: z.string().optional(),
  toObjectTypeId: z.string().optional(),
  fromObjectId: z.number().int().optional(),
  toObjectId: z.number().int().optional(),
  occurredAt: z.number().int().positive(),
  subscriptionType: z.string(),
  eventId: z.number().int(),
  propertyName: z.string().optional(),
});
export function hubspotWebhookBatches(payload: unknown) {
  const parsed = z.array(notification).max(1000).safeParse(payload);
  if (!parsed.success) return null;
  const portals = new Map<string, Set<string>>();
  for (const row of parsed.data) {
    const supported =
      row.subscriptionType.startsWith('deal.') ||
      row.subscriptionType.startsWith('company.') ||
      (row.subscriptionType.startsWith('object.') &&
        [row.objectTypeId, row.fromObjectTypeId, row.toObjectTypeId].some(
          (type) => type === '0-2' || type === '0-3',
        ));
    if (!supported) continue;
    const portal = String(row.portalId);
    const keys = portals.get(portal) ?? new Set<string>();
    keys.add(
      JSON.stringify([
        row.objectId,
        row.objectTypeId,
        row.fromObjectId,
        row.toObjectId,
        row.eventId,
        row.occurredAt,
        row.subscriptionType,
        row.propertyName,
      ]),
    );
    portals.set(portal, keys);
  }
  return [...portals].map(([portal, keys]) => ({
    portal,
    key: createHash('sha256')
      .update(JSON.stringify([...keys].sort()))
      .digest('hex'),
  }));
}
