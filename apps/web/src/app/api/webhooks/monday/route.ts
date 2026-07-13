import { createHash, timingSafeEqual } from 'node:crypto';

import { integrationSelections, integrations as integrationsTable } from '@timeline/db';
import * as email from '@timeline/shared/email';
import { getEnv } from '@timeline/shared/env';
import * as integrationsLib from '@timeline/shared/integrations';
import * as rateLimit from '@timeline/shared/rate-limit';
import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';
import {
  payloadTooLargeResponse,
  readCappedTextBody,
  REQUEST_BODY_LIMITS,
} from '@/lib/request-body';
import { reportCaughtError, reportHandledEvent } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function idValue(value: unknown): string | null {
  return stringValue(value) ?? (numberValue(value) !== null ? String(numberValue(value)) : null);
}

function eventRecord(payload: unknown): Record<string, unknown> | null {
  return recordValue(recordValue(payload)?.event);
}

function challengeValue(payload: unknown): string | null {
  return stringValue(recordValue(payload)?.challenge);
}

function boardIdFromPayload(payload: unknown): string | null {
  const event = eventRecord(payload);
  if (!event) return null;
  return idValue(event.parentItemBoardId) ?? idValue(event.boardId);
}

function eventTypeFromPayload(payload: unknown): string {
  return stringValue(eventRecord(payload)?.type) ?? 'unknown';
}

function actionFromPayload(payload: unknown): string | null {
  return stringValue(eventRecord(payload)?.type);
}

function subscriptionIdFromPayload(payload: unknown): string | null {
  const event = eventRecord(payload);
  return idValue(event?.subscriptionId);
}

function triggerUuidFromPayload(payload: unknown): string | null {
  const event = eventRecord(payload);
  return stringValue(event?.triggerUuid) ?? null;
}

function mondayDeliveryDedupKey(body: string, payload: unknown): string {
  const triggerUuid = triggerUuidFromPayload(payload);
  if (triggerUuid) return `monday:delivery:${triggerUuid}`;
  const event = eventRecord(payload);
  const boardId = boardIdFromPayload(payload) ?? 'unknown';
  const subscriptionId = subscriptionIdFromPayload(payload) ?? 'unknown';
  const itemId = idValue(event?.pulseId) ?? idValue(event?.itemId) ?? idValue(event?.parentItemId);
  const triggerTime = stringValue(event?.triggerTime);
  if (itemId || triggerTime) {
    return `monday:delivery:${boardId}:${subscriptionId}:${itemId ?? 'unknown'}:${eventTypeFromPayload(payload)}:${triggerTime ?? 'unknown'}`;
  }
  return `monday:body:${createHash('sha256').update(body).digest('hex')}`;
}

function tokenFromRequest(req: Request): string | null {
  const url = new URL(req.url);
  return (
    url.searchParams.get('token') ??
    url.searchParams.get('secret') ??
    req.headers.get('x-timeline-webhook-token')
  );
}

function verifyToken(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

async function loadMondayTargets(
  boardId: string | null,
): Promise<(typeof integrationsTable.$inferSelect)[]> {
  if (!boardId) return [];
  const selectionRows = await db
    .select({ integrationId: integrationSelections.integrationId })
    .from(integrationSelections)
    .where(
      and(
        eq(integrationSelections.selectionKind, 'monday.board'),
        eq(integrationSelections.externalId, boardId),
      ),
    );
  const integrationIds = [...new Set(selectionRows.map((row) => row.integrationId))];
  if (integrationIds.length === 0) return [];
  return db
    .select()
    .from(integrationsTable)
    .where(
      and(
        eq(integrationsTable.provider, 'monday'),
        eq(integrationsTable.enabled, true),
        inArray(integrationsTable.id, integrationIds),
      ),
    );
}

export async function POST(req: Request): Promise<Response> {
  const clientIp = email.clientIpFromHeaders(req.headers);
  if (clientIp) {
    const rl = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('integration', 'monday_ip', clientIp),
      ...rateLimit.RATE_LIMITS.integrationWebhook,
    });
    if (!rl.ok) {
      return NextResponse.json({ ok: true, reason: 'rate_limited' }, { status: 200 });
    }
  }

  const bodyResult = await readCappedTextBody(req, REQUEST_BODY_LIMITS.integrationWebhook);
  if (bodyResult.tooLarge) return payloadTooLargeResponse();
  const body = bodyResult.text;
  const secret = getEnv().MONDAY_WEBHOOK_SECRET;
  if (!secret) {
    reportHandledEvent({
      message: 'monday_webhook_secret_unconfigured',
      surface: 'api',
      operation: 'monday_webhook_auth',
      level: 'warning',
      tags: { provider: 'monday', reason: 'webhook_secret_unconfigured' },
    });
    return NextResponse.json({ ok: false, reason: 'webhook_secret_unconfigured' }, { status: 200 });
  }
  if (!verifyToken(tokenFromRequest(req), secret)) {
    reportHandledEvent({
      message: 'monday_webhook_bad_token',
      surface: 'api',
      operation: 'monday_webhook_auth',
      level: 'warning',
      tags: { provider: 'monday', reason: 'bad_token' },
    });
    return NextResponse.json({ ok: false, reason: 'bad_token' }, { status: 200 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 200 });
  }

  const challenge = challengeValue(payload);
  if (challenge) return NextResponse.json({ challenge });

  const boardId = boardIdFromPayload(payload);
  const targets = await loadMondayTargets(boardId);

  let deliveryId: string;
  try {
    const recorded = await integrationsLib.recordWebhookDeliveryTargets(db, {
      provider: 'monday',
      externalDeliveryId: triggerUuidFromPayload(payload),
      externalAccountId: null,
      resourceKind: boardId ? 'monday.board' : null,
      externalResourceId: boardId,
      eventType: eventTypeFromPayload(payload),
      action: actionFromPayload(payload),
      headers: {
        has_token: true,
        monday_subscription_id: subscriptionIdFromPayload(payload),
      },
      payload,
      dedupKey: mondayDeliveryDedupKey(body, payload),
      targets: targets.map((integration) => ({
        teamId: integration.teamId,
        integrationId: integration.id,
        providerConnectionId: integration.providerConnectionId,
      })),
    });
    deliveryId = recorded.deliveryId;
  } catch (err) {
    reportCaughtError(err, {
      surface: 'background',
      operation: 'monday_webhook_record_delivery',
      tags: { provider: 'monday' },
    });
    return NextResponse.json({ ok: false, reason: 'delivery_persist_failed' }, { status: 503 });
  }

  try {
    const queue = await requireRedisQueue();
    await queue.enqueueWebhookDeliveryJob({ deliveryId });
  } catch (err) {
    reportCaughtError(err, {
      surface: 'background',
      operation: 'monday_webhook_enqueue_delivery',
      tags: { provider: 'monday' },
    });
    return NextResponse.json({ ok: true, reason: 'enqueue_failed' }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
