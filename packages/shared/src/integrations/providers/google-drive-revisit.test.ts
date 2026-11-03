import { PGlite } from '@electric-sql/pglite';
import { googleDriveFileSnapshots, integrations, rawEvents } from '@timeline/db';
import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import type { IntegrationEvent, SyncContext } from '#src/integrations/types.js';

await vi.mock(
  import.meta.resolve('#src/queue/queues.js'),
  async () => ({
    ...(await import('#src/queue/queues.js')),
    enqueueExtractJob: vi.fn().mockResolvedValue(undefined),
    enqueueEmbedJob: vi.fn().mockResolvedValue(undefined),
    enqueueSuggestionJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'proposal-job' }),
  }),
  () => import('#src/queue/queues.js'),
);

const externalFetchMock = vi.hoisted(() =>
  vi.fn(
    (
      input: string | URL,
      init?: RequestInit,
      _options?: { maxResponseBytes?: number },
    ): Promise<Response> => globalThis.fetch(input, init),
  ),
);

await vi.mock(
  import.meta.resolve('#src/http/external-fetch.js'),
  async () => ({
    ...(await import('#src/http/external-fetch.js')),
    externalFetch: externalFetchMock,
  }),
  () => import('#src/http/external-fetch.js'),
);

const { resetEnvForTests } = await import('#src/env.js');
const { googleDriveProvider } = await import('#src/integrations/providers/google-drive.js');
const { driveFileChangeDedupKey, hashDrivePayload, loadLatestDriveSnapshot } =
  await import('#src/integrations/google-drive-capture.js');
const { writeIntegrationEvents } = await import('#src/integrations/event-writer.js');
const { enqueueEmbedJob, enqueueExtractJob, enqueueSuggestionJob } =
  await import('#src/queue/queues.js');
const { withTeam } = await import('#src/team-scope.js');
const { applyDbMigrations } = await import('#src/test/pglite.js');

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEXT_A = 'Northstar SOW signed at forty eight thousand dollars annually.';
const TEXT_B = 'Northstar SOW signed at seventy two thousand dollars annually.';

const ORIGINAL_ENV = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function requestUrl(
  input: Parameters<
    (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
  >[0],
): URL {
  return new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
  );
}

