import { existsSync, readFileSync } from 'node:fs';

import {
  DEFAULT_TIMELINE_POLAR_WEBHOOK_URL,
  TIMELINE_PRODUCT_ENV_NAMES,
  TIMELINE_PRODUCT_KEYS,
  assertPolarSetupServer,
  assertTimelineWebhookUrl,
  polarApiBaseUrl,
  renderPolarSetupPlan,
  renderPolarSetupReport,
  runPolarSetup,
  type PolarMeterWrite,
  type PolarProductPatch,
  type PolarProductWrite,
  type PolarSetupClient,
  type PolarSetupMeter,
  type PolarSetupPrice,
  type PolarSetupProduct,
  type PolarSetupWebhook,
  type PolarWebhookWrite,
  type TimelineProductKey,
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

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function redact(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text
    .replace(/whsec_[A-Za-z0-9_-]+/gu, 'whsec_[redacted]')
    .replace(/polar_oat_[A-Za-z0-9]+/gu, 'polar_oat_[redacted]')
    .replace(/"secret"\s*:\s*"[^"]*"/gu, '"secret":"[redacted]"')
    .slice(0, 500);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function metadataOf(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const metadata: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string') metadata[key] = entry;
    else if (typeof entry === 'number' || typeof entry === 'boolean') metadata[key] = String(entry);
  }
  return metadata;
}

function assertSameOrganization(body: unknown, organizationId: string, label: string): void {
  const record = asRecord(body);
  if (!record || !('organization_id' in record) || record.organization_id == null) return;
  if (record.organization_id !== organizationId) {
    throw new Error(`${label} belongs to a different Polar organization`);
  }
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

function itemsOf(body: unknown): unknown[] {
  const record = asRecord(body);
  if (!record || !Array.isArray(record.items)) return [];
  return record.items;
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
    for (const row of pageRows)
      assertSameOrganization(row, requiredEnv('POLAR_ORGANIZATION_ID'), path);
    if (pageRows.length < 100) break;
  }
  return rows;
}

function eventNameOf(row: Record<string, unknown>): string | null {
  const filter = asRecord(row.filter);
  const clauses = Array.isArray(filter?.clauses) ? filter.clauses : [];
  for (const clause of clauses) {
    const record = asRecord(clause);
    if (
      record?.property === 'name' &&
      record.operator === 'eq' &&
      typeof record.value === 'string'
    ) {
      return record.value;
    }
  }
  for (const clause of clauses) {
    const record = asRecord(clause);
    if (typeof record?.value === 'string') return record.value;
  }
  return null;
}

function priceOf(value: unknown): PolarSetupPrice | null {
  const price = asRecord(value);
  if (!price || typeof price.id !== 'string' || price.id.length === 0) return null;
  const unit = price.unit_amount;
  return {
    id: price.id,
    archived: price.is_archived === true,
    meterId: typeof price.meter_id === 'string' ? price.meter_id : null,
    amountType: typeof price.amount_type === 'string' ? price.amount_type : null,
    priceAmount: typeof price.price_amount === 'number' ? price.price_amount : null,
    priceCurrency: typeof price.price_currency === 'string' ? price.price_currency : null,
    minimumAmount: typeof price.minimum_amount === 'number' ? price.minimum_amount : null,
    unitAmount: typeof unit === 'string' ? unit : typeof unit === 'number' ? String(unit) : null,
  };
}

function meterOf(value: unknown): PolarSetupMeter | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : '',
    eventName: eventNameOf(row),
    metadata: metadataOf(row.metadata),
    archived: row.archived_at != null || row.is_archived === true,
  };
}

function productOf(value: unknown): PolarSetupProduct | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== 'string') return null;
  const prices = Array.isArray(row.prices)
    ? row.prices.flatMap((price) => priceOf(price) ?? [])
    : [];
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : '',
    archived: row.is_archived === true,
    metadata: metadataOf(row.metadata),
    prices,
  };
}

function webhookOf(value: unknown): PolarSetupWebhook | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    url: typeof row.url === 'string' ? row.url : '',
    enabled: row.enabled === true,
    format: typeof row.format === 'string' ? row.format : null,
    apiVersion: typeof row.api_version === 'string' ? row.api_version : null,
    events: Array.isArray(row.events)
      ? row.events.filter((event): event is string => typeof event === 'string')
      : [],
    metadata: metadataOf(row.metadata),
  };
}

