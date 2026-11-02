import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type { IntegrationEvent, SyncContext } from '#src/integrations/types.js';

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
const { DRIVE_FILE_DEBOUNCE_MS } = await import('#src/integrations/google-drive-capture.js');

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

function syncContext(
  overrides: Partial<SyncContext> = {},
): Pick<
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
  | 'extractBinaryText'
> &
  Partial<SyncContext> {
  return {
    loadCursor: vi.fn().mockResolvedValue({}),
    saveCursor: vi.fn().mockResolvedValue(undefined),
    writeEvents: vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]),
    persistTokens: vi.fn(),
    recordAudit: vi.fn().mockResolvedValue(undefined),
    scheduleTargetedSync: vi.fn().mockResolvedValue(undefined),
    loadLatestDriveSnapshot: vi.fn().mockResolvedValue(null),
    saveDriveSnapshot: vi.fn().mockResolvedValue(undefined),
    listTeamEmailDomains: vi.fn().mockResolvedValue(['acme.test']),
    judgeDriveChange: vi.fn().mockResolvedValue({
      matters: true,
      reason: 'crm_update',
      summary: 'Pricing section changed',
    }),
    extractBinaryText: vi.fn().mockResolvedValue({ text: 'Extracted PDF text for the contract.' }),
    ...overrides,
  };
}

