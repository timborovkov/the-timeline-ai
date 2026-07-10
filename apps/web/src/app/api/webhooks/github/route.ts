import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

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

function repoFromPayload(payload: unknown): string | null {
  return stringValue(recordValue(recordValue(payload)?.repository)?.full_name);
}

function ownerFromRepo(repo: string | null): string | null {
  return repo?.split('/')[0] ?? null;
}

function actionFromPayload(payload: unknown): string | null {
  return stringValue(recordValue(payload)?.action);
}

function githubDeliveryDedupKey(body: string, deliveryId: string | null): string {
  if (deliveryId) return `github:delivery:${deliveryId}`;
  return `github:body:${createHash('sha256').update(body).digest('hex')}`;
}

function verifyGithubSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
  const actualBytes = Buffer.from(signature, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

async function loadGithubTargets(
  repo: string | null,
): Promise<(typeof integrationsTable.$inferSelect)[]> {
  if (!repo) return [];
  const owner = ownerFromRepo(repo);
  const externalIds = owner ? [repo, owner] : [repo];
  const selectionRows = await db
    .select({ integrationId: integrationSelections.integrationId })
    .from(integrationSelections)
    .where(
      and(
        inArray(integrationSelections.selectionKind, ['github.repo', 'github.org']),
        inArray(integrationSelections.externalId, externalIds),
      ),
    );
  const integrationIds = [...new Set(selectionRows.map((row) => row.integrationId))];
  if (integrationIds.length === 0) return [];
  return db
    .select()
    .from(integrationsTable)
    .where(
      and(
        eq(integrationsTable.provider, 'github'),
        eq(integrationsTable.enabled, true),
        inArray(integrationsTable.id, integrationIds),
      ),
    );
}

export async function POST(req: Request): Promise<Response> {
  const clientIp = email.clientIpFromHeaders(req.headers);
  if (clientIp) {
    const rl = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('integration', 'github_ip', clientIp),
      ...rateLimit.RATE_LIMITS.integrationWebhook,
    });
    if (!rl.ok) {
      return NextResponse.json({ ok: true, reason: 'rate_limited' }, { status: 200 });
    }
  }

  const bodyResult = await readCappedTextBody(req, REQUEST_BODY_LIMITS.integrationWebhook);
  if (bodyResult.tooLarge) return payloadTooLargeResponse();
  const body = bodyResult.text;
  const secret = getEnv().GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    reportHandledEvent({
      message: 'github_webhook_secret_unconfigured',
      surface: 'api',
      operation: 'github_webhook_auth',
      level: 'warning',
      tags: { provider: 'github', reason: 'webhook_secret_unconfigured' },
    });
    return NextResponse.json({ ok: false, reason: 'webhook_secret_unconfigured' }, { status: 200 });
  }
  const signature = req.headers.get('x-hub-signature-256');
  if (!verifyGithubSignature(body, signature, secret)) {
    reportHandledEvent({
      message: 'github_webhook_bad_signature',
      surface: 'api',
      operation: 'github_webhook_auth',
      level: 'warning',
      tags: { provider: 'github', reason: 'bad_signature', has_signature: Boolean(signature) },
    });
    return NextResponse.json({ ok: false, reason: 'bad_signature' }, { status: 200 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 200 });
  }

  const eventType = req.headers.get('x-github-event') ?? 'unknown';
  const deliveryId = req.headers.get('x-github-delivery');
  const hookId = req.headers.get('x-github-hook-id');
  const repo = repoFromPayload(payload);
  const targets = await loadGithubTargets(repo);

  let deliveryRowId: string;
  try {
    const recorded = await integrationsLib.recordWebhookDeliveryTargets(db, {
      provider: 'github',
      externalDeliveryId: deliveryId,
      externalAccountId: ownerFromRepo(repo) ?? null,
      resourceKind: repo ? 'github.repo' : null,
      externalResourceId: repo,
      eventType,
      action: actionFromPayload(payload),
      headers: {
        has_signature: Boolean(signature),
        x_github_delivery: deliveryId,
        x_github_event: eventType,
        x_github_hook_id: hookId,
      },
      payload,
      dedupKey: githubDeliveryDedupKey(body, deliveryId),
      targets: targets.map((integration) => ({
        teamId: integration.teamId,
        integrationId: integration.id,
        providerConnectionId: integration.providerConnectionId,
      })),
    });
    deliveryRowId = recorded.deliveryId;
  } catch (err) {
    reportCaughtError(err, {
      surface: 'background',
      operation: 'github_webhook_record_delivery',
      tags: { provider: 'github' },
    });
    return NextResponse.json({ ok: false, reason: 'delivery_persist_failed' }, { status: 503 });
  }

  try {
    const queue = await requireRedisQueue();
    await queue.enqueueWebhookDeliveryJob({ deliveryId: deliveryRowId });
  } catch (err) {
    reportCaughtError(err, {
      surface: 'background',
      operation: 'github_webhook_enqueue_delivery',
      tags: { provider: 'github' },
    });
    return NextResponse.json({ ok: true, reason: 'enqueue_failed' }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