function createClient(base: string, token: string, organizationId: string): PolarSetupClient {
  const encodedOrg = encodeURIComponent(organizationId);
  async function send(path: string, method: string, body?: unknown): Promise<unknown> {
    const response = await polarFetch(base, token, path, { method, body });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Polar ${method} ${path} failed: ${response.status} ${redact(response.body)}`,
      );
    }
    assertSameOrganization(response.body, organizationId, path);
    return response.body;
  }
  return {
    async listMeters() {
      const rows = await listAll(base, token, `/meters/?organization_id=${encodedOrg}`);
      return rows.flatMap((row) => meterOf(row) ?? []);
    },
    async listProducts() {
      const rows = await listAll(
        base,
        token,
        `/products/?organization_id=${encodedOrg}&is_archived=false`,
      );
      return rows.flatMap((row) => productOf(row) ?? []);
    },
    async listWebhooks() {
      const rows = await listAll(base, token, `/webhooks/endpoints?organization_id=${encodedOrg}`);
      return rows.flatMap((row) => webhookOf(row) ?? []);
    },
    async createMeter(body: PolarMeterWrite) {
      const created = asRecord(await send('/meters/', 'POST', body));
      if (!created || typeof created.id !== 'string')
        throw new Error('Polar create meter returned no id');
      return { id: created.id };
    },
    async patchMeter(id, body) {
      await send(`/meters/${encodeURIComponent(id)}`, 'PATCH', body);
    },
    async createProduct(body: PolarProductWrite) {
      const created = asRecord(await send('/products/', 'POST', body));
      if (!created || typeof created.id !== 'string') {
        throw new Error('Polar create product returned no id');
      }
      return { id: created.id };
    },
    async patchProduct(id, body: PolarProductPatch) {
      await send(`/products/${encodeURIComponent(id)}`, 'PATCH', body);
    },
    async archiveProduct(id) {
      await send(`/products/${encodeURIComponent(id)}`, 'PATCH', { is_archived: true });
    },
    async createWebhook(body: PolarWebhookWrite) {
      const created = asRecord(await send('/webhooks/endpoints', 'POST', body));
      if (!created || typeof created.id !== 'string') {
        throw new Error('Polar create webhook returned no id');
      }
      return { id: created.id, secret: typeof created.secret === 'string' ? created.secret : null };
    },
    async patchWebhook(id, body) {
      await send(`/webhooks/endpoints/${encodeURIComponent(id)}`, 'PATCH', body);
    },
    async deleteWebhook(id) {
      await send(`/webhooks/endpoints/${encodeURIComponent(id)}`, 'DELETE');
    },
  };
}

function preferredProductIds(): Partial<Record<TimelineProductKey, string>> {
  const ids: Partial<Record<TimelineProductKey, string>> = {};
  for (const key of TIMELINE_PRODUCT_KEYS) {
    const value = optionalEnv(TIMELINE_PRODUCT_ENV_NAMES[key]);
    if (value) ids[key] = value;
  }
  return ids;
}

async function main(): Promise<void> {
  const envFile = argValue('env-file');
  if (envFile) loadEnvFile(envFile);
  else if (existsSync('.env')) loadEnvFile('.env');
  const dryRun = args.includes('--dry-run');
  const server = assertPolarSetupServer(
    process.env.POLAR_SERVER?.trim() || 'sandbox',
    args.includes('--allow-production'),
  );
  const token = requiredEnv('POLAR_ACCESS_TOKEN');
  const organizationId = requiredEnv('POLAR_ORGANIZATION_ID');
  const webhookUrl = argValue('webhook-url') ?? DEFAULT_TIMELINE_POLAR_WEBHOOK_URL;
  assertTimelineWebhookUrl(webhookUrl);
  const result = await runPolarSetup({
    client: createClient(polarApiBaseUrl(server), token, organizationId),
    dryRun,
    request: {
      webhookUrl,
      webhookId: optionalEnv('POLAR_WEBHOOK_ID'),
      preferredProductIds: preferredProductIds(),
    },
  });
  const creatingWebhook = result.plan.actions.some((action) => action.kind === 'create_webhook');
  const webhookSecret =
    result.webhookSecret ?? (creatingWebhook ? null : optionalEnv('POLAR_WEBHOOK_SECRET'));
  console.log(renderPolarSetupPlan(result.plan));
  console.log(
    renderPolarSetupReport({
      server,
      organizationId,
      dryRun,
      result,
      webhookSecret,
    }),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Polar setup failed';
  console.error(redact(message));
  process.exitCode = 1;
});
