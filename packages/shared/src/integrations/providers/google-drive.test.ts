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
const { DRIVE_FILE_DEBOUNCE_MS, hashDrivePayload } =
  await import('#src/integrations/google-drive-capture.js');
const { DRIVE_BEYOND_SNAPSHOT_HUNK, DRIVE_SNAPSHOT_MAX_CHARS } =
  await import('#src/integrations/google-drive-diff.js');

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

function driveCommentsHash(
  comments: {
    id: string;
    content?: string;
    resolved?: boolean;
    modifiedTime?: string;
  }[],
): string {
  return hashDrivePayload(
    JSON.stringify(
      comments.map((comment) => ({
        id: comment.id,
        resolved: Boolean(comment.resolved),
        modified: comment.modifiedTime ?? '',
        content: hashDrivePayload(comment.content ?? ''),
      })),
    ),
  );
}

function drivePermissionsHash(
  permissions: {
    id?: string;
    type?: string;
    role?: string;
    emailAddress?: string;
    domain?: string;
  }[],
): string {
  return hashDrivePayload(
    JSON.stringify(
      permissions.map((permission) => ({
        id: permission.id ?? '',
        type: permission.type ?? '',
        role: permission.role ?? '',
        email: permission.emailAddress ?? '',
        domain: permission.domain ?? '',
      })),
    ),
  );
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
  | 'enqueueTransientDriveExtract'
  | 'loadTransientDriveExtract'
  | 'consumeTransientDriveExtract'
  | 'takeDriveExtractSlot'
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
    enqueueTransientDriveExtract: vi.fn().mockResolvedValue(undefined),
    loadTransientDriveExtract: vi.fn().mockResolvedValue(null),
    consumeTransientDriveExtract: vi.fn().mockResolvedValue(undefined),
    takeDriveExtractSlot: vi.fn().mockResolvedValue({ allowed: true }),
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

  it('attaches the current Drive file target when capture hits a quota pause', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: 'rate limited' },
            { status: 429, headers: { 'retry-after': '60' } },
          ),
        ),
    );
    const ctx = syncContext();

    await expect(
      googleDriveProvider.incrementalSync({
        integration: { id: 'integration-1', teamId: 'team-1' } as never,
        tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
        selections: [{ kind: 'drive.file', externalId: 'file-1' }],
        ctx,
        target: { resourceType: 'drive.file', externalId: 'file-1' },
      }),
    ).rejects.toMatchObject({
      provider: 'google_drive',
      syncContinuations: [{ resourceType: 'drive.file', externalId: 'file-1' }],
    });
  });

  it('attaches the current Drive file target when token refresh is rate-limited', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: 'rate limited' },
            { status: 429, headers: { 'retry-after': '90' } },
          ),
        ),
    );
    const ctx = syncContext();

    await expect(
      googleDriveProvider.incrementalSync({
        integration: { id: 'integration-1', teamId: 'team-1' } as never,
        tokens: {
          access_token: 'expired-token',
          refresh_token: 'refresh-token',
          expires_at: Date.now() - 10_000,
        },
        selections: [{ kind: 'drive.file', externalId: 'file-1' }],
        ctx,
        target: { resourceType: 'drive.file', externalId: 'file-1' },
      }),
    ).rejects.toMatchObject({
      provider: 'google_drive',
      syncContinuations: [{ resourceType: 'drive.file', externalId: 'file-1' }],
    });
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

  it('keeps later nested files in scope after walking a shared ancestry cache', async () => {
    const fetchedFolders: string[] = [];
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/changes')) {
        return Promise.resolve(
          jsonResponse({
            changes: [
              {
                fileId: 'file-a',
                file: {
                  id: 'file-a',
                  name: 'SOW A',
                  mimeType: 'application/vnd.google-apps.document',
                  parents: ['nested'],
                },
              },
              {
                fileId: 'file-b',
                file: {
                  id: 'file-b',
                  name: 'SOW B',
                  mimeType: 'application/vnd.google-apps.document',
                  parents: ['nested'],
                },
              },
            ],
            newStartPageToken: 'page-2',
          }),
        );
      }
      if (url.pathname.endsWith('/files/nested')) {
        fetchedFolders.push('nested');
        return Promise.resolve(jsonResponse({ parents: ['selected-folder'] }));
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
      selections: [{ kind: 'drive.folder', externalId: 'selected-folder' }],
      ctx: ctx,
    });

    expect(fetchedFolders).toEqual(['nested']);
    expect(ctx.scheduleTargetedSync).toHaveBeenCalledTimes(2);
    expect(ctx.scheduleTargetedSync).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'file-a', reason: 'drive_watch' }),
      expect.objectContaining({ replaceDelayed: true }),
    );
    expect(ctx.scheduleTargetedSync).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'file-b', reason: 'drive_watch' }),
      expect.objectContaining({ replaceDelayed: true }),
    );
  });

  it('resolves the My Drive root alias to the real folder id', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/files/root')) {
        expect(url.searchParams.get('fields')).toBe('id');
        return Promise.resolve(jsonResponse({ id: '0AMK-my-drive' }));
      }
      if (url.pathname.endsWith('/changes')) {
        return Promise.resolve(
          jsonResponse({
            changes: [
              {
                changeType: 'file',
                fileId: 'file-in-my-drive',
                file: {
                  id: 'file-in-my-drive',
                  name: 'SOW',
                  mimeType: 'application/vnd.google-apps.document',
                  parents: ['0AMK-my-drive'],
                },
              },
            ],
            newStartPageToken: 'page-2',
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

    expect(ctx.scheduleTargetedSync).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'drive.file',
        externalId: 'file-in-my-drive',
        reason: 'drive_watch',
      }),
      expect.objectContaining({ replaceDelayed: true }),
    );
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
    expect(ctx.enqueueTransientDriveExtract).toHaveBeenCalledOnce();
    expect(ctx.enqueueTransientDriveExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'file-1',
        revisionId: 'mod:2026-06-20T10:00:00.000Z',
      }),
    );
    expect(ctx.takeDriveExtractSlot).toHaveBeenCalledWith({
      integrationId: 'integration-1',
      fileId: 'file-1',
    });
    expect(ctx.writeEvents).not.toHaveBeenCalled();
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_extract_enqueued',
      expect.objectContaining({ file_id: 'file-1', mime_type: 'application/pdf' }),
    );
    expect(ctx.saveCursor).toHaveBeenCalledWith('drive.debounce.file-1', {});
  });

  it('resumes Drive PDF capture from orchestrator text without extracting in-process', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/files/file-1')) {
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
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const extracted = 'Contract amount is forty eight thousand dollars for Northstar.';
    const ctx = syncContext({
      loadTransientDriveExtract: vi.fn().mockResolvedValue({ status: 'ready', text: extracted }),
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

    expect(ctx.enqueueTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.consumeTransientDriveExtract).toHaveBeenCalledWith('file-1');
    const events: IntegrationEvent[] = (
      ctx.writeEvents as unknown as { mock: { calls: [IntegrationEvent[]][] } }
    ).mock.calls.flatMap(([batch]) => batch);
    expect(events[0]).toMatchObject({
      provider: 'google_drive',
      signalClass: 'communication',
      eventClass: 'communication',
      eventType: 'file.changed',
    });
    expect(events[0]?.contentText).not.toContain('ya29.');
  });

  it('re-requests bytes when a pending extract no longer matches the Drive revision', async () => {
    const body = Buffer.from('%PDF-1.4 next-revision');
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/files/file-1')) {
        if (url.searchParams.get('alt') === 'media') {
          return Promise.resolve(new Response(body, { status: 200 }));
        }
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'Notes',
            mimeType: 'application/pdf',
            parents: ['root'],
            headRevisionId: 'rev-new',
            modifiedTime: '2026-06-21T10:00:00.000Z',
          }),
        );
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments: [] }));
      }
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadTransientDriveExtract: vi.fn().mockResolvedValue({
        status: 'pending',
        revisionId: 'rev:rev-old',
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.consumeTransientDriveExtract).toHaveBeenCalledWith('file-1');
    expect(ctx.enqueueTransientDriveExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'file-1',
        body,
        revisionId: 'rev:rev-new',
      }),
    );
    expect(ctx.writeEvents).not.toHaveBeenCalled();
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_extract_stale_revision',
      expect.objectContaining({
        file_id: 'file-1',
        status: 'pending',
        stored_revision: 'rev:rev-old',
        file_revision: 'rev:rev-new',
      }),
    );
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_extract_enqueued',
      expect.objectContaining({ file_id: 'file-1' }),
    );
  });

  it('does not accept a ready extract for a newer Drive revision', async () => {
    const body = Buffer.from('%PDF-1.4 next-revision');
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/files/file-1')) {
        if (url.searchParams.get('alt') === 'media') {
          return Promise.resolve(new Response(body, { status: 200 }));
        }
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'Notes',
            mimeType: 'application/pdf',
            parents: ['root'],
            headRevisionId: 'rev-new',
          }),
        );
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments: [] }));
      }
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadTransientDriveExtract: vi.fn().mockResolvedValue({
        status: 'ready',
        text: 'Stale extract for the previous revision.',
        revisionId: 'rev:rev-old',
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.consumeTransientDriveExtract).toHaveBeenCalledWith('file-1');
    expect(ctx.writeEvents).not.toHaveBeenCalled();
    expect(ctx.enqueueTransientDriveExtract).toHaveBeenCalledWith(
      expect.objectContaining({ revisionId: 'rev:rev-new' }),
    );
    expect(ctx.judgeDriveChange).not.toHaveBeenCalled();
  });

  it('keeps a matching pending extract instead of downloading a newer copy', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/files/file-1')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'Notes',
            mimeType: 'application/pdf',
            parents: ['root'],
            headRevisionId: 'rev-same',
          }),
        );
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments: [] }));
      }
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadTransientDriveExtract: vi.fn().mockResolvedValue({
        status: 'pending',
        revisionId: 'rev:rev-same',
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.enqueueTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.consumeTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_extract_pending',
      expect.objectContaining({ file_id: 'file-1' }),
    );
    const mediaCall = fetch.mock.calls.find(
      ([input]) => requestUrl(input).searchParams.get('alt') === 'media',
    );
    expect(mediaCall).toBeUndefined();
  });

  it('audits a visible Drive extract failure then retries after clearing failed state', async () => {
    const body = Buffer.from('%PDF-1.4 retry');
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/files/file-1')) {
        if (url.searchParams.get('alt') === 'media') {
          return Promise.resolve(new Response(body, { status: 200 }));
        }
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'Notes',
            mimeType: 'application/pdf',
            parents: ['root'],
          }),
        );
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments: [] }));
      }
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadTransientDriveExtract: vi.fn().mockResolvedValue({
        status: 'failed',
        error: 'Daytona is not configured for PDF extraction',
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.writeEvents).not.toHaveBeenCalled();
    expect(ctx.consumeTransientDriveExtract).toHaveBeenCalledWith('file-1');
    expect(ctx.takeDriveExtractSlot).toHaveBeenCalledWith({
      integrationId: 'integration-1',
      fileId: 'file-1',
    });
    expect(ctx.enqueueTransientDriveExtract).toHaveBeenCalledOnce();
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_extract_failed',
      expect.objectContaining({
        file_id: 'file-1',
        error: 'Daytona is not configured for PDF extraction',
        retrying: true,
      }),
    );
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_extract_enqueued',
      expect.objectContaining({ file_id: 'file-1' }),
    );
  });

  it('does not retry a failed Drive extract when the extract budget is exhausted', async () => {
    const body = Buffer.from('%PDF-1.4 retry');
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/files/file-1')) {
        if (url.searchParams.get('alt') === 'media') {
          return Promise.resolve(new Response(body, { status: 200 }));
        }
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'Notes',
            mimeType: 'application/pdf',
            parents: ['root'],
          }),
        );
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments: [] }));
      }
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadTransientDriveExtract: vi.fn().mockResolvedValue({
        status: 'failed',
        error: 'Daytona is not configured for PDF extraction',
      }),
      takeDriveExtractSlot: vi.fn().mockResolvedValue({
        allowed: false,
        reason: 'file',
        retryAfterMs: 1_000,
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.consumeTransientDriveExtract).toHaveBeenCalledWith('file-1');
    expect(ctx.enqueueTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_extract_capped',
      expect.objectContaining({ file_id: 'file-1', reason: 'file' }),
    );
  });

  it('gates paid Drive extraction before enqueueing the orchestrator', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/files/file-1')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'Notes',
            mimeType: 'application/pdf',
            parents: ['root'],
          }),
        );
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments: [] }));
      }
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      takeDriveExtractSlot: vi.fn().mockResolvedValue({
        allowed: false,
        reason: 'connection',
        retryAfterMs: 1_000,
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.enqueueTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.judgeDriveChange).not.toHaveBeenCalled();
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_extract_capped',
      expect.objectContaining({ file_id: 'file-1', reason: 'connection' }),
    );
  });

  it('hashes and diffs the full Drive text while storing a truncated snapshot', async () => {
    const prefix = 'A'.repeat(DRIVE_SNAPSHOT_MAX_CHARS);
    const previousFull = `${prefix}OLD_TAIL signed $12k`;
    const nextFull = `${prefix}NEW_TAIL signed $48k Northstar contract.`;
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.includes('/export')) {
        return Promise.resolve(new Response(nextFull, { status: 200 }));
      }
      if (url.pathname.endsWith('/files/file-1')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'SOW',
            mimeType: 'application/vnd.google-apps.document',
            parents: ['root'],
            modifiedTime: '2026-06-20T10:00:00.000Z',
          }),
        );
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments: [] }));
      }
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadLatestDriveSnapshot: vi.fn().mockResolvedValue({
        contentHash: hashDrivePayload(previousFull),
        snapshotText: prefix,
        commentsHash: driveCommentsHash([]),
        permissionsHash: drivePermissionsHash([]),
        mimeType: 'application/vnd.google-apps.document',
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.enqueueTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.judgeDriveChange).toHaveBeenCalled();
    const judgeInput = (
      ctx.judgeDriveChange as unknown as {
        mock: { calls: [{ hunks: string[] }][] };
      }
    ).mock.calls[0]?.[0];
    expect(judgeInput?.hunks).toEqual([DRIVE_BEYOND_SNAPSHOT_HUNK]);
    expect(judgeInput?.hunks.join(' ')).not.toContain('$48k');
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHash: hashDrivePayload(nextFull),
        snapshotText: prefix,
      }),
    );
    const saved = (
      ctx.saveDriveSnapshot as unknown as {
        mock: { calls: [{ snapshotText: string; contentHash: string }][] };
      }
    ).mock.calls[0]?.[0];
    expect(saved?.snapshotText).toHaveLength(DRIVE_SNAPSHOT_MAX_CHARS);
    expect(saved?.contentHash).not.toBe(hashDrivePayload(prefix));
  });

  it('skips a whitespace-only edit on a document longer than the snapshot bound', async () => {
    const paragraph = 'Contract amount is forty eight thousand dollars for Northstar.\n';
    const previousFull = paragraph.repeat(500);
    const nextFull = previousFull.replace('forty eight', 'forty  eight');
    expect(previousFull.length).toBeGreaterThan(DRIVE_SNAPSHOT_MAX_CHARS);
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.includes('/export')) {
        return Promise.resolve(new Response(nextFull, { status: 200 }));
      }
      if (url.pathname.endsWith('/files/file-1')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'SOW',
            mimeType: 'application/vnd.google-apps.document',
            parents: ['root'],
            modifiedTime: '2026-06-20T10:00:00.000Z',
          }),
        );
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments: [] }));
      }
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadLatestDriveSnapshot: vi.fn().mockResolvedValue({
        contentHash: hashDrivePayload(previousFull),
        snapshotText: previousFull.slice(0, DRIVE_SNAPSHOT_MAX_CHARS),
        commentsHash: driveCommentsHash([]),
        permissionsHash: drivePermissionsHash([]),
        mimeType: 'application/vnd.google-apps.document',
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.judgeDriveChange).not.toHaveBeenCalled();
    expect(ctx.writeEvents).not.toHaveBeenCalled();
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_change_skipped',
      expect.objectContaining({ file_id: 'file-1', reason: 'formatting' }),
    );
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ contentHash: hashDrivePayload(nextFull) }),
    );
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
    expect(ctx.takeDriveExtractSlot).not.toHaveBeenCalled();
    expect(ctx.enqueueTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.saveCursor).toHaveBeenCalledWith('drive.debounce.file-1', {});
  });

  it('does not advance the snapshot when writing the judged event fails', async () => {
    const snapshotText = 'Contract amount is forty eight thousand dollars for Northstar.';
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.includes('/export')) {
        return Promise.resolve(new Response(`${snapshotText} Signed.`, { status: 200 }));
      }
      if (url.pathname.endsWith('/files/file-1')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'SOW',
            mimeType: 'application/vnd.google-apps.document',
            parents: ['root'],
            modifiedTime: '2026-06-20T10:00:00.000Z',
          }),
        );
      }
      if (url.pathname.endsWith('/comments'))
        return Promise.resolve(jsonResponse({ comments: [] }));
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadLatestDriveSnapshot: vi.fn().mockResolvedValue({
        contentHash: 'old',
        snapshotText,
        commentsHash: 'old-comments',
        permissionsHash: 'old-permissions',
        mimeType: 'application/vnd.google-apps.document',
      }),
      writeEvents: vi.fn<SyncContext['writeEvents']>().mockRejectedValue(new Error('write failed')),
    });

    await expect(
      googleDriveProvider.incrementalSync({
        integration: { id: 'integration-1', teamId: 'team-1' } as never,
        tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
        selections: [{ kind: 'drive.file', externalId: 'file-1' }],
        ctx: ctx,
        target: { resourceType: 'drive.file', externalId: 'file-1' },
      }),
    ).rejects.toThrow('write failed');
    expect(ctx.saveDriveSnapshot).not.toHaveBeenCalled();
  });

  it('includes comment text, permission fingerprint, and linked object id on Drive events', async () => {
    const snapshotText = 'Contract amount is forty eight thousand dollars for Northstar.';
    const contentHash = hashDrivePayload(snapshotText);
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.includes('/export')) {
        return Promise.resolve(new Response(snapshotText, { status: 200 }));
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(
          jsonResponse({
            comments: [
              {
                id: 'c1',
                content: 'Please confirm the $48k annual term.',
                resolved: true,
                author: { displayName: 'Ada' },
              },
            ],
          }),
        );
      }
      if (url.pathname.endsWith('/permissions')) {
        expect(url.searchParams.get('supportsAllDrives')).toBe('true');
        return Promise.resolve(
          jsonResponse({
            permissions: [
              {
                id: 'p1',
                type: 'user',
                role: 'writer',
                emailAddress: 'buyer@northstar.test',
              },
            ],
          }),
        );
      }
      if (url.pathname.endsWith('/files/file-1')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'SOW',
            mimeType: 'application/vnd.google-apps.document',
            parents: ['root'],
            modifiedTime: '2026-06-20T10:00:00.000Z',
            webViewLink: 'https://docs.google.com/document/d/file-1',
          }),
        );
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadLatestDriveSnapshot: vi.fn().mockResolvedValue({
        contentHash,
        snapshotText,
        commentsHash: 'old-comments',
        permissionsHash: 'old-permissions',
        mimeType: 'application/vnd.google-apps.document',
      }),
      linkedObjectForDriveSelection: vi.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        canonicalName: 'Northstar',
        type: 'company',
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    const events: IntegrationEvent[] = (
      ctx.writeEvents as unknown as { mock: { calls: [IntegrationEvent[]][] } }
    ).mock.calls.flatMap(([batch]) => batch);
    expect(events).toHaveLength(1);
    expect(events[0]?.dedupKey).toMatch(
      new RegExp(`^google_drive:file:file-1:${contentHash}:[a-f0-9]{64}:[a-f0-9]{64}$`),
    );
    expect(events[0]?.contentText).toContain('Please confirm the $48k annual term.');
    expect(events[0]?.contentText).toContain('Ada (resolved):');
    expect(events[0]?.extra).toMatchObject({
      drive: { linked_object_id: '11111111-1111-4111-8111-111111111111' },
    });
    expect(events[0]?.objectMap).toMatchObject({
      type: 'company',
      canonicalName: 'Northstar',
      externalId: '11111111-1111-4111-8111-111111111111',
      displayTitle: 'SOW',
      aliases: ['file-1'],
    });
    expect(ctx.linkedObjectForDriveSelection).toHaveBeenCalledWith('file-1', ['root'], 'file-1');
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledOnce();
    expect(
      (ctx.writeEvents as unknown as { mock: { invocationCallOrder: number[] } }).mock
        .invocationCallOrder[0] ?? 0,
    ).toBeLessThan(
      (ctx.saveDriveSnapshot as unknown as { mock: { invocationCallOrder: number[] } }).mock
        .invocationCallOrder[0] ?? 0,
    );
  });

  it('fingerprints comments from later pages before skipping a comment-only change', async () => {
    const snapshotText = 'Contract amount is forty eight thousand dollars for Northstar.';
    const contentHash = hashDrivePayload(snapshotText);
    const pageOneComments = [
      {
        id: 'c1',
        content: 'Keep the original term.',
        resolved: false,
        modifiedTime: '2026-06-01T00:00:00.000Z',
      },
    ];
    const pageTwoComments = [
      {
        id: 'c51',
        content: 'Please confirm the $48k annual term.',
        resolved: true,
        modifiedTime: '2026-06-20T10:00:00.000Z',
        author: { displayName: 'Ada' },
      },
    ];
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.includes('/export')) {
        return Promise.resolve(new Response(snapshotText, { status: 200 }));
      }
      if (url.pathname.endsWith('/comments')) {
        expect(url.searchParams.get('fields')).toContain('nextPageToken');
        if (!url.searchParams.get('pageToken')) {
          return Promise.resolve(
            jsonResponse({ comments: pageOneComments, nextPageToken: 'comments-page-2' }),
          );
        }
        expect(url.searchParams.get('pageToken')).toBe('comments-page-2');
        return Promise.resolve(jsonResponse({ comments: pageTwoComments }));
      }
      if (url.pathname.endsWith('/permissions')) {
        return Promise.resolve(jsonResponse({ permissions: [] }));
      }
      if (url.pathname.endsWith('/files/file-1')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'SOW',
            mimeType: 'application/vnd.google-apps.document',
            parents: ['root'],
            modifiedTime: '2026-06-20T10:00:00.000Z',
          }),
        );
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadLatestDriveSnapshot: vi.fn().mockResolvedValue({
        contentHash,
        snapshotText,
        commentsHash: driveCommentsHash(pageOneComments),
        permissionsHash: drivePermissionsHash([]),
        mimeType: 'application/vnd.google-apps.document',
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    const commentCalls = fetch.mock.calls.filter(([input]) =>
      requestUrl(input).pathname.endsWith('/comments'),
    );
    expect(commentCalls).toHaveLength(2);
    const events: IntegrationEvent[] = (
      ctx.writeEvents as unknown as { mock: { calls: [IntegrationEvent[]][] } }
    ).mock.calls.flatMap(([batch]) => batch);
    expect(events).toHaveLength(1);
    expect(events[0]?.contentText).toContain('Please confirm the $48k annual term.');
    expect(events[0]?.extra).toMatchObject({
      drive: { strong_signals: ['comment_changed', 'comment_resolved'] },
    });
  });

  it('lists shared-drive permissions instead of files.get so share-only changes emit', async () => {
    const snapshotText = 'Contract amount is forty eight thousand dollars for Northstar.';
    const contentHash = hashDrivePayload(snapshotText);
    const pageOnePermissions = [
      { id: 'p-team', type: 'user', role: 'writer', emailAddress: 'owner@acme.test' },
    ];
    const pageTwoPermissions = [
      { id: 'p-client', type: 'user', role: 'reader', emailAddress: 'buyer@northstar.test' },
    ];
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.includes('/export')) {
        return Promise.resolve(new Response(snapshotText, { status: 200 }));
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments: [] }));
      }
      if (url.pathname.endsWith('/permissions')) {
        expect(url.searchParams.get('supportsAllDrives')).toBe('true');
        expect(url.searchParams.get('fields')).toContain('nextPageToken');
        if (!url.searchParams.get('pageToken')) {
          return Promise.resolve(
            jsonResponse({ permissions: pageOnePermissions, nextPageToken: 'acl-page-2' }),
          );
        }
        expect(url.searchParams.get('pageToken')).toBe('acl-page-2');
        return Promise.resolve(jsonResponse({ permissions: pageTwoPermissions }));
      }
      if (url.pathname.endsWith('/files/file-shared')) {
        expect(url.searchParams.get('fields')).not.toContain('permissions');
        return Promise.resolve(
          jsonResponse({
            id: 'file-shared',
            name: 'SOW',
            mimeType: 'application/vnd.google-apps.document',
            parents: ['shared-folder'],
            driveId: 'shared-drive-1',
            modifiedTime: '2026-06-20T10:00:00.000Z',
          }),
        );
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadLatestDriveSnapshot: vi.fn().mockResolvedValue({
        contentHash,
        snapshotText,
        commentsHash: driveCommentsHash([]),
        permissionsHash: drivePermissionsHash(pageOnePermissions),
        mimeType: 'application/vnd.google-apps.document',
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-shared' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-shared' },
    });

    const permissionCalls = fetch.mock.calls.filter(([input]) =>
      requestUrl(input).pathname.endsWith('/permissions'),
    );
    expect(permissionCalls).toHaveLength(2);
    const events: IntegrationEvent[] = (
      ctx.writeEvents as unknown as { mock: { calls: [IntegrationEvent[]][] } }
    ).mock.calls.flatMap(([batch]) => batch);
    expect(events).toHaveLength(1);
    expect(events[0]?.extra).toMatchObject({
      drive: { strong_signals: ['shared_external_domain'] },
    });
  });

  it('passes the matched selected ancestor into Drive linked-object lookup', async () => {
    const snapshotText = 'Contract amount is forty eight thousand dollars for Northstar.';
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.includes('/export')) {
        return Promise.resolve(new Response(`${snapshotText} Signed.`, { status: 200 }));
      }
      if (url.pathname.endsWith('/files/nested')) {
        return Promise.resolve(jsonResponse({ parents: ['selected-folder'] }));
      }
      if (url.pathname.endsWith('/files/file-nested')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-nested',
            name: 'SOW',
            mimeType: 'application/vnd.google-apps.document',
            parents: ['nested'],
            modifiedTime: '2026-06-20T10:00:00.000Z',
          }),
        );
      }
      if (url.pathname.endsWith('/comments'))
        return Promise.resolve(jsonResponse({ comments: [] }));
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadLatestDriveSnapshot: vi.fn().mockResolvedValue({
        contentHash: 'old',
        snapshotText,
        commentsHash: 'old-comments',
        permissionsHash: 'old-permissions',
        mimeType: 'application/vnd.google-apps.document',
      }),
      linkedObjectForDriveSelection: vi.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        canonicalName: 'Northstar',
        type: 'company',
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.folder', externalId: 'selected-folder' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-nested' },
    });

    expect(ctx.linkedObjectForDriveSelection).toHaveBeenCalledWith(
      'file-nested',
      ['nested'],
      'selected-folder',
    );
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
