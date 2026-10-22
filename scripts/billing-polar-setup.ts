import { renameSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';

import {
  DEFAULT_TIMELINE_POLAR_WEBHOOK_URL,
  TIMELINE_POLAR_WEBHOOK_EVENTS,
  TIMELINE_POLAR_WEBHOOK_NAME,
  TIMELINE_TOPUP_PRODUCT_NAME,
  assertTimelineWebhookUrl,
  isDisabledExampleTimelineWebhook,
  isProtectedForeignWebhook,
  mergedWebhookEvents,
  polarApiBaseUrl,
  removeEnvAssignments,
  selectTimelineWebhook,
  timelineTopUpsToArchive,
  upsertEnvAssignments,
  webhookNeedsUpdate,
  type PolarSetupProduct,
  type PolarSetupWebhook,
} from '@timeline/shared/billing/polar-setup';

const args = process.argv.slice(2);

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) throw new Error(`Environment file not found: ${path}`);
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    const raw = trimmed.slice(equals + 1).trim();
    process.env[key] =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

interface PolarPriceRow {
  amount_type?: string;
  price_amount?: number | null;
  price_currency?: string | null;
  minimum_amount?: number | null;
  preset_amount?: number | null;
}

interface PolarProductRow {
  id: string;
  name?: string;
  is_archived?: boolean;
  is_recurring?: boolean;
  prices?: PolarPriceRow[];
}

interface PolarWebhookRow {
  id: string;
  url?: string;
  enabled?: boolean;
  format?: string;
  events?: string[];
  secret?: string;
}

function toProduct(row: PolarProductRow): PolarSetupProduct {
  return {
    id: row.id,
    name: row.name ?? '',
    isArchived: row.is_archived === true,
    isRecurring: row.is_recurring === true,
    prices: (row.prices ?? []).map((price) => ({
      ...(price.amount_type ? { amountType: price.amount_type } : {}),
      priceAmount: price.price_amount,
      ...(price.price_currency ? { priceCurrency: price.price_currency } : {}),
      minimumAmount: price.minimum_amount,
      presetAmount: price.preset_amount,
    })),
  };
}

function toWebhook(row: PolarWebhookRow): PolarSetupWebhook & { secret?: string } {
  return {
    id: row.id,
    url: row.url ?? '',
    enabled: row.enabled === true,
    ...(row.format ? { format: row.format } : {}),
    events: row.events ?? [],
    ...(row.secret ? { secret: row.secret } : {}),
  };
}

function redact(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text
    .replace(/whsec_[A-Za-z0-9_-]+/gu, 'whsec_[redacted]')
    .replace(/polar_oat_[A-Za-z0-9]+/gu, 'polar_oat_[redacted]')
    .replace(/"secret"\s*:\s*"[^"]*"/gu, '"secret":"[redacted]"')
    .slice(0, 500);
}

async function polarFetch(
  base: string,
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  headers.set('User-Agent', 'timeline-billing-polar-setup');
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${base}${path}`, {
    method: init?.method ?? 'GET',
    headers,
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

function assertSameOrganization(body: unknown, organizationId: string, label: string): void {
  if (!body || typeof body !== 'object' || !('organization_id' in body)) return;
  if (body.organization_id !== organizationId) {
    throw new Error(`${label} belongs to a different Polar organization`);
  }
}

function itemsOf(body: unknown): unknown[] {
  if (!body || typeof body !== 'object' || !('items' in body)) return [];
  const items = body.items;
  return Array.isArray(items) ? items : [];
}

async function listAll(base: string, token: string, path: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const joiner = path.includes('?') ? '&' : '?';
    const response = await polarFetch(base, token, `${path}${joiner}limit=100&page=${page}`);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Polar ${path} failed: ${response.status} ${redact(response.body)}`);
    }
    const pageRows = itemsOf(response.body);
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return rows;
}

