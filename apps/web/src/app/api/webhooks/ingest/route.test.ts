import { PGlite } from '@electric-sql/pglite';
import {
  artifactClusterMembers,
  artifactClusters,
  ingestWebhookCredentials,
  ingestWebhooks,
  rawEvents,
} from '@timeline/db';
import { hashCredential } from '@timeline/shared/ingest-webhooks';
import * as rateLimit from '@timeline/shared/rate-limit';
import { applyDbMigrations } from '@timeline/shared/test/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RateLimitModule from '@timeline/shared/rate-limit';

const fakes = vi.hoisted(() => ({
  db: null as ReturnType<typeof drizzle> | null,
  enqueueExtractJob: vi.fn(),
  enqueueEmbedJob: vi.fn(),
  enqueueSuggestionJob: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  get db() {
    if (!fakes.db) throw new Error('test db not ready');
    return fakes.db;
  },
}));
vi.mock('@/lib/queue', () => ({
  requireRedisQueue: vi.fn(() => ({
    enqueueExtractJob: fakes.enqueueExtractJob,
    enqueueEmbedJob: fakes.enqueueEmbedJob,
    enqueueSuggestionJob: fakes.enqueueSuggestionJob,
  })),
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: vi.fn() }));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock('@timeline/shared/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@timeline/shared/rate-limit');
  return {
    ...actual,
    checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
  };
});

