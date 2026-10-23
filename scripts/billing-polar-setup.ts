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
  enterpriseProductPriceWrites,
  productPricesWithExtraMemberMeter,
  selectTimelineEnterpriseProduct,
  selectTimelineExtraMemberMeter,
  timelineEnterpriseProductCreateBody,
  timelineExtraMemberMeterCreateBody,
  timelineMeterIdsByEvent,
  timelineTopUpsToArchive,
  TIMELINE_ENTERPRISE_CUSTOM_MAXIMUM_CENTS,
  TIMELINE_ENTERPRISE_PRODUCT_NAME,
  TIMELINE_EXTRA_MEMBER_EVENT_NAME,
  TIMELINE_EXTRA_MEMBER_METER_NAME,
  TIMELINE_EXTRA_MEMBER_UNIT_AMOUNT,
  upsertEnvAssignments,
  webhookNeedsUpdate,
  type PolarCatalogPrice,
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
  id?: string;
  amount_type?: string;
  price_amount?: number | null;
  price_currency?: string | null;
  minimum_amount?: number | null;
  preset_amount?: number | null;
  meter_id?: string | null;
  unit_amount?: string | number | null;
  is_archived?: boolean;
}

interface PolarMeterRow {
  id?: string;
  name?: string;
  filter?: { clauses?: { value?: string }[] };
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

function catalogPrices(rows: PolarPriceRow[] | undefined): PolarCatalogPrice[] {
  return (rows ?? []).flatMap((price) => {
    if (!price.id) return [];
    return [
      {
        id: price.id,
        ...(price.is_archived === true ? { isArchived: true } : {}),
        ...(price.meter_id ? { meterId: price.meter_id } : {}),
        ...(price.amount_type ? { amountType: price.amount_type } : {}),
        ...(typeof price.minimum_amount === 'number'
          ? { minimumAmount: price.minimum_amount }
          : {}),
      },
    ];
  });
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
  const meterRows = (await listAll(
    base,
    token,
    `/meters/?organization_id=${encodeURIComponent(organizationId)}`,
  )) as PolarMeterRow[];
  const namedMeters = (rows: PolarMeterRow[]) =>
    rows.flatMap((row) => (row.id && row.name ? [{ id: row.id, name: row.name }] : []));
  let extraMemberMeter = selectTimelineExtraMemberMeter(namedMeters(meterRows));
  let extraMemberMeterAction = 'reused';
  if (!extraMemberMeter) {
    let created = await polarFetch(base, token, '/meters/', {
      method: 'POST',
      body: timelineExtraMemberMeterCreateBody('custom'),
    });
    if (created.status < 200 || created.status >= 300) {
      const listed = (await listAll(
        base,
        token,
        `/meters/?organization_id=${encodeURIComponent(organizationId)}`,
      )) as PolarMeterRow[];
      extraMemberMeter = selectTimelineExtraMemberMeter(namedMeters(listed));
      if (!extraMemberMeter) {
        created = await polarFetch(base, token, '/meters/', {
          method: 'POST',
          body: timelineExtraMemberMeterCreateBody('scalar'),
        });
      }
    }
    if (!extraMemberMeter) {
      if (created.status < 200 || created.status >= 300) {
        throw new Error(
          `Polar create ${TIMELINE_EXTRA_MEMBER_METER_NAME} failed: ${created.status} ${redact(created.body)}`,
        );
      }
      assertSameOrganization(created.body, organizationId, TIMELINE_EXTRA_MEMBER_METER_NAME);
      const row = created.body as PolarMeterRow;
      if (!row.id) {
        throw new Error(`Polar create ${TIMELINE_EXTRA_MEMBER_METER_NAME} returned no id`);
      }
      extraMemberMeter = { id: row.id, name: row.name ?? TIMELINE_EXTRA_MEMBER_METER_NAME };
      extraMemberMeterAction = 'created';
    }
  }

  const subscriptionProducts = [
    ['PAYG', process.env.POLAR_PRODUCT_ID_PAYG?.trim()],
    ['Team', process.env.POLAR_PRODUCT_ID_TEAM?.trim()],
    ['Business', process.env.POLAR_PRODUCT_ID_BUSINESS?.trim()],
  ] as const;
  const extraMemberPrices: string[] = [];
  for (const [label, productId] of subscriptionProducts) {
    if (!productId) throw new Error(`POLAR_PRODUCT_ID for ${label} is required`);
    const current = await polarFetch(base, token, `/products/${productId}`);
    if (current.status < 200 || current.status >= 300) {
      throw new Error(
        `Polar read ${label} product failed: ${current.status} ${redact(current.body)}`,
      );
    }
    assertSameOrganization(current.body, organizationId, `${label} product`);
    const product = current.body as PolarProductRow;
    const prices = productPricesWithExtraMemberMeter({
      prices: catalogPrices(product.prices),
      meterId: extraMemberMeter.id,
      unitAmount: TIMELINE_EXTRA_MEMBER_UNIT_AMOUNT,
    });
    const alreadyAttached = prices.every((price) => 'id' in price);
    if (!alreadyAttached) {
      const updated = await polarFetch(base, token, `/products/${productId}`, {
        method: 'PATCH',
        body: { prices },
      });
      if (updated.status < 200 || updated.status >= 300) {
        throw new Error(
          `Polar attach extra-member price on ${label} failed: ${updated.status} ${redact(updated.body)}`,
        );
      }
    }
    extraMemberPrices.push(
      `${label} ${alreadyAttached ? 'present' : 'attached'} ${TIMELINE_EXTRA_MEMBER_UNIT_AMOUNT}`,
    );
  }

  const meterRowsAfter = (await listAll(
    base,
    token,
    `/meters/?organization_id=${encodeURIComponent(organizationId)}`,
  )) as PolarMeterRow[];
  const meterIdsByEvent = timelineMeterIdsByEvent(
    meterRowsAfter.flatMap((row) => (row.id ? [{ id: row.id, filter: row.filter }] : [])),
  );
  if (!meterIdsByEvent[TIMELINE_EXTRA_MEMBER_EVENT_NAME]) {
    meterIdsByEvent[TIMELINE_EXTRA_MEMBER_EVENT_NAME] = extraMemberMeter.id;
  }

  let enterpriseProduct = selectTimelineEnterpriseProduct(productRows.map(toProduct));
  let enterpriseAction = 'reused';
  if (!enterpriseProduct) {
    let created = await polarFetch(base, token, '/products/', {
      method: 'POST',
      body: timelineEnterpriseProductCreateBody({ meterIdsByEvent }),
    });
    if (created.status < 200 || created.status >= 300) {
      const listed = (await listAll(
        base,
        token,
        `/products/?organization_id=${encodeURIComponent(organizationId)}&is_archived=false`,
      )) as PolarProductRow[];
      enterpriseProduct = selectTimelineEnterpriseProduct(listed.map(toProduct));
      const failure = JSON.stringify(created.body);
      if (
        !enterpriseProduct &&
        (failure.includes('maximum_amount') || failure.includes('maximum'))
      ) {
        created = await polarFetch(base, token, '/products/', {
          method: 'POST',
          body: timelineEnterpriseProductCreateBody({
            meterIdsByEvent,
            maximumAmount: TIMELINE_ENTERPRISE_CUSTOM_MAXIMUM_CENTS,
          }),
        });
      }
    }
    if (!enterpriseProduct) {
      if (created.status < 200 || created.status >= 300) {
        throw new Error(
          `Polar create ${TIMELINE_ENTERPRISE_PRODUCT_NAME} failed: ${created.status} ${redact(created.body)}`,
        );
      }
      assertSameOrganization(created.body, organizationId, TIMELINE_ENTERPRISE_PRODUCT_NAME);
      const row = created.body as PolarProductRow;
      if (!row.id)
        throw new Error(`Polar create ${TIMELINE_ENTERPRISE_PRODUCT_NAME} returned no id`);
      enterpriseProduct = toProduct(row);
      enterpriseAction = 'created';
    }
  }
  if (!enterpriseProduct) {
    throw new Error(`${TIMELINE_ENTERPRISE_PRODUCT_NAME} was not created`);
  }
  if (enterpriseAction !== 'created') {
    const current = await polarFetch(base, token, `/products/${enterpriseProduct.id}`);
    if (current.status < 200 || current.status >= 300) {
      throw new Error(
        `Polar read ${TIMELINE_ENTERPRISE_PRODUCT_NAME} failed: ${current.status} ${redact(current.body)}`,
      );
    }
    assertSameOrganization(current.body, organizationId, TIMELINE_ENTERPRISE_PRODUCT_NAME);
    const product = current.body as PolarProductRow;
    const prices = enterpriseProductPriceWrites({
      prices: catalogPrices(product.prices),
      meterIdsByEvent,
    });
    const needsPatch = prices.some((price) => !('id' in price));
    if (needsPatch) {
      const updated = await polarFetch(base, token, `/products/${enterpriseProduct.id}`, {
        method: 'PATCH',
        body: { prices },
      });
      if (updated.status < 200 || updated.status >= 300) {
        const failure = JSON.stringify(updated.body);
        if (failure.includes('maximum_amount') || failure.includes('maximum')) {
          const retried = await polarFetch(base, token, `/products/${enterpriseProduct.id}`, {
            method: 'PATCH',
            body: {
              prices: enterpriseProductPriceWrites({
                prices: catalogPrices(product.prices),
                meterIdsByEvent,
                maximumAmount: TIMELINE_ENTERPRISE_CUSTOM_MAXIMUM_CENTS,
              }),
            },
          });
          if (retried.status < 200 || retried.status >= 300) {
            throw new Error(
              `Polar update ${TIMELINE_ENTERPRISE_PRODUCT_NAME} failed: ${retried.status} ${redact(retried.body)}`,
            );
          }
        } else {
          throw new Error(
            `Polar update ${TIMELINE_ENTERPRISE_PRODUCT_NAME} failed: ${updated.status} ${redact(updated.body)}`,
          );
        }
      }
      enterpriseAction = 'updated';
    }
  }
  const enterpriseProductId = enterpriseProduct.id;

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
      POLAR_PRODUCT_ID_ENTERPRISE: enterpriseProductId,
    });
  }

  console.log(
    `Extra member meter: ${extraMemberMeterAction} ${extraMemberMeter.id} unit_amount ${TIMELINE_EXTRA_MEMBER_UNIT_AMOUNT}`,
  );
  console.log(`Extra member prices: ${extraMemberPrices.join('; ')}`);
  console.log(
    `Timeline Enterprise: ${enterpriseAction} ${enterpriseProductId} custom platform fee plus six meters`,
  );
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
      ? `Updated ${envFile} keys: POLAR_WEBHOOK_ID, POLAR_WEBHOOK_SECRET, POLAR_PRODUCT_ID_ENTERPRISE`
      : 'No env file found; ids were printed and the webhook secret was not saved',
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Polar setup failed';
  console.error(redact(message));
  process.exitCode = 1;
});
