import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import {
  integrationSelections,
  integrations as integrationsTable,
  integrationWebhookSubscriptions,
} from '@timeline/db';
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

type SentryIntegrationRow = typeof integrationsTable.$inferSelect;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function nestedRecord(
  record: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  return recordValue(record?.[key]);
}

function firstString(values: unknown[]): string | null {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return null;
}

function firstStringFromArray(value: unknown): string | null {
  return Array.isArray(value) ? firstString(value) : null;
}

function firstProjectSlugFromArray(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const itemRecord = recordValue(item);
    const slug = itemRecord ? (stringValue(itemRecord.slug) ?? stringValue(itemRecord.name)) : null;
    if (slug) return slug;
    const text = stringValue(item);
    if (text) return text;
  }
  return null;
}

function orgSlugFromUrl(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    const pathMatch = /\/organizations\/([^/]+)\//.exec(url.pathname);
    if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
    if (url.hostname.endsWith('.sentry.io')) {
      const [subdomain] = url.hostname.split('.');
      if (subdomain && subdomain !== 'sentry') return subdomain;
    }
  } catch {
    return null;
  }
  return null;
}

function projectSlugFromUrl(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    const pathMatch = /\/projects\/[^/]+\/([^/]+)\//.exec(url.pathname);
    if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  } catch {
    return null;
  }
  return null;
}

function extractSentryRouting(payload: unknown): {
  installationUuid: string | null;
  orgSlug: string | null;
  projectSlug: string | null;
} {
  const root = recordValue(payload);
  const data = nestedRecord(root, 'data');
  const event = nestedRecord(data, 'event');
  const issue = nestedRecord(data, 'issue');
  const issueProject = nestedRecord(issue, 'project');
  const release = nestedRecord(data, 'release');
  const releaseProject = nestedRecord(release, 'project');
  const metricAlert = nestedRecord(data, 'metric_alert');
  const installation = nestedRecord(root, 'installation') ?? nestedRecord(data, 'installation');
  const installationOrg = nestedRecord(installation, 'organization');
  const organization = nestedRecord(root, 'organization') ?? nestedRecord(data, 'organization');
  const project = nestedRecord(root, 'project') ?? nestedRecord(data, 'project');
  return {
    installationUuid: stringValue(installation?.uuid),
    orgSlug: firstString([
      installationOrg?.slug,
      organization?.slug,
      orgSlugFromUrl(data?.web_url),
      orgSlugFromUrl(event?.web_url),
      orgSlugFromUrl(event?.issue_url),
      orgSlugFromUrl(issue?.permalink),
      orgSlugFromUrl(issue?.web_url),
      orgSlugFromUrl(issue?.url),
      orgSlugFromUrl(release?.url),
    ]),
    projectSlug: firstString([
      project?.slug,
      event?.project_slug,
      typeof event?.project === 'string' ? event.project : null,
      issueProject?.slug,
      projectSlugFromUrl(issue?.permalink),
      projectSlugFromUrl(issue?.web_url),
      releaseProject?.slug,
      releaseProject?.name,
      firstProjectSlugFromArray(release?.projects),
      firstStringFromArray(metricAlert?.projects),
    ]),
  };
}

function accountIncludesOrg(externalAccountId: string | null, orgSlug: string): boolean {
  return (externalAccountId ?? '')
    .split(',')
    .map((part) => part.trim())
    .includes(orgSlug);
}

function verifySentrySignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  const actualBytes = Buffer.from(signature, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function sentryDeliveryDedupKey(body: string, externalDeliveryId: string | null): string {
  if (externalDeliveryId) return `sentry:delivery:${externalDeliveryId}`;
  return `sentry:body:${createHash('sha256').update(body).digest('hex')}`;
}

async function loadTargetsByInstallation(
  installationUuid: string,
): Promise<SentryIntegrationRow[]> {
  const rows = await db
    .select({ integration: integrationsTable })
    .from(integrationWebhookSubscriptions)
    .innerJoin(
      integrationsTable,
      eq(integrationWebhookSubscriptions.integrationId, integrationsTable.id),
    )
    .where(
      and(
        eq(integrationWebhookSubscriptions.provider, 'sentry'),
        eq(integrationWebhookSubscriptions.resourceKind, 'sentry.installation'),
        eq(integrationWebhookSubscriptions.externalSubscriptionId, installationUuid),
        eq(integrationWebhookSubscriptions.status, 'active'),
        eq(integrationsTable.provider, 'sentry'),
        eq(integrationsTable.enabled, true),
      ),
    );
  return rows.map((row) => row.integration);
}

async function loadTargetsByOrgSelection(
  orgSlug: string,
  projectSlug: string | null,
): Promise<SentryIntegrationRow[]> {
  const integrationRows = await db
    .select()
    .from(integrationsTable)
    .where(and(eq(integrationsTable.provider, 'sentry'), eq(integrationsTable.enabled, true)));
  const accountRows = integrationRows.filter((row) =>
    accountIncludesOrg(row.externalAccountId, orgSlug),
  );
  if (accountRows.length === 0) return [];
  const selectionRows = await db
    .select({
      integrationId: integrationSelections.integrationId,
      selectionKind: integrationSelections.selectionKind,
      externalId: integrationSelections.externalId,
    })
    .from(integrationSelections)
    .where(
      and(
        inArray(
          integrationSelections.integrationId,
          accountRows.map((row) => row.id),
        ),
        inArray(integrationSelections.selectionKind, ['sentry.org', 'sentry.project']),
      ),
    );
  const selectionsByIntegration = new Map<string, { kind: string; externalId: string }[]>();
  for (const selection of selectionRows) {
    const existing = selectionsByIntegration.get(selection.integrationId) ?? [];
    existing.push({ kind: selection.selectionKind, externalId: selection.externalId });
    selectionsByIntegration.set(selection.integrationId, existing);
  }
  const projectExternalId = projectSlug ? `${orgSlug}/${projectSlug}` : null;
  return accountRows.filter((row) => {
    const selections = selectionsByIntegration.get(row.id) ?? [];
    return selections.some((selection) => {
      if (selection.kind === 'sentry.org') return selection.externalId === orgSlug;
      return projectExternalId !== null && selection.externalId === projectExternalId;
    });
  });
}

function uniqueTargets(rows: SentryIntegrationRow[]): SentryIntegrationRow[] {
  const byId = new Map<string, SentryIntegrationRow>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}

async function rememberSentryInstallation(
  installationUuid: string | null,
  orgSlug: string | null,
  targets: SentryIntegrationRow[],
): Promise<void> {
  if (!installationUuid || !orgSlug || targets.length === 0) return;
  await db
    .insert(integrationWebhookSubscriptions)
    .values(
      targets.map((target) => ({
        integrationId: target.id,
        providerConnectionId: target.providerConnectionId,
        provider: 'sentry' as const,
        externalSubscriptionId: installationUuid,
        resourceKind: 'sentry.installation',
        externalResourceId: orgSlug,
        eventType: 'installation',
        status: 'active',
        lastVerifiedAt: new Date(),
        updatedAt: new Date(),
      })),
    )
    .onConflictDoNothing();
}

export async function POST(req: Request): Promise<Response> {
  const clientIp = email.clientIpFromHeaders(req.headers);
  if (clientIp) {
    const rl = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('integration', 'sentry_ip', clientIp),
      ...rateLimit.RATE_LIMITS.integrationWebhook,
    });
    if (!rl.ok) {
      return NextResponse.json({ ok: true, reason: 'rate_limited' }, { status: 200 });
    }
  }

  const bodyResult = await readCappedTextBody(req, REQUEST_BODY_LIMITS.integrationWebhook);
  if (bodyResult.tooLarge) return payloadTooLargeResponse();
  const body = bodyResult.text;
  const env = getEnv();
  const secret = env.SENTRY_INTEGRATION_CLIENT_SECRET;
  if (!secret) {
    reportHandledEvent({
      message: 'sentry_webhook_secret_unconfigured',
      surface: 'api',
      operation: 'sentry_webhook_auth',
      level: 'warning',
      tags: { provider: 'sentry', reason: 'webhook_secret_unconfigured' },
    });
    return NextResponse.json({ ok: false, reason: 'webhook_secret_unconfigured' }, { status: 200 });
  }

  const signature = req.headers.get('sentry-hook-signature');
  if (!verifySentrySignature(body, signature, secret)) {
    reportHandledEvent({
      message: 'sentry_webhook_bad_signature',
      surface: 'api',
      operation: 'sentry_webhook_auth',
      level: 'warning',
      tags: { provider: 'sentry', reason: 'bad_signature', has_signature: Boolean(signature) },
    });
    return NextResponse.json({ ok: false, reason: 'bad_signature' }, { status: 200 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 200 });
  }

  const action = stringValue(recordValue(payload)?.action);
  const resource = req.headers.get('sentry-hook-resource') ?? 'unknown';
  const externalDeliveryId = req.headers.get('request-id');
  const timestamp = req.headers.get('sentry-hook-timestamp');
  const routing = extractSentryRouting(payload);
  const targets = uniqueTargets([
    ...(routing.installationUuid ? await loadTargetsByInstallation(routing.installationUuid) : []),
    ...(routing.orgSlug
      ? await loadTargetsByOrgSelection(routing.orgSlug, routing.projectSlug)
      : []),
  ]);

  try {
    await rememberSentryInstallation(routing.installationUuid, routing.orgSlug, targets);
  } catch (err) {
    reportCaughtError(err, {
      surface: 'background',
      operation: 'sentry_webhook_record_subscription',
      tags: { provider: 'sentry' },
    });
  }

  const resourceKind =
    routing.orgSlug && routing.projectSlug
      ? 'sentry.project'
      : routing.orgSlug
        ? 'sentry.org'
        : routing.installationUuid
          ? 'sentry.installation'
          : null;
  const externalResourceId =
    routing.orgSlug && routing.projectSlug
      ? `${routing.orgSlug}/${routing.projectSlug}`
      : (routing.orgSlug ?? routing.installationUuid);

  let deliveryId: string;
  try {
    const recorded = await integrationsLib.recordWebhookDeliveryTargets(db, {
      provider: 'sentry',
      externalDeliveryId,
      externalAccountId: routing.orgSlug ?? routing.installationUuid,
      resourceKind,
      externalResourceId,
      eventType: resource,
      action,
      headers: {
        has_signature: Boolean(signature),
        request_id: externalDeliveryId,
        sentry_hook_resource: resource,
        sentry_hook_timestamp: timestamp,
      },
      payload,
      dedupKey: sentryDeliveryDedupKey(body, externalDeliveryId),
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
      operation: 'sentry_webhook_record_delivery',
      tags: { provider: 'sentry' },
    });
    return NextResponse.json({ ok: false, reason: 'delivery_persist_failed' }, { status: 503 });
  }

  try {
    const queue = await requireRedisQueue();
    await queue.enqueueWebhookDeliveryJob({ deliveryId });
  } catch (err) {
    reportCaughtError(err, {
      surface: 'background',
      operation: 'sentry_webhook_enqueue_delivery',
      tags: { provider: 'sentry' },
    });
    return NextResponse.json({ ok: true, reason: 'enqueue_failed' }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