describe('googleDriveProvider', () => {
  beforeEach(() => {
    externalFetchMock.mockReset();
    externalFetchMock.mockImplementation((input, init) => globalThis.fetch(input, init));
    process.env.GOOGLE_CLIENT_ID = 'google-client';
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
    resetEnvForTests();
  });

  afterEach(() => {
    if (ORIGINAL_ENV.GOOGLE_CLIENT_ID === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = ORIGINAL_ENV.GOOGLE_CLIENT_ID;
    if (ORIGINAL_ENV.GOOGLE_CLIENT_SECRET === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = ORIGINAL_ENV.GOOGLE_CLIENT_SECRET;
    resetEnvForTests();
    vi.unstubAllGlobals();
  });

  it('propagates a resource-picker quota pause instead of returning an incomplete success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: 'rate limited' },
            { status: 429, headers: { 'retry-after': '120' } },
          ),
        ),
    );
    await expect(
      googleDriveProvider.listSyncableResources({ id: 'i' } as never, {
        access_token: 'token',
        expires_at: Date.now() + 600_000,
      }),
    ).rejects.toMatchObject({ provider: 'google_drive', retryAfterSeconds: 120 });
  });

  it('builds a Google OAuth authorize URL', async () => {
    const { authorizeUrl } = await googleDriveProvider.startOAuth({
      teamId: 'team-1',
      userId: 'user-1',
      state: 'state-token',
      redirectUri: 'https://timeline.test/api/integrations/google-drive/callback',
    });

    const url = new URL(authorizeUrl);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('google-client');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://timeline.test/api/integrations/google-drive/callback',
    );
    expect(url.searchParams.get('state')).toBe('state-token');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'openid',
      'email',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    ]);
    expect(url.searchParams.get('access_type')).toBe('offline');
  });

  it('exchanges an OAuth code and resolves the stable Google subject id', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'drive-scope',
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ sub: 'google-sub-1', email: 'ada@example.com' }));
    vi.stubGlobal('fetch', fetch);

    const result = await googleDriveProvider.handleOAuthCallback({
      code: 'auth-code',
      redirectUri: 'https://timeline.test/callback',
    });

    expect(result).toMatchObject({
      externalAccountId: 'google-sub-1',
      displayName: 'Google Drive — ada@example.com',
      tokens: { access_token: 'access-token', refresh_token: 'refresh-token', sub: 'google-sub-1' },
    });
    const tokenRequest = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(tokenRequest.body).toEqual(expect.stringContaining('grant_type=authorization_code'));
  });

  it('fails OAuth when userinfo does not return a subject id', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ access_token: 'access-token', expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse({ email: 'ada@example.com' })),
    );

    await expect(
      googleDriveProvider.handleOAuthCallback({
        code: 'auth-code',
        redirectUri: 'https://timeline.test/callback',
      }),
    ).rejects.toThrow('google_userinfo_lookup_failed');
  });

  it('lists My Drive plus shared drives using the current access token', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        drives: [
          { id: 'drive-1', name: 'Engineering' },
          { id: 'drive-2', name: 'Launch' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);

    const resources = await googleDriveProvider.listSyncableResources(
      { id: 'integration-1' } as never,
      { access_token: 'access-token', expires_at: Date.now() + 600_000 },
    );

    expect(resources).toEqual([
      { externalId: 'root', label: 'My Drive (root)', kind: 'drive.folder' },
      { externalId: 'drive-1', label: 'Engineering', kind: 'drive.shared_drive' },
      { externalId: 'drive-2', label: 'Launch', kind: 'drive.shared_drive' },
    ]);
  });

  it('lists folder children and includeIds for the source picker', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/files') && url.searchParams.get('q')?.includes('folder-1')) {
        return Promise.resolve(
          jsonResponse({
            files: [
              {
                id: 'doc-1',
                name: 'SOW',
                mimeType: 'application/vnd.google-apps.document',
                parents: ['folder-1'],
              },
              {
                id: 'nested',
                name: 'Nested',
                mimeType: 'application/vnd.google-apps.folder',
                parents: ['folder-1'],
              },
            ],
          }),
        );
      }
      if (url.pathname.endsWith('/files/file-9')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-9',
            name: 'Kept',
            mimeType: 'application/vnd.google-apps.document',
          }),
        );
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetch);

    const children = await googleDriveProvider.listSyncableResources(
      { id: 'integration-1' } as never,
      { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      {
        persistTokens: vi.fn(),
        parentId: 'folder-1',
      },
    );
    expect(children).toEqual([
      { externalId: 'doc-1', label: 'SOW', kind: 'drive.file' },
      { externalId: 'nested', label: 'Nested', kind: 'drive.folder' },
    ]);

    const included = await googleDriveProvider.listSyncableResources(
      { id: 'integration-1' } as never,
      { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      {
        persistTokens: vi.fn(),
        includeIds: [{ kind: 'drive.file', externalId: 'file-9' }],
      },
    );
    expect(included).toEqual([{ externalId: 'file-9', label: 'Kept', kind: 'drive.file' }]);
  });

  it('does not sync Drive changes until folders, files, or shared drives are selected', async () => {
    const ctx = syncContext();
    await googleDriveProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [],
      ctx: ctx,
    });
    expect(ctx.loadCursor).not.toHaveBeenCalled();
    expect(ctx.writeEvents).not.toHaveBeenCalled();
  });

  it('backfill only stores a start page token and does not enumerate historical files', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ startPageToken: 'start-9' }));
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext();
    await googleDriveProvider.backfill({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.folder', externalId: 'root' }],
      ctx: ctx,
    });
    expect(ctx.saveCursor).toHaveBeenCalledWith('drive.changes', { page_token: 'start-9' });
    expect(ctx.scheduleTargetedSync).not.toHaveBeenCalled();
    expect(ctx.writeEvents).not.toHaveBeenCalled();
  });

  it('schedules delayed per-file capture from the Drive changes feed', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/changes')) {
        const pageToken = url.searchParams.get('pageToken');
        expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true');
        if (pageToken === 'page-1') {
          return Promise.resolve(
            jsonResponse({
              changes: [
                {
                  changeType: 'file',
                  time: '2026-06-20T10:00:00.000Z',
                  fileId: 'file-1',
                  file: {
                    id: 'file-1',
                    name: 'Roadmap',
                    mimeType: 'application/vnd.google-apps.document',
                    modifiedTime: '2026-06-20T10:00:00.000Z',
                    parents: ['root'],
                    owners: [{ displayName: 'Ada', emailAddress: 'ada@example.com' }],
                  },
                },
              ],
              nextPageToken: 'page-2',
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            changes: [
              {
                changeType: 'file',
                time: '2026-06-20T10:05:00.000Z',
                fileId: 'file-2',
                file: {
                  id: 'file-2',
                  name: 'Notes',
                  mimeType: 'text/plain',
                  parents: ['root'],
                },
              },
              {
                changeType: 'file',
                time: '2026-06-20T10:06:00.000Z',
                fileId: 'file-3',
                file: {
                  id: 'file-3',
                  name: 'In scope doc',
                  mimeType: 'application/vnd.google-apps.document',
                  parents: ['root'],
                },
              },
            ],
            newStartPageToken: 'page-3',
          }),
        );
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadCursor: vi.fn().mockResolvedValue({ page_token: 'page-1' }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.folder', externalId: 'root' }],
      ctx: ctx,
    });

    expect(ctx.writeEvents).not.toHaveBeenCalled();
    expect(ctx.scheduleTargetedSync).toHaveBeenCalledTimes(2);
    expect(ctx.scheduleTargetedSync).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'drive.file',
        externalId: 'file-1',
        reason: 'drive_watch',
      }),
      expect.objectContaining({ delayMs: DRIVE_FILE_DEBOUNCE_MS, replaceDelayed: true }),
    );
    expect(ctx.scheduleTargetedSync).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'file-3' }),
      expect.objectContaining({ replaceDelayed: true }),
    );
    expect(ctx.saveCursor).toHaveBeenCalledWith('drive.changes', { page_token: 'page-3' });
  });

  it('does not admit Shared with me files when My Drive root is selected', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/changes')) {
        return Promise.resolve(
          jsonResponse({
            changes: [
              {
                fileId: 'shared-file',
                file: {
                  id: 'shared-file',
                  name: 'Outside',
                  mimeType: 'application/vnd.google-apps.document',
                  parents: ['someone-else-folder'],
                },
              },
            ],
            newStartPageToken: 'page-2',
          }),
        );
      }
      if (url.pathname.endsWith('/files/someone-else-folder')) {
        return Promise.resolve(jsonResponse({ message: 'not found' }, { status: 404 }));
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadCursor: vi.fn().mockResolvedValue({ page_token: 'page-1' }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.folder', externalId: 'root' }],
      ctx: ctx,
    });

    expect(ctx.scheduleTargetedSync).not.toHaveBeenCalled();
  });

  it('uses the provider 20 MB cap when downloading Drive file bodies', async () => {
    const body = Buffer.from('Contract amount is forty eight thousand dollars for Northstar.');
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/files/file-1') && !url.pathname.includes('export')) {
        if (url.searchParams.get('alt') === 'media') {
          return Promise.resolve(new Response(body, { status: 200 }));
        }
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'Notes',
            mimeType: 'application/pdf',
            parents: ['root'],
            modifiedTime: '2026-06-20T10:00:00.000Z',
          }),
        );
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments: [] }));
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadLatestDriveSnapshot: vi.fn().mockResolvedValue({
        contentHash: 'old',
        snapshotText: 'Prior snapshot text that is different enough to count.',
        commentsHash: 'old-comments',
        permissionsHash: 'old-permissions',
        mimeType: 'application/pdf',
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    const downloadCall = externalFetchMock.mock.calls.find(
      ([input]) => requestUrl(input).searchParams.get('alt') === 'media',
    );
    expect(downloadCall?.[2]).toMatchObject({ maxResponseBytes: 20 * 1024 * 1024 });
    expect(ctx.extractBinaryText).toHaveBeenCalledOnce();
    const events: IntegrationEvent[] = (
      ctx.writeEvents as unknown as { mock: { calls: [IntegrationEvent[]][] } }
    ).mock.calls.flatMap(([batch]) => batch);
    expect(events[0]).toMatchObject({
      provider: 'google_drive',
      signalClass: 'communication',
      eventClass: 'communication',
      eventType: 'file.changed',
    });
    expect(ctx.saveCursor).toHaveBeenCalledWith('drive.debounce.file-1', {});
    expect(events[0]?.contentText).not.toContain('ya29.');
  });

  it('audits Drive bodies that exceed the download cap as skipped instead of failed', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/files/file-1')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'Oversized notes',
            mimeType: 'application/pdf',
            parents: ['root'],
          }),
        );
      }
      if (url.pathname.endsWith('/comments'))
        return Promise.resolve(jsonResponse({ comments: [] }));
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetch);
    externalFetchMock.mockImplementation((input, init) => {
      if (requestUrl(input).searchParams.get('alt') === 'media') {
        return Promise.reject(
          Object.assign(new Error('External response exceeded 20971520 bytes'), {
            code: 'response_too_large',
          }),
        );
      }
      return globalThis.fetch(input, init);
    });
    const ctx = syncContext();

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.writeEvents).not.toHaveBeenCalled();
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_extract_skipped',
      expect.objectContaining({ file_id: 'file-1', reason: 'too_large_or_unsupported' }),
    );
  });

  it('saves a baseline snapshot without calling the judge', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.includes('/export')) {
        return Promise.resolve(new Response('Initial contract draft', { status: 200 }));
      }
      if (url.pathname.endsWith('/files/file-1')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'SOW',
            mimeType: 'application/vnd.google-apps.document',
            parents: ['root'],
          }),
        );
      }
      if (url.pathname.endsWith('/comments'))
        return Promise.resolve(jsonResponse({ comments: [] }));
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext();

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.folder', externalId: 'root' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.saveDriveSnapshot).toHaveBeenCalledOnce();
    expect(ctx.judgeDriveChange).not.toHaveBeenCalled();
    expect(ctx.writeEvents).not.toHaveBeenCalled();
    expect(ctx.saveCursor).toHaveBeenCalledWith('drive.debounce.file-1', {});
  });

  it('persists a Drive changes resume token when the page safety cap is hit', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/changes')) {
        const page = Number(url.searchParams.get('pageToken')?.replace('page-', '') ?? '1');
        return Promise.resolve(
          jsonResponse({
            changes: [],
            nextPageToken: `page-${String(page + 1)}`,
          }),
        );
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadCursor: vi.fn().mockResolvedValue({ page_token: 'page-1' }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.folder', externalId: 'root' }],
      ctx: ctx,
    });

    const changeCalls = fetch.mock.calls
      .map(([input]) => requestUrl(input))
      .filter((url) => url.pathname.endsWith('/changes'));
    expect(changeCalls).toHaveLength(50);
    expect(ctx.writeEvents).not.toHaveBeenCalled();
    expect(ctx.saveCursor).toHaveBeenCalledWith('drive.changes', { page_token: 'page-51' });
    expect(ctx.recordAudit).toHaveBeenCalledWith('drive_page_cap_hit', {
      integration_id: 'integration-1',
      next_page_token: 'page-51',
    });
  });

  it('enqueues a targeted drive.changes job from push notifications and ignores the sync handshake', async () => {
    await expect(
      googleDriveProvider.handleWebhook?.({
        integration: { id: 'integration-1', teamId: 'team-1' } as never,
        payload: { headers: { resourceState: 'sync' } },
      }),
    ).resolves.toEqual({ events: [], syncTasks: [], syncTaskDisposition: 'handled' });

    await expect(
      googleDriveProvider.handleWebhook?.({
        integration: { id: 'integration-1', teamId: 'team-1' } as never,
        payload: { headers: { resourceState: 'change' } },
      }),
    ).resolves.toEqual({
      events: [],
      syncTaskDisposition: 'handled',
      syncTasks: [
        {
          integrationId: 'integration-1',
          teamId: 'team-1',
          triggeredBy: 'webhook',
          resourceType: 'drive.changes',
          externalId: 'integration-1',
          reason: 'drive_watch',
        },
      ],
    });
  });
});
