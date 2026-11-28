import { createHmac } from 'node:crypto';

import { expect, vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { resetEnvForTests } from '#src/env.js';
import {
  verifyHubSpotSignature,
  hubspotWebhookBatches,
} from '#src/integrations/hubspot-webhooks.js';
import type { IntegrationEvent } from '#src/integrations/types.js';
const transport = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
await vi.mock(
  import.meta.resolve('#src/integrations/request.js'),
  async () => ({
    ...(await import('#src/integrations/request.js')),
    providerFetch: () => transport,
  }),
  () => import('#src/integrations/request.js'),
);
const { hubspotProvider } = await import('#src/integrations/providers/hubspot.js');
const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  resetEnvForTests();
  transport.mockReset();
});

describe('HubSpot pipeline capture', () => {
  it('verifies signed batches and rejects expired notifications', () => {
    const now = Date.now(),
      url = 'https://example.test/api/webhooks/hubspot',
      body = '[]',
      secret = 'fixture-only';
    const signature = createHmac('sha256', secret)
      .update('POST' + url + body + String(now))
      .digest('base64');
    const headers = new Headers({
      'x-hubspot-signature-v3': signature,
      'x-hubspot-request-timestamp': String(now),
    });
    expect(verifyHubSpotSignature(secret, url, body, headers, now)).toBe(true);
    expect(verifyHubSpotSignature(secret, url, '{}', headers, now)).toBe(false);
    expect(verifyHubSpotSignature(secret, url, body, headers, now + 300001)).toBe(false);
  });
  it('isolates accounts and coalesces reordered deliveries without retaining property values', () => {
    const first = {
      portalId: 1,
      eventId: 42,
      objectId: 12,
      occurredAt: 123,
      subscriptionType: 'deal.propertyChange',
      propertyName: 'dealstage',
      propertyValue: 'sample',
    };
    const other = { ...first, portalId: 2 };
    const batch = hubspotWebhookBatches([first, other]);
    expect(batch).toHaveLength(2);
    expect(hubspotWebhookBatches([first, first, other])).toEqual(batch);
    expect(JSON.stringify(batch)).not.toContain('sample');
  });
  it('reads the verified portal and scopes when the token grant omits metadata', async () => {
    process.env.HUBSPOT_CLIENT_ID = 'fixture-client';
    process.env.HUBSPOT_CLIENT_SECRET = 'fixture-secret';
    resetEnvForTests();
    transport
      .mockResolvedValueOnce(
        Response.json({ access_token: 'synthetic', refresh_token: 'refresh', expires_in: 1800 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          active: true,
          hub_id: 123,
          client_id: 'fixture-client',
          scopes: ['oauth', 'crm.objects.companies.read', 'crm.objects.deals.read'],
        }),
      );
    const grant = await hubspotProvider.handleOAuthCallback({
      code: 'code',
      redirectUri: 'https://example.test/callback',
    });
    expect(grant.externalAccountId).toBe('123');
    expect(transport.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/oauth/2026-03/token',
      '/oauth/2026-03/token/introspect',
    ]);
  });
  it('reads a selected deal, observes its company, keeps empty stages, and pauses it on exit', async () => {
    const events: IntegrationEvent[] = [],
      saved = new Map<string, unknown>();
    let moved = false;
    const stamp = '2026-07-01T12:00:00.000Z';
    transport.mockImplementation((url, init) => {
      const respond = (value: unknown) => Promise.resolve(Response.json(value));
      const path = new URL(url).pathname;
      if (path === '/crm/v3/pipelines/deals')
        return respond({
          results: [
            {
              id: 'sales',
              label: 'Sales',
              stages: [
                { id: 'new', label: 'New' },
                { id: 'won', label: 'Won' },
              ],
            },
          ],
        });
      if (path.endsWith('/search')) {
        expect(
          typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
        ).toMatchObject({
          filterGroups: [{ filters: [{ propertyName: 'pipeline', value: 'sales' }] }],
        });
        return respond({ results: moved ? [] : [{ id: '12' }] });
      }
      if (path.endsWith('/deals/12'))
        return respond({
          id: '12',
          updatedAt: stamp,
          properties: {
            dealname: 'Renewal',
            pipeline: moved ? 'elsewhere' : 'sales',
            dealstage: 'new',
          },
          associations: { companies: { results: [{ id: '9' }] } },
        });
      if (path.endsWith('/companies/9'))
        return respond({ id: '9', properties: { name: 'Example', domain: 'example.test' } });
      throw new Error('Unexpected provider request');
    });
    const input = {
      integration: { externalAccountId: '123' } as never,
      tokens: {
        hub_id: '123',
        access_token: 'sample',
        refresh_token: 'sample',
        expiresAt: Date.now() + 90000,
      },
      selections: [{ kind: 'hubspot.pipeline', externalId: 'sales' }],
      ctx: {
        loadCursor: (k: string) => Promise.resolve(saved.get(k) ?? {}),
        saveCursor: (k: string, v: unknown) => {
          saved.set(k, v);
          return Promise.resolve();
        },
        writeEvents: (batch: IntegrationEvent[]) => {
          events.push(...batch);
          return Promise.resolve([]);
        },
        recordAudit: vi.fn().mockResolvedValue(undefined),
        persistTokens: vi.fn().mockResolvedValue(undefined),
      },
    };
    await hubspotProvider.incrementalSync(input);
    expect(events[0]?.extra?.hubspot).toMatchObject({
      id: '12',
      companies: [{ id: '9', name: 'Example', domain: 'example.test' }],
    });
    expect(saved.get('hubspot.pipeline:sales')).toMatchObject({
      ids: ['12'],
      stages: { new: 'New', won: 'Won' },
    });
    await hubspotProvider.incrementalSync(input);
    expect(events[1]?.dedupKey).toBe(events[0]?.dedupKey);
    moved = true;
    await hubspotProvider.incrementalSync(input);
    expect(events[2]?.eventType).toBe('deal.left_pipeline');
    expect(JSON.stringify(events[2])).not.toContain('elsewhere');
    expect(saved.get('hubspot.pipeline:sales')).toMatchObject({ ids: [] });
    moved = false;
    await hubspotProvider.incrementalSync(input);
    expect(events[3]?.dedupKey).not.toBe(events[0]?.dedupKey);
    expect(events[3]?.occurredAt.getTime()).toBeGreaterThan(events[2]?.occurredAt.getTime() ?? 0);
    await hubspotProvider.incrementalSync(input);
    expect(events[4]?.dedupKey).toBe(events[3]?.dedupKey);
  });
  it('refreshes on association notifications without an objectId', () => {
    expect(
      hubspotWebhookBatches([
        {
          portalId: 12,
          eventId: 1,
          occurredAt: 1000,
          subscriptionType: 'object.associationChange',
          fromObjectTypeId: '0-3',
          fromObjectId: 4,
          toObjectTypeId: '0-2',
          toObjectId: 8,
        },
      ]),
    ).toMatchObject([{ portal: '12' }]);
  });
  it('refuses tokens for another account before any provider read', async () => {
    await expect(
      hubspotProvider.browseResources(
        { id: 'connection', externalAccountId: '2' },
        {
          hub_id: '1',
          access_token: 'sample',
          refresh_token: 'sample',
          expiresAt: Date.now() + 90000,
        },
      ),
    ).rejects.toThrow('hubspot_account_mismatch');
  });
});