function writeEnvFile(path: string, updates: Record<string, string>): void {
  const current = readFileSync(path, 'utf8');
  const next = removeEnvAssignments(upsertEnvAssignments(current, updates), [
    'POLAR_PRODUCT_ID_TOPUP',
  ]);
  const temporary = `${path}.setup-tmp`;
  writeFileSync(temporary, next, { encoding: 'utf8', mode: 0o600 });
  try {
    renameSync(temporary, path);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

async function main(): Promise<void> {
  const envFile = argValue('env-file') ?? '.env';
  if (existsSync(envFile)) loadEnvFile(envFile);
  const server = process.env.POLAR_SERVER?.trim() || 'sandbox';
  if (server !== 'sandbox' && !args.includes('--allow-production')) {
    throw new Error('Refusing to run unless POLAR_SERVER=sandbox or --allow-production is set');
  }
  const token = requiredEnv('POLAR_ACCESS_TOKEN');
  const organizationId = requiredEnv('POLAR_ORGANIZATION_ID');
  const webhookUrl = argValue('webhook-url') ?? DEFAULT_TIMELINE_POLAR_WEBHOOK_URL;
  assertTimelineWebhookUrl(webhookUrl);
  const base = polarApiBaseUrl(server);

  const productRows = (await listAll(
    base,
    token,
    `/products/?organization_id=${encodeURIComponent(organizationId)}&is_archived=false`,
  )) as PolarProductRow[];
  const archived: string[] = [];
  for (const product of timelineTopUpsToArchive(productRows.map(toProduct))) {
    const updated = await polarFetch(base, token, `/products/${product.id}`, {
      method: 'PATCH',
      body: { is_archived: true },
    });
    if (updated.status < 200 || updated.status >= 300) {
      throw new Error(
        `Polar archive ${TIMELINE_TOPUP_PRODUCT_NAME} failed: ${updated.status} ${redact(updated.body)}`,
      );
    }
    archived.push(product.id);
  }

  const webhookRows = (
    (await listAll(
      base,
      token,
      `/webhooks/endpoints?organization_id=${encodeURIComponent(organizationId)}`,
    )) as PolarWebhookRow[]
  ).map(toWebhook);
  const removed: string[] = [];
  for (const webhook of webhookRows) {
    if (!isDisabledExampleTimelineWebhook(webhook) || isProtectedForeignWebhook(webhook)) continue;
    const deleted = await polarFetch(base, token, `/webhooks/endpoints/${webhook.id}`, {
      method: 'DELETE',
    });
    if (deleted.status < 200 || deleted.status >= 300) {
      throw new Error(
        `Polar delete placeholder webhook failed: ${deleted.status} ${redact(deleted.body)}`,
      );
    }
    removed.push(webhook.id);
  }

  const existing = selectTimelineWebhook(webhookRows, webhookUrl);
  let webhookId: string;
  let webhookSecret: string | undefined;
  let webhookAction: string;
  if (!existing) {
    const created = await polarFetch(base, token, '/webhooks/endpoints', {
      method: 'POST',
      body: {
        name: TIMELINE_POLAR_WEBHOOK_NAME,
        url: webhookUrl,
        format: 'raw',
        api_version: '2026-10',
        enabled: true,
        events: [...TIMELINE_POLAR_WEBHOOK_EVENTS],
      },
    });
    if (created.status < 200 || created.status >= 300) {
      throw new Error(`Polar create webhook failed: ${created.status} ${redact(created.body)}`);
    }
    assertSameOrganization(created.body, organizationId, 'Timeline webhook');
    const row = toWebhook(created.body as PolarWebhookRow);
    webhookId = row.id;
    webhookSecret = row.secret;
    webhookAction = 'created';
  } else if (webhookNeedsUpdate(existing, TIMELINE_POLAR_WEBHOOK_EVENTS)) {
    const updated = await polarFetch(base, token, `/webhooks/endpoints/${existing.id}`, {
      method: 'PATCH',
      body: {
        format: 'raw',
        enabled: true,
        events: mergedWebhookEvents(existing.events, TIMELINE_POLAR_WEBHOOK_EVENTS),
      },
    });
    if (updated.status < 200 || updated.status >= 300) {
      throw new Error(`Polar update webhook failed: ${updated.status} ${redact(updated.body)}`);
    }
    const row = toWebhook(updated.body as PolarWebhookRow);
    webhookId = row.id;
    webhookSecret = row.secret;
    webhookAction = 'updated';
  } else {
    webhookId = existing.id;
    webhookSecret = webhookRows.find((webhook) => webhook.id === existing.id)?.secret;
    webhookAction = 'reused';
  }
  if (!webhookSecret) webhookSecret = process.env.POLAR_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) throw new Error('Polar did not return a webhook secret and none is stored');

  if (existsSync(envFile)) {
    writeEnvFile(envFile, {
      POLAR_WEBHOOK_ID: webhookId,
      POLAR_WEBHOOK_SECRET: webhookSecret,
    });
  }

  if (archived.length > 0) {
    console.log(`Archived Timeline Top-up ${archived.join(', ')}`);
  } else {
    console.log('Timeline Top-up: none active');
  }
  console.log(`Timeline webhook: ${webhookAction} ${webhookId} ${webhookUrl}`);
  if (removed.length > 0)
    console.log(`Removed disabled example.com placeholder ${removed.join(', ')}`);
  console.log(
    existsSync(envFile)
      ? `Updated ${envFile} keys: POLAR_WEBHOOK_ID, POLAR_WEBHOOK_SECRET`
      : 'No env file found; ids were printed and the webhook secret was not saved',
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Polar setup failed';
  console.error(redact(message));
  process.exitCode = 1;
});