const { GET, POST } = await import('./route.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'tli_test_ingest_webhook_key_for_route';

async function seed(pg: PGlite, db: ReturnType<typeof drizzle>): Promise<string> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'ingest-team', 'Ingest Team');
    INSERT INTO users (id, email)
    VALUES ('${USER_ID}', 'owner@example.com');
  `);
  const [webhook] = await db
    .insert(ingestWebhooks)
    .values({ teamId: TEAM_ID, ownerUserId: USER_ID, name: 'Pipedrive webhook' })
    .returning();
  if (!webhook) throw new Error('webhook insert failed');
  await db.insert(ingestWebhookCredentials).values({
    teamId: TEAM_ID,
    webhookId: webhook.id,
    createdByUserId: USER_ID,
    keyHash: hashCredential(TOKEN),
    keyPrefix: TOKEN.slice(0, 12),
  });
  return webhook.id;
}

function request(body = '{"event":"deal.updated"}', headers: Record<string, string> = {}): Request {
  return new Request('https://timeline.test/api/webhooks/ingest', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...headers,
    },
    body,
  });
}

describe('/api/webhooks/ingest', () => {
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    fakes.db = db;
    await seed(pg, db);
    fakes.enqueueExtractJob.mockResolvedValue(undefined);
    fakes.enqueueEmbedJob.mockResolvedValue(undefined);
    fakes.enqueueSuggestionJob.mockResolvedValue({ enqueued: true, jobId: 'job' });
  });

  it('accepts GET verification without creating evidence', async () => {
    const response = await GET(
      new Request(`https://timeline.test/api/webhooks/ingest?key=${TOKEN}`),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      name: 'Pipedrive webhook',
    });
    await expect(db.select().from(rawEvents)).resolves.toHaveLength(0);
  });

  it('charges invalid GET verification credentials against the auth-IP lockout bucket', async () => {
    expect(
      (
        await GET(
          new Request('https://timeline.test/api/webhooks/ingest?key=tli_invalid', {
            headers: { 'x-forwarded-for': '203.0.113.42' },
          }),
        )
      ).status,
    ).toBe(401);

    expect(vi.mocked(rateLimit.checkRateLimit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rateLimit.checkRateLimit).mock.calls[0]?.[0]?.key).toContain('auth_ip');
  });

  it('stores textual payloads as ingest_webhook raw events and enqueues processing', async () => {
    const response = await POST(
      request('{"event":"deal.updated","actor":"Maya"}', {
        'x-pipedrive-delivery': 'delivery-1',
        'x-hook-secret': 'do-not-show',
      }),
    );

    expect(response.status).toBe(202);
    const payload = (await response.json()) as { rawEventId: string };
    expect(payload.rawEventId).toBeTruthy();
    const rows = await db.select().from(rawEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      teamId: TEAM_ID,
      source: 'ingest_webhook',
      visibility: 'team',
      visibilityOwnerUserId: USER_ID,
    });
    expect(rows[0]?.contentText).toContain('Ingest webhook: Pipedrive webhook');
    expect(rows[0]?.contentText).toContain('"actor":"Maya"');
    const metadata = rows[0]?.sourceMetadata as Record<string, unknown>;
    expect(metadata.ingest_webhook_name).toBe('Pipedrive webhook');
    expect(metadata.content_type).toBe('application/json');
    expect(metadata.proposal_generation_enabled).toBe(true);
    const requestHeaders = metadata.request_headers as Record<string, unknown>;
    expect(requestHeaders['x-hook-secret']).toBe('[redacted]');
    expect(requestHeaders['x-pipedrive-delivery']).toBe('delivery-1');
    expect(fakes.enqueueExtractJob).toHaveBeenCalledWith({
      rawEventId: payload.rawEventId,
      teamId: TEAM_ID,
    });
    expect(fakes.enqueueEmbedJob).toHaveBeenCalledWith({
      rawEventId: payload.rawEventId,
      teamId: TEAM_ID,
    });
    expect(fakes.enqueueSuggestionJob).toHaveBeenCalledWith({
      rawEventId: payload.rawEventId,
      teamId: TEAM_ID,
    });
    expect(vi.mocked(rateLimit.checkRateLimit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rateLimit.checkRateLimit).mock.calls[0]?.[0]?.key).toContain('credential');
  });

  it('falls back ownerless private webhooks to team-visible evidence', async () => {
    const [webhook] = await db.select().from(ingestWebhooks).limit(1);
    if (!webhook) throw new Error('webhook not seeded');
    await db
      .update(ingestWebhooks)
      .set({ ownerUserId: null, visibilityDefault: 'private' })
      .where(eq(ingestWebhooks.id, webhook.id));

    const response = await POST(request('{"event":"owner.deleted"}'));

    expect(response.status).toBe(202);
    const [event] = await db.select().from(rawEvents);
    expect(event).toMatchObject({
      source: 'ingest_webhook',
      visibility: 'team',
      visibilityOwnerUserId: null,
    });
  });

  it('charges only invalid credentials against the auth-IP lockout bucket', async () => {
    expect(
      (
        await POST(
          new Request('https://timeline.test/api/webhooks/ingest', {
            method: 'POST',
            headers: {
              authorization: 'Bearer tli_invalid',
              'content-type': 'application/json',
              'x-forwarded-for': '203.0.113.42',
            },
            body: '{}',
          }),
        )
      ).status,
    ).toBe(401);

    expect(vi.mocked(rateLimit.checkRateLimit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rateLimit.checkRateLimit).mock.calls[0]?.[0]?.key).toContain('auth_ip');
  });

  it('deduplicates identical deliveries from the same webhook day and re-enqueues processing', async () => {
    expect((await POST(request())).status).toBe(202);
    const duplicate = await POST(request());
    expect(duplicate.status).toBe(200);
    const duplicateBody = (await duplicate.json()) as {
      ok: boolean;
      status: string;
      rawEventId: string | null;
    };
    expect(duplicateBody).toMatchObject({ ok: true, status: 'duplicate' });
    expect(typeof duplicateBody.rawEventId).toBe('string');
    await expect(db.select().from(rawEvents)).resolves.toHaveLength(1);
    expect(fakes.enqueueExtractJob).toHaveBeenCalledTimes(2);
    expect(fakes.enqueueEmbedJob).toHaveBeenCalledTimes(2);
    expect(fakes.enqueueSuggestionJob).toHaveBeenCalledTimes(2);
  });

  it('creates and repairs link artifacts from webhook text payloads', async () => {
    const body = '{"event":"deal.updated","url":"https://example.com/deals/42?utm_source=crm"}';
    const first = await POST(request(body, { 'content-type': 'application/json' }));
    expect(first.status).toBe(202);
    const firstPayload = (await first.json()) as { rawEventId: string };

    const [event] = await db.select().from(rawEvents);
    expect(event?.sourceMetadata).toMatchObject({
      links: [
        expect.objectContaining({
          canonical_url: 'https://example.com/deals/42',
          display_url: 'example.com/deals/42',
        }),
      ],
    });
    await expect(db.select().from(artifactClusters)).resolves.toEqual([
      expect.objectContaining({
        artifactType: 'link',
        canonicalName: 'example.com/deals/42',
      }),
    ]);

    await db.delete(artifactClusters);
    await expect(db.select().from(artifactClusterMembers)).resolves.toHaveLength(0);

    const duplicate = await POST(request(body, { 'content-type': 'application/json' }));
    expect(duplicate.status).toBe(200);
    const duplicatePayload = (await duplicate.json()) as { rawEventId: string | null };
    expect(duplicatePayload.rawEventId).toBe(firstPayload.rawEventId);
    await expect(db.select().from(artifactClusters)).resolves.toEqual([
      expect.objectContaining({
        artifactType: 'link',
        canonicalName: 'example.com/deals/42',
      }),
    ]);
    await expect(db.select().from(artifactClusterMembers)).resolves.toEqual([
      expect.objectContaining({ rawEventId: firstPayload.rawEventId }),
    ]);
  });

  it('rejects missing credentials, oversized bodies, and unsupported media types', async () => {
    expect((await POST(new Request('https://timeline.test/api/webhooks/ingest'))).status).toBe(401);
    expect((await POST(request('pdf', { 'content-type': 'application/pdf' }))).status).toBe(415);
    expect(
      (
        await POST(
          request('', {
            'content-length': String(1024 * 1024 + 1),
          }),
        )
      ).status,
    ).toBe(413);
  });

  it('rejects streaming bodies once the actual payload exceeds the byte cap', async () => {
    const encoder = new TextEncoder();
    const response = await POST(
      new Request('https://timeline.test/api/webhooks/ingest', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'text/plain',
        },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('x'.repeat(1024 * 1024)));
            controller.enqueue(encoder.encode('x'));
            controller.close();
          },
        }),
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }),
    );

    expect(response.status).toBe(413);
    await expect(db.select().from(rawEvents)).resolves.toHaveLength(0);
  });
});
