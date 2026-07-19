import { PGlite } from '@electric-sql/pglite';
import { auditLog, ingestWebhookCredentials, ingestWebhooks, type Db } from '@timeline/db';
import { applyDbMigrations } from '@timeline/shared/test/pglite';
import { eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  db: null as ReturnType<typeof drizzle> | null,
}));

vi.mock('@/lib/db', () => ({
  get db() {
    if (!fakes.db) throw new Error('test db not ready');
    return fakes.db as unknown as Db;
  },
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({ requireMembership: fakes.requireMembership }),
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: vi.fn() }));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const indexRoute = await import('./route.js');
const itemRoute = await import('./[id]/route.js');
const credentialsRoute = await import('./[id]/credentials/route.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function request(body: unknown): Request {
  return new Request('https://timeline.test/api/team/ingest-webhooks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('/api/team/ingest-webhooks', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    vi.clearAllMocks();
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    fakes.db = db;
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${TEAM_ID}', 'team', 'Team');
      INSERT INTO users (id, email)
      VALUES ('${USER_ID}', 'owner@example.com');
    `);
    fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
    fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
    fakes.requireMembership.mockResolvedValue('admin');
  }, 30_000);

  afterEach(async () => {
    fakes.db = null;
    await pg.close();
  });

  it('guards admin access', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    expect((await indexRoute.GET()).status).toBe(401);

    fakes.requireMembership.mockRejectedValueOnce(new Error('member'));
    expect((await indexRoute.POST(request({ name: 'Pipedrive webhook' }))).status).toBe(403);
  });

  it('creates a named webhook with one plaintext credential and audit row', async () => {
    const response = await indexRoute.POST(
      request({
        name: 'Pipedrive webhook',
        visibilityDefault: 'private',
        proposalGenerationEnabled: false,
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      credential: { plaintext: string; prefix: string };
    };
    expect(body.credential.plaintext).toMatch(/^tli_/);
    const [webhook] = await db.select().from(ingestWebhooks);
    expect(webhook).toMatchObject({
      id: body.id,
      name: 'Pipedrive webhook',
      visibilityDefault: 'private',
      proposalGenerationEnabled: false,
      ownerUserId: USER_ID,
    });
    const [credential] = await db.select().from(ingestWebhookCredentials);
    expect(credential).toMatchObject({
      teamId: TEAM_ID,
      webhookId: body.id,
      keyPrefix: body.credential.prefix,
    });
    const [audit] = await db.select().from(auditLog);
    expect(audit).toMatchObject({
      action: 'ingest_webhook.create',
      targetType: 'ingest_webhook',
      targetId: body.id,
    });
  });

  it('lists only non-secret credential metadata', async () => {
    const created = await indexRoute.POST(request({ name: 'Pipedrive webhook' }));
    expect(created.status).toBe(200);

    const response = await indexRoute.GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      webhooks: { name: string; credentials: { prefix: string }[] }[];
    };
    expect(body.webhooks).toHaveLength(1);
    expect(body.webhooks[0]?.name).toBe('Pipedrive webhook');
    expect(body.webhooks[0]?.credentials[0]?.prefix).toMatch(/^tli_/);
    expect(JSON.stringify(body)).not.toContain('plaintext');
    expect(JSON.stringify(body)).not.toContain('keyHash');
  });

  it('updates settings, disables sources, and rotates credentials', async () => {
    const created = (await (
      await indexRoute.POST(request({ name: 'Pipedrive webhook' }))
    ).json()) as { id: string };

    const patch = await itemRoute.PATCH(
      request({ name: 'Pipedrive CRM', proposalGenerationEnabled: false }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(patch.status).toBe(200);
    await expect(
      db.select().from(ingestWebhooks).where(eq(ingestWebhooks.id, created.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        name: 'Pipedrive CRM',
        proposalGenerationEnabled: false,
      }),
    ]);

    const rotate = await credentialsRoute.POST(new Request('https://timeline.test'), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(rotate.status).toBe(200);
    const activeCredentials = await db
      .select()
      .from(ingestWebhookCredentials)
      .where(isNull(ingestWebhookCredentials.revokedAt));
    expect(activeCredentials).toHaveLength(1);

    const softDisable = await itemRoute.PATCH(request({ disabled: true }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(softDisable.status).toBe(200);
    const activeAfterSoftDisable = await db
      .select()
      .from(ingestWebhookCredentials)
      .where(isNull(ingestWebhookCredentials.revokedAt));
    expect(activeAfterSoftDisable).toHaveLength(0);

    const reenable = await itemRoute.PATCH(request({ disabled: false }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(reenable.status).toBe(200);
    const reenableBody = (await reenable.json()) as {
      credential?: { plaintext: string; prefix: string };
    };
    expect(reenableBody.credential?.plaintext).toMatch(/^tli_/);
    const activeAfterReenable = await db
      .select()
      .from(ingestWebhookCredentials)
      .where(isNull(ingestWebhookCredentials.revokedAt));
    expect(activeAfterReenable).toHaveLength(1);
    expect(activeAfterReenable[0]?.keyPrefix).toBe(reenableBody.credential?.prefix);
    const [reenabledWebhook] = await db
      .select()
      .from(ingestWebhooks)
      .where(eq(ingestWebhooks.id, created.id));
    expect(reenabledWebhook?.disabledAt).toBeNull();

    const disable = await itemRoute.DELETE(new Request('https://timeline.test'), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(disable.status).toBe(200);
    const [webhook] = await db.select().from(ingestWebhooks);
    expect(webhook?.disabledAt).toBeInstanceOf(Date);
  });
});
