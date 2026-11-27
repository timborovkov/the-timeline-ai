import { createHash } from 'node:crypto';

import { z } from 'zod';

import { getEnv } from '#src/env.js';
import { providerFetch } from '#src/integrations/request.js';
import {
  defineResourceAccess,
  type ResourceAccessContext,
} from '#src/integrations/resource-access.js';
import { exactTargetSelections } from '#src/integrations/selection-policy.js';
import type { IntegrationEvent, IntegrationProvider } from '#src/integrations/types.js';

const request = providerFetch('hubspot');
const scopes = ['oauth', 'crm.objects.deals.read', 'crm.objects.companies.read'];
const api = 'https://api.hubapi.com';
const id = z.string().min(1);
const storedTokens = z.object({
  access_token: id,
  refresh_token: id,
  expiresAt: z.number(),
  hub_id: id,
});
const accountId = z.union([z.number().int().positive(), id]).transform(String);
const tokenResponse = z.object({
  access_token: id,
  refresh_token: id,
  expires_in: z.number().positive(),
  hub_id: accountId.optional(),
  scopes: z.array(id).optional(),
});
const pipeline = z.object({ id, label: id, stages: z.array(z.object({ id, label: id })) });
const deal = z.object({
  id,
  updatedAt: z.iso.datetime({ offset: true }),
  properties: z.object({ dealname: z.string().nullable(), dealstage: id, pipeline: id }),
  associations: z
    .object({
      companies: z
        .object({ results: z.array(z.object({ id })), paging: z.unknown().optional() })
        .optional(),
    })
    .optional(),
});
const company = z.object({
  id,
  properties: z.object({ name: z.string().nullable(), domain: z.string().nullable().optional() }),
});
const tracked = z.object({
  visits: z
    .record(
      id,
      z.object({ generation: z.number().int(), outside: z.boolean(), observedAt: z.string() }),
    )
    .default({}),
  ids: z.array(id),
  revisions: z.record(id, id).default({}),
  scan: z
    .object({
      afterId: id,
      current: z.array(id),
      revisions: z.record(id, id),
      startedAt: z.string(),
    })
    .optional(),
});

function credentials() {
  const { HUBSPOT_CLIENT_ID: client_id, HUBSPOT_CLIENT_SECRET: client_secret } = getEnv();
  if (!client_id || !client_secret) throw new Error('hubspot_oauth_unconfigured');
  return { client_id, client_secret };
}

async function exchange(fields: Record<string, string>) {
  const response = await request(
    api + '/oauth/2026-03/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...credentials(), ...fields }).toString(),
    },
    { retries: 0 },
  );
  if (!response.ok) {
    const error = z
      .object({ error: z.literal('invalid_grant') })
      .safeParse(await response.json().catch(() => null));
    throw new Error(
      error.success
        ? 'HubSpot invalid_grant'
        : 'HubSpot OAuth token exchange failed: HTTP ' + String(response.status),
    );
  }
  const grant = tokenResponse.parse(await response.json());
  let portal = grant.hub_id,
    granted = grant.scopes;
  if (!portal || !granted) {
    const info = await request(
      api + '/oauth/2026-03/token/introspect',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ...credentials(),
          token: grant.access_token,
          token_type_hint: 'access_token',
        }).toString(),
      },
      { retries: 0 },
    );
    if (!info.ok) throw new Error('hubspot_token_introspection_failed');
    const details = z
      .object({
        active: z.literal(true),
        client_id: z.literal(credentials().client_id),
        hub_id: accountId,
        scopes: z.array(id),
      })
      .parse(await info.json());
    portal = details.hub_id;
    granted = details.scopes;
  }
  if (!scopes.every((scope) => granted.includes(scope)))
    throw new Error('hubspot_missing_read_scopes');
  return {
    ...grant,
    hub_id: portal,
    scopes: granted,
    expiresAt: Date.now() + grant.expires_in * 1000,
  };
}

async function authorized(raw: unknown, account: string | null, ctx?: ResourceAccessContext) {
  let tokens = storedTokens.parse(raw);
  if (!account || tokens.hub_id !== account) throw new Error('hubspot_account_mismatch');
  if (tokens.expiresAt < Date.now() + 60000) {
    tokens = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    if (tokens.hub_id !== account) throw new Error('hubspot_account_mismatch');
    await ctx?.persistTokens(tokens);
  }
  return tokens.access_token;
}