describe('Drive A→B→A→B revisit', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    vi.clearAllMocks();
    externalFetchMock.mockReset();
    externalFetchMock.mockImplementation((input, init) => globalThis.fetch(input, init));
    process.env.GOOGLE_CLIENT_ID = 'google-client';
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
    resetEnvForTests();
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'team-a', 'Team A');
      INSERT INTO users (id, email) VALUES ('${USER_ID}', 'owner@example.com');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_ID}', '${USER_ID}', 'owner');
    `);
  }, 60_000);

  afterEach(async () => {
    if (ORIGINAL_ENV.GOOGLE_CLIENT_ID === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = ORIGINAL_ENV.GOOGLE_CLIENT_ID;
    if (ORIGINAL_ENV.GOOGLE_CLIENT_SECRET === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = ORIGINAL_ENV.GOOGLE_CLIENT_SECRET;
    resetEnvForTests();
    vi.unstubAllGlobals();
    await pg.close();
  });

  it('emits a new event for each genuine return to B while retries stay idempotent', async () => {
    const [inserted] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-revisit',
        visibilityDefault: 'team',
      })
      .returning();
    if (!inserted) throw new Error('integration insert failed');
    const integration = inserted;

    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    let current = { text: TEXT_A, revision: 'rev-a1', modifiedTime: '2026-06-20T10:00:00.000Z' };
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.includes('/export')) {
        return Promise.resolve(new Response(current.text, { status: 200 }));
      }
      if (url.pathname.endsWith('/files/file-1')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'SOW',
            mimeType: 'application/vnd.google-apps.document',
            parents: ['root'],
            headRevisionId: current.revision,
            modifiedTime: current.modifiedTime,
          }),
        );
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments: [] }));
      }
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);

    const consumeTransientDriveExtract = vi.fn().mockResolvedValue(undefined);
    const ctx: Pick<
      SyncContext,
      | 'loadCursor'
      | 'saveCursor'
      | 'writeEvents'
      | 'persistTokens'
      | 'recordAudit'
      | 'scheduleTargetedSync'
      | 'loadLatestDriveSnapshot'
      | 'saveDriveSnapshot'
      | 'listTeamEmailDomains'
      | 'judgeDriveChange'
      | 'enqueueTransientDriveExtract'
      | 'loadTransientDriveExtract'
      | 'consumeTransientDriveExtract'
      | 'takeDriveExtractSlot'
    > = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: (events: IntegrationEvent[]) =>
        writeIntegrationEvents({ db: db as never, integration, events }),
      persistTokens: vi.fn(),
      recordAudit: vi.fn().mockResolvedValue(undefined),
      scheduleTargetedSync: vi.fn().mockResolvedValue(undefined),
      loadLatestDriveSnapshot: (fileId) =>
        scope.integrations.loadLatestDriveSnapshot(integration.id, fileId),
      saveDriveSnapshot: (input) =>
        scope.integrations.saveDriveSnapshot(integration.id, input.fileId, {
          contentHash: input.contentHash,
          snapshotText: input.snapshotText,
          commentsHash: input.commentsHash ?? '',
          permissionsHash: input.permissionsHash ?? '',
          mimeType: input.mimeType,
          commentsSnapshot: Array.isArray(input.commentsSnapshot) ? input.commentsSnapshot : [],
        }),
      listTeamEmailDomains: vi.fn().mockResolvedValue(['acme.test']),
      judgeDriveChange: vi.fn().mockResolvedValue({
        matters: true,
        reason: 'crm_update',
        summary: 'Pricing section changed',
      }),
      enqueueTransientDriveExtract: vi.fn().mockResolvedValue(undefined),
      loadTransientDriveExtract: vi.fn().mockResolvedValue(null),
      consumeTransientDriveExtract,
      takeDriveExtractSlot: vi.fn().mockResolvedValue({ allowed: true }),
    };

    async function capture(next: typeof current): Promise<void> {
      current = next;
      await googleDriveProvider.incrementalSync({
        integration,
        tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
        selections: [{ kind: 'drive.file', externalId: 'file-1' }],
        ctx,
        target: { resourceType: 'drive.file', externalId: 'file-1' },
      });
    }

    await capture({
      text: TEXT_A,
      revision: 'rev-a1',
      modifiedTime: '2026-06-20T10:00:00.000Z',
    });
    expect(await db.select().from(rawEvents)).toHaveLength(0);
    expect(
      await loadLatestDriveSnapshot(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        fileId: 'file-1',
      }),
    ).toMatchObject({ contentHash: hashDrivePayload(TEXT_A) });

    await capture({
      text: TEXT_B,
      revision: 'rev-b1',
      modifiedTime: '2026-06-20T11:00:00.000Z',
    });
    await capture({
      text: TEXT_A,
      revision: 'rev-a2',
      modifiedTime: '2026-06-20T12:00:00.000Z',
    });
    await capture({
      text: TEXT_B,
      revision: 'rev-b2',
      modifiedTime: '2026-06-20T13:00:00.000Z',
    });

    const events = await db.select().from(rawEvents);
    expect(events).toHaveLength(3);
    const dedupKeys = events.map((row) => {
      const metadata = row.sourceMetadata as { dedup_key?: string };
      return metadata.dedup_key;
    });
    const commentsHash = hashDrivePayload('[]');
    const permissionsHash = hashDrivePayload('[]');
    expect(new Set(dedupKeys).size).toBe(3);
    expect([...dedupKeys].sort()).toEqual(
      [
        driveFileChangeDedupKey({
          fileId: 'file-1',
          occurrence: 'rev:rev-b1',
          contentHash: hashDrivePayload(TEXT_B),
          commentsHash,
          permissionsHash,
        }),
        driveFileChangeDedupKey({
          fileId: 'file-1',
          occurrence: 'rev:rev-a2',
          contentHash: hashDrivePayload(TEXT_A),
          commentsHash,
          permissionsHash,
        }),
        driveFileChangeDedupKey({
          fileId: 'file-1',
          occurrence: 'rev:rev-b2',
          contentHash: hashDrivePayload(TEXT_B),
          commentsHash,
          permissionsHash,
        }),
      ].sort(),
    );
    expect(events.map((row) => row.contentText).join('\n')).toContain('seventy two thousand');
    expect(events.map((row) => row.contentText).join('\n')).toContain('forty eight thousand');
    expect(
      await loadLatestDriveSnapshot(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        fileId: 'file-1',
      }),
    ).toMatchObject({ contentHash: hashDrivePayload(TEXT_B) });
    expect(await db.select().from(googleDriveFileSnapshots)).toHaveLength(2);

    expect(enqueueExtractJob).toHaveBeenCalledTimes(3);
    expect(enqueueEmbedJob).toHaveBeenCalledTimes(3);
    const extractIds = (
      enqueueExtractJob as unknown as { mock: { calls: [{ rawEventId: string }][] } }
    ).mock.calls
      .map(([input]) => input.rawEventId)
      .sort();
    expect(new Set(extractIds).size).toBe(3);
    expect(events.every((row) => row.sourceMetadata)).toEqual(true);
    for (const row of events) {
      expect(row.sourceMetadata).toMatchObject({ signal_class: 'communication' });
      expect(row.sourceMetadata).not.toHaveProperty('extraction_skipped_reason');
    }
    // Drive suggestions follow event extract; event-writer only enqueues extract/embed.
    expect(enqueueSuggestionJob).not.toHaveBeenCalled();

    await capture({
      text: TEXT_B,
      revision: 'rev-b2',
      modifiedTime: '2026-06-20T13:00:00.000Z',
    });
    expect(await db.select().from(rawEvents)).toHaveLength(3);
    expect(enqueueExtractJob).toHaveBeenCalledTimes(3);
    expect(ctx.judgeDriveChange).toHaveBeenCalledTimes(3);
  });
});