async function read(
  token: string,
  path: string,
  body?: unknown,
  allowMissing = false,
): Promise<unknown> {
  const response = await request(api + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error('HubSpot CRM read failed: HTTP ' + String(response.status));
  return response.json();
}
async function pipelines(token: string) {
  return z
    .object({ results: z.array(pipeline) })
    .parse(await read(token, '/crm/v3/pipelines/deals')).results;
}

async function associatedCompanyIds(token: string, record: z.infer<typeof deal>) {
  const links = record.associations?.companies;
  const ids = new Set(links?.results.map((link) => link.id));
  if (!links?.paging) return ids;
  const cursors = new Set<string>();
  let after: string | undefined;
  do {
    const params = new URLSearchParams({ limit: '500' });
    if (after) params.set('after', after);
    const page = z
      .object({
        results: z.array(z.object({ toObjectId: accountId })),
        paging: z
          .object({ next: z.object({ after: z.union([id, z.number()]).transform(String) }) })
          .optional(),
      })
      .parse(
        await read(
          token,
          '/crm/v4/objects/deals/' +
            encodeURIComponent(record.id) +
            '/associations/companies?' +
            params.toString(),
        ),
      );
    for (const row of page.results) ids.add(row.toObjectId);
    after = page.paging?.next.after;
    if (after && cursors.has(after)) throw new Error('hubspot_invalid_association_cursor');
    if (after) cursors.add(after);
  } while (after);
  return ids;
}

type SyncInput = Omit<Parameters<IntegrationProvider['backfill']>[0], 'purpose'>;
async function sync({ tokens, integration, selections, ctx }: SyncInput) {
  const account = integration.externalAccountId;
  if (!account) throw new Error('hubspot_account_missing');
  const token = await authorized(tokens, account, ctx);
  const available = await pipelines(token);
  const companies = new Map<string, z.infer<typeof company>>();
  for (const selection of selections) {
    if (selection.kind !== 'hubspot.pipeline') continue;
    const source = available.find((p) => p.id === selection.externalId);
    if (!source) throw new Error('hubspot_selected_pipeline_unavailable');
    const cursorKey = 'hubspot.pipeline:' + source.id;
    const previous = tracked.safeParse(await ctx.loadCursor(cursorKey));
    const missing = new Set(previous.success ? previous.data.ids : []);
    const prior = previous.success ? previous.data : undefined;
    const current = new Set<string>(prior?.scan?.current);
    for (const seen of current) missing.delete(seen);
    const revisions = { ...prior?.scan?.revisions };
    const visits = { ...prior?.visits };
    const stages = Object.fromEntries(source.stages.map((stage) => [stage.id, stage.label]));
    const startedAt = prior?.scan?.startedAt ?? new Date().toISOString();
    const observe = async (dealId: string): Promise<IntegrationEvent | null> => {
      const raw = await read(
        token,
        '/crm/v3/objects/deals/' +
          encodeURIComponent(dealId) +
          '?properties=dealname,dealstage,pipeline&associations=companies',
        undefined,
        true,
      );
      const record = raw === null ? null : deal.parse(raw);
      const visit = visits[dealId];
      if (record?.properties.pipeline !== source.id) {
        if (!missing.delete(dealId) || visit?.outside) return null;
        const occurredAt = new Date(
          Math.max(
            Date.parse(record?.updatedAt ?? startedAt),
            visit ? Date.parse(visit.observedAt) + 1 : 0,
          ),
        );
        visits[dealId] = {
          generation: (visit?.generation ?? 0) + 1,
          outside: true,
          observedAt: occurredAt.toISOString(),
        };
        return {
          provider: 'hubspot',
          externalObjectId: account + ':deal:' + dealId,
          eventType: 'deal.left_pipeline',
          signalClass: 'captured_work',
          eventClass: 'work_record',
          occurredAt,
          dedupKey: [
            'hubspot',
            account,
            source.id,
            dealId,
            'exit',
            visits[dealId].generation,
            record?.updatedAt ?? prior?.revisions[dealId] ?? 'archived',
          ].join(':'),
          contentText: 'Deal left the selected HubSpot pipeline.',
          extra: { hubspot: { id: dealId, pipeline_id: source.id, active: false } },
        };
      }
      missing.delete(dealId);
      current.add(dealId);
      if (visit?.outside) {
        visits[dealId] = {
          ...visit,
          outside: false,
          observedAt: new Date(
            Math.max(Date.parse(startedAt), Date.parse(visit.observedAt) + 1),
          ).toISOString(),
        };
      }
      const associated = [];
      for (const companyId of await associatedCompanyIds(token, record)) {
        let details = companies.get(companyId);
        if (!details) {
          details = company.parse(
            await read(
              token,
              '/crm/v3/objects/companies/' +
                encodeURIComponent(companyId) +
                '?properties=name,domain',
            ),
          );
          companies.set(companyId, details);
        }
        associated.push({
          id: companyId,
          name: details.properties.name,
          domain: details.properties.domain ?? null,
        });
      }
      associated.sort((a, b) => a.id.localeCompare(b.id));
      const stage = source.stages.find((s) => s.id === record.properties.dealstage);
      const title = record.properties.dealname?.trim()
        ? record.properties.dealname.trim()
        : 'Untitled deal';
      const fields = {
        id: dealId,
        title,
        pipeline_id: source.id,
        pipeline_label: source.label,
        stage_id: record.properties.dealstage,
        stage_label: stage?.label ?? record.properties.dealstage,
        companies: associated,
        active: true,
        url:
          'https://app.hubspot.com/contacts/' +
          encodeURIComponent(account) +
          '/record/0-3/' +
          encodeURIComponent(dealId),
      };
      const digest = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
      revisions[dealId] = record.updatedAt;
      const externalId = account + ':deal:' + dealId;
      return {
        provider: 'hubspot',
        eventType: 'deal.updated',
        externalObjectId: externalId,
        externalEventId: record.updatedAt,
        dedupKey: [
          'hubspot',
          externalId,
          record.updatedAt,
          digest,
          ...(visit ? [visit.generation] : []),
        ].join(':'),
        occurredAt: new Date(
          Math.max(
            Date.parse(record.updatedAt),
            Date.parse(visits[dealId]?.observedAt ?? record.updatedAt),
          ),
        ),
        eventClass: 'work_record',
        signalClass: 'captured_work',
        contentText: title + ' · ' + source.label + ' · ' + fields.stage_label,
        extra: { hubspot: fields },
        objectMap: {
          type: 'deal',
          canonicalName: title,
          displayTitle: title,
          externalId,
          url: fields.url,
        },
      };
    };
    let afterId = prior?.scan?.afterId;
    let deferred = false;
    for (;;) {
      const filters = [{ propertyName: 'pipeline', operator: 'EQ', value: source.id }];
      if (afterId) filters.push({ propertyName: 'hs_object_id', operator: 'GT', value: afterId });
      const page = z
        .object({ results: z.array(z.object({ id: z.string().regex(/^\d+$/) })) })
        .parse(
          await read(token, '/crm/v3/objects/deals/search', {
            filterGroups: [{ filters }],
            sorts: ['hs_object_id'],
            properties: ['hs_object_id'],
            limit: 50,
          }),
        );
      const events: IntegrationEvent[] = [];
      for (const row of page.results) {
        if (afterId && BigInt(row.id) <= BigInt(afterId))
          throw new Error('hubspot_invalid_page_order');
        afterId = row.id;
        const event = await observe(row.id);
        if (event) events.push(event);
      }
      if (events.length) await ctx.writeEvents(events);
      if (page.results.length < 50) break;
      if (ctx.saveCursorWithContinuations && afterId) {
        deferred = true;
        await ctx.saveCursorWithContinuations(
          cursorKey,
          {
            ids: prior?.ids ?? [],
            revisions: prior?.revisions ?? {},
            stages,
            visits,
            scan: { afterId, current: [...current], revisions, startedAt },
          },
          [{ resourceType: selection.kind, externalId: source.id }],
        );
        break;
      }
    }
    if (deferred) continue;
    for (const previousId of [...missing]) {
      const event = await observe(previousId);
      if (event) await ctx.writeEvents([event]);
    }
    await ctx.saveCursor(cursorKey, { ids: [...current], revisions, stages, visits });
  }
  return undefined;
}

export const hubspotProvider: IntegrationProvider = {
  id: 'hubspot',
  displayLabel: 'HubSpot',
  syncSelectionPolicy: { recovery: 'per_resource', resolveTarget: exactTargetSelections },
  startOAuth({ state, redirectUri }) {
    const url = new URL('https://app.hubspot.com/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: credentials().client_id,
      scope: scopes.join(' '),
      redirect_uri: redirectUri,
      state,
    }).toString();
    return Promise.resolve({ authorizeUrl: url.toString() });
  },
  async handleOAuthCallback({ code, redirectUri }) {
    const tokens = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
    return {
      externalAccountId: tokens.hub_id,
      displayName: 'HubSpot ' + tokens.hub_id,
      scopes: tokens.scopes,
      tokens,
      accessTokenExpiresAt: new Date(tokens.expiresAt),
    };
  },
  ...defineResourceAccess({
    async browseResources(identity, tokens, ctx) {
      return (await pipelines(await authorized(tokens, identity.externalAccountId, ctx))).map(
        (p) => ({ externalId: p.id, kind: 'hubspot.pipeline', label: p.label }),
      );
    },
  }),
  backfill: sync,
  incrementalSync: sync,
  handleWebhook() {
    return Promise.resolve({ events: [], syncTasks: [] });
  },
};
