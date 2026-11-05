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
const {
  DRIVE_EVENT_CONTENT_MAX_CHARS,
  googleDriveProvider,
  packDriveChangeEvents,
  packDriveEventContent,
} = await import('#src/integrations/providers/google-drive.js');
const { DRIVE_FILE_DEBOUNCE_MS, DRIVE_TRANSIENT_RESULT_TOO_LARGE, hashDrivePayload } =
  await import('#src/integrations/google-drive-capture.js');
const { driveCommentsHashEntries } = await import('#src/integrations/google-drive-comments.js');
const { DRIVE_CHANGED_SPAN_MAX, DRIVE_SNAPSHOT_MAX_CHARS, buildDriveSnapshotLocate } =
  await import('#src/integrations/google-drive-diff.js');
const { extractDriveDocumentStructuralText, formatDriveDocumentTabs } =
  await import('#src/integrations/google-drive-document.js');
const { formatDriveSpreadsheetWorkbook, sheetValuesToCsv } =
  await import('#src/integrations/google-drive-spreadsheet.js');

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

function isGoogleDocsGet(url: URL): boolean {
  return url.hostname === 'docs.googleapis.com' && url.pathname.includes('/documents/');
}

interface GoogleDocsTabFixture {
  title: string;
  text: string;
  childTabs?: GoogleDocsTabFixture[];
}

function googleDocsTabResource(tab: GoogleDocsTabFixture): Record<string, unknown> {
  return {
    tabProperties: { title: tab.title },
    documentTab: {
      body: {
        content: [{ paragraph: { elements: [{ textRun: { content: tab.text } }] } }],
      },
    },
    childTabs: (tab.childTabs ?? []).map((child) => googleDocsTabResource(child)),
  };
}

function googleDocsPlainResponse(text: string, title = 'Tab 1'): Response {
  return jsonResponse({ tabs: [googleDocsTabResource({ title, text })] });
}

function driveDocumentFetch(options: {
  fileId?: string;
  name?: string;
  tabs: GoogleDocsTabFixture[];
}): (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch> {
  const fileId = options.fileId ?? 'file-1';
  return (input) => {
    const url = requestUrl(input);
    if (isGoogleDocsGet(url)) {
      return Promise.resolve(
        jsonResponse({ tabs: options.tabs.map((tab) => googleDocsTabResource(tab)) }),
      );
    }
    if (url.pathname.includes('/export')) {
      return Promise.resolve(
        new Response('first-tab-only export should not be used', { status: 500 }),
      );
    }
    if (url.pathname.endsWith(`/files/${fileId}`)) {
      return Promise.resolve(
        jsonResponse({
          id: fileId,
          name: options.name ?? 'SOW',
          mimeType: 'application/vnd.google-apps.document',
          parents: ['root'],
          modifiedTime: '2026-06-20T10:00:00.000Z',
        }),
      );
    }
    if (url.pathname.endsWith('/comments')) return Promise.resolve(jsonResponse({ comments: [] }));
    return Promise.resolve(jsonResponse({ permissions: [] }));
  };
}

function driveCommentsHash(
  comments: {
    id: string;
    content?: string;
    resolved?: boolean;
    modifiedTime?: string;
  }[],
): string {
  return hashDrivePayload(JSON.stringify(driveCommentsHashEntries(comments, hashDrivePayload)));
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

function selectedFileAncestry(fileId = 'file-1'): {
  parentIds: string[];
  driveId: null;
  matchedAncestorId: string;
  inheritedCandidates: string[];
} {
  return {
    parentIds: ['root'],
    driveId: null,
    matchedAncestorId: fileId,
    inheritedCandidates: [fileId, 'root'],
  };
}

function folderAncestry(
  fileId: string,
  folderId: string,
): {
  parentIds: string[];
  driveId: null;
  matchedAncestorId: string;
  inheritedCandidates: string[];
} {
  return {
    parentIds: [folderId],
    driveId: null,
    matchedAncestorId: folderId,
    inheritedCandidates: [fileId, folderId],
  };
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

function unquoteSheetsA1Range(range: string): string {
  const sheetPart = range.split('!')[0] ?? range;
  if (sheetPart.startsWith("'") && sheetPart.endsWith("'") && sheetPart.length >= 2) {
    return sheetPart.slice(1, -1).replaceAll("''", "'");
  }
  return sheetPart;
}

function driveSpreadsheetFetch(options: {
  fileId?: string;
  name?: string;
  sheets: { title: string; index?: number; values?: unknown[][] }[];
}): (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch> {
  const fileId = options.fileId ?? 'file-1';
  return (input) => {
    const url = requestUrl(input);
    if (url.hostname === 'sheets.googleapis.com') {
      if (url.pathname.endsWith(`/spreadsheets/${fileId}`)) {
        return Promise.resolve(
          jsonResponse({
            sheets: options.sheets.map((sheet, index) => ({
              properties: { title: sheet.title, index: sheet.index ?? index },
            })),
          }),
        );
      }
      if (url.pathname.endsWith('/values:batchGet')) {
        const valueRanges = url.searchParams.getAll('ranges').map((range) => {
          const title = unquoteSheetsA1Range(range);
          const sheet = options.sheets.find((candidate) => candidate.title === title);
          return { range, values: sheet?.values ?? [] };
        });
        return Promise.resolve(jsonResponse({ valueRanges }));
      }
      return Promise.resolve(new Response('unexpected Sheets path', { status: 500 }));
    }
    if (url.pathname.includes('/export')) {
      return Promise.resolve(
        new Response('first-sheet-only csv should not be used', { status: 500 }),
      );
    }
    if (url.pathname.endsWith(`/files/${fileId}`)) {
      return Promise.resolve(
        jsonResponse({
          id: fileId,
          name: options.name ?? 'Budget',
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: ['root'],
          modifiedTime: '2026-06-20T10:00:00.000Z',
        }),
      );
    }
    if (url.pathname.endsWith('/comments')) return Promise.resolve(jsonResponse({ comments: [] }));
    return Promise.resolve(jsonResponse({ permissions: [] }));
  };
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
  | 'cancelTransientDriveExtract'
  | 'deleteDriveSnapshotsForFile'
  | 'cleanupUncoveredDriveTrackedFiles'
  | 'discardDriveTrackedFile'
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
    cancelTransientDriveExtract: vi.fn().mockResolvedValue(undefined),
    deleteDriveSnapshotsForFile: vi.fn().mockResolvedValue(undefined),
    cleanupUncoveredDriveTrackedFiles: vi.fn().mockResolvedValue(undefined),
    takeDriveExtractSlot: vi.fn().mockResolvedValue({ allowed: true }),
    ...overrides,
  };
}

describe('packDriveEventContent', () => {
  it('keeps a changed comment ahead of ten 400-char hunks under the 4000-char cap', () => {
    const hunks = Array.from(
      { length: 10 },
      (_, index) => `${'H'.repeat(400)}-${String(index)}`,
    ).join('\n');
    const packed = packDriveEventContent({
      summary: 'Drive change on "SOW" (comment_changed)',
      hunkPreview: hunks,
      commentPreview: 'Ada (resolved): Please confirm the $48k annual term.',
    });
    expect(packed.length).toBeLessThanOrEqual(DRIVE_EVENT_CONTENT_MAX_CHARS);
    expect(packed).toContain('Ada (resolved): Please confirm the $48k annual term.');
    expect(packed.indexOf('Ada (resolved):')).toBeLessThan(packed.indexOf('H'.repeat(20)));
  });
});

describe('packDriveChangeEvents', () => {
  it('splits so a comment plus passages 7 and 8 all appear untruncated', () => {
    const hunks = Array.from({ length: 10 }, (_, index) => {
      if (index === 6) return `${'N'.repeat(350)}-PASSAGE7-$48k`;
      if (index === 7) return `${'N'.repeat(350)}-PASSAGE8-Northstar`;
      return `${'N'.repeat(400)}-${String(index)}`;
    });
    const packed = packDriveChangeEvents({
      summary: 'Drive change on "SOW" (comment_changed)',
      hunks,
      commentPreview: 'Ada (resolved): Please confirm the $48k annual term.',
      previousText: hunks.map((_, index) => `Keep paragraph ${String(index + 1)}.`).join('\n'),
      nextText: hunks.join('\n'),
    });
    expect(packed).not.toBeNull();
    const parts = packed ?? [];
    expect(parts.length).toBeGreaterThan(1);
    const blob = parts.map((event) => event.contentText).join('\n');
    expect(blob).toContain('Ada (resolved): Please confirm the $48k annual term.');
    expect(blob).toContain('PASSAGE7-$48k');
    expect(blob).toContain('PASSAGE8-Northstar');
    for (const event of parts) {
      expect(event.contentText.length).toBeLessThanOrEqual(DRIVE_EVENT_CONTENT_MAX_CHARS);
    }
    expect(parts.flatMap((event) => event.hunks)).toEqual(hunks);
  });

  it('keeps a 1,600-char comment-only change untruncated so the snapshot can advance', () => {
    const body = `${'A'.repeat(1500)}APPROVED-$48k`;
    const commentPreview = `Ada (added): ${body}`;
    expect(commentPreview.length).toBeGreaterThan(1_200);
    expect(commentPreview.length).toBeLessThan(DRIVE_EVENT_CONTENT_MAX_CHARS);
    const packed = packDriveChangeEvents({
      summary: 'Drive change on "SOW" (comment)',
      hunks: [],
      commentPreview,
      previousText: 'Contract amount is forty eight thousand dollars for Northstar.',
      nextText: 'Contract amount is forty eight thousand dollars for Northstar.',
    });
    expect(packed).not.toBeNull();
    const blob = (packed ?? []).map((event) => event.contentText).join('');
    expect(blob).toContain(body);
    expect(blob).toContain('APPROVED-$48k');
    for (const event of packed ?? []) {
      expect(event.contentText.length).toBeLessThanOrEqual(DRIVE_EVENT_CONTENT_MAX_CHARS);
    }
  });

  it('splits a comment longer than one event and still keeps the full body', () => {
    const body = `${'B'.repeat(4_500)}APPROVED-$48k`;
    const commentPreview = `Ada (added): ${body}`;
    expect(commentPreview.length).toBeGreaterThan(DRIVE_EVENT_CONTENT_MAX_CHARS);
    const packed = packDriveChangeEvents({
      summary: 'Drive change on "SOW" (comment)',
      hunks: [],
      commentPreview,
      previousText: 'Keep the annual term.',
      nextText: 'Keep the annual term.',
    });
    expect(packed).not.toBeNull();
    const parts = packed ?? [];
    expect(parts.length).toBeGreaterThan(1);
    const blob = parts.map((event) => event.contentText).join('');
    expect(blob).toContain(body);
    expect(blob).toContain('APPROVED-$48k');
    for (const event of parts) {
      expect(event.contentText.length).toBeLessThanOrEqual(DRIVE_EVENT_CONTENT_MAX_CHARS);
    }
  });
});

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

  it('cleans uncovered snapshots when incrementalSync has no watchable selections', async () => {
    const ctx = syncContext();
    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [],
      ctx: ctx,
    });
    expect(ctx.cleanupUncoveredDriveTrackedFiles).toHaveBeenCalledWith([]);
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

  it('schedules permission refreshes for tracked descendants when a folder ACL changes', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/changes')) {
        return Promise.resolve(
          jsonResponse({
            changes: [
              {
                changeType: 'file',
                time: '2026-06-20T10:00:00.000Z',
                fileId: 'clients-folder',
                file: {
                  id: 'clients-folder',
                  name: 'Clients',
                  mimeType: 'application/vnd.google-apps.folder',
                  parents: ['root'],
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
    const listDriveTrackedDescendantFileIds = vi
      .fn()
      .mockResolvedValue(['sow-doc', 'pricing-sheet']);
    const ctx = syncContext({
      loadCursor: vi.fn().mockResolvedValue({ page_token: 'page-1' }),
      listDriveTrackedDescendantFileIds,
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'sow-doc' }],
      ctx: ctx,
    });

    expect(listDriveTrackedDescendantFileIds).toHaveBeenCalledWith('clients-folder');
    expect(ctx.scheduleTargetedSync).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'drive.file',
        externalId: 'sow-doc',
        reason: 'drive_folder_acl',
      }),
      expect.objectContaining({ delayMs: DRIVE_FILE_DEBOUNCE_MS, replaceDelayed: true }),
    );
    expect(ctx.scheduleTargetedSync).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'pricing-sheet',
        reason: 'drive_folder_acl',
      }),
      expect.objectContaining({ replaceDelayed: true }),
    );
    expect(ctx.scheduleTargetedSync).not.toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'clients-folder' }),
      expect.anything(),
    );
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
    expect(
      (ctx.writeEvents as unknown as { mock: { invocationCallOrder: number[] } }).mock
        .invocationCallOrder[0] ?? 0,
    ).toBeLessThan(
      (ctx.consumeTransientDriveExtract as unknown as { mock: { invocationCallOrder: number[] } })
        .mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      (ctx.saveDriveSnapshot as unknown as { mock: { invocationCallOrder: number[] } }).mock
        .invocationCallOrder[0] ?? 0,
    ).toBeLessThan(
      (ctx.consumeTransientDriveExtract as unknown as { mock: { invocationCallOrder: number[] } })
        .mock.invocationCallOrder[0] ?? 0,
    );
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

  it('keeps a ready extract until the event and snapshot are saved', async () => {
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
      writeEvents: vi.fn<SyncContext['writeEvents']>().mockRejectedValue(new Error('db down')),
    });

    await expect(
      googleDriveProvider.incrementalSync({
        integration: { id: 'integration-1', teamId: 'team-1' } as never,
        tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
        selections: [{ kind: 'drive.file', externalId: 'file-1' }],
        ctx: ctx,
        target: { resourceType: 'drive.file', externalId: 'file-1' },
      }),
    ).rejects.toThrow('db down');

    expect(ctx.enqueueTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.consumeTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.saveDriveSnapshot).not.toHaveBeenCalled();
  });

  it('does not re-enqueue a terminal oversized extract result', async () => {
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
      loadTransientDriveExtract: vi.fn().mockResolvedValue({
        status: 'failed',
        error: DRIVE_TRANSIENT_RESULT_TOO_LARGE,
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
    expect(ctx.takeDriveExtractSlot).not.toHaveBeenCalled();
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_extract_failed',
      expect.objectContaining({
        file_id: 'file-1',
        error: DRIVE_TRANSIENT_RESULT_TOO_LARGE,
      }),
    );
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

    expect(ctx.cancelTransientDriveExtract).toHaveBeenCalledWith('file-1');
    expect(ctx.consumeTransientDriveExtract).not.toHaveBeenCalled();
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

    expect(ctx.cancelTransientDriveExtract).toHaveBeenCalledWith('file-1');
    expect(ctx.consumeTransientDriveExtract).not.toHaveBeenCalled();
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
    expect(ctx.scheduleTargetedSync).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'drive_transient_extract' }),
      expect.anything(),
    );
  });

  it('reschedules an unpublished pending extract immediately instead of waiting for debounce', async () => {
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
        reschedule: true,
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.scheduleTargetedSync).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'drive.file',
        externalId: 'file-1',
        reason: 'drive_transient_extract',
      }),
      expect.objectContaining({ delayMs: 0 }),
    );
    expect(ctx.saveDriveSnapshot).not.toHaveBeenCalled();
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
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(nextFull));
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
        snapshotLocate: buildDriveSnapshotLocate(previousFull),
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
    expect(judgeInput?.hunks.join(' ')).toContain('$48k');
    expect(judgeInput?.hunks.join(' ')).not.toContain(
      'Text changed past the stored snapshot window.',
    );
    expect(ctx.writeEvents).toHaveBeenCalled();
    const written = (
      ctx.writeEvents as unknown as {
        mock: { calls: [{ contentText: string }[]][] };
      }
    ).mock.calls[0]?.[0]?.[0];
    expect(written?.contentText).toContain('$48k');
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHash: hashDrivePayload(nextFull),
        snapshotText: prefix,
        snapshotLocate: buildDriveSnapshotLocate(nextFull),
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

  it('hashes every Google Sheet tab so a later-tab edit is not dropped as unchanged', async () => {
    const firstSheet = [
      ['item', 'amount'],
      ['Widgets', '12k'],
    ];
    const previousSecond = [['deal'], ['Northstar 12k']];
    const nextSecond = [['deal'], ['Northstar 48k']];
    const firstSheetCsv = sheetValuesToCsv(firstSheet);
    const previousWorkbook = formatDriveSpreadsheetWorkbook([
      { title: 'Summary', rows: firstSheet },
      { title: 'Hidden pipeline', rows: previousSecond },
    ]);
    const nextWorkbook = formatDriveSpreadsheetWorkbook([
      { title: 'Summary', rows: firstSheet },
      { title: 'Hidden pipeline', rows: nextSecond },
    ]);
    expect(hashDrivePayload(firstSheetCsv)).toBe(hashDrivePayload(sheetValuesToCsv(firstSheet)));
    expect(hashDrivePayload(previousWorkbook)).not.toBe(hashDrivePayload(nextWorkbook));

    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >(
      driveSpreadsheetFetch({
        name: 'Budget',
        sheets: [
          { title: 'Summary', values: firstSheet },
          { title: 'Hidden pipeline', index: 1, values: nextSecond },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadLatestDriveSnapshot: vi.fn().mockResolvedValue({
        contentHash: hashDrivePayload(previousWorkbook),
        snapshotText: previousWorkbook,
        snapshotLocate: buildDriveSnapshotLocate(previousWorkbook),
        commentsHash: driveCommentsHash([]),
        permissionsHash: drivePermissionsHash([]),
        mimeType: 'application/vnd.google-apps.spreadsheet',
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    const requested = fetch.mock.calls.map(([input]) => requestUrl(input));
    expect(
      requested.some(
        (url) => url.hostname === 'www.googleapis.com' && url.pathname.includes('/export'),
      ),
    ).toBe(false);
    expect(
      requested.some(
        (url) =>
          url.hostname === 'sheets.googleapis.com' && url.pathname.endsWith('/spreadsheets/file-1'),
      ),
    ).toBe(true);
    expect(
      requested.some(
        (url) =>
          url.hostname === 'sheets.googleapis.com' && url.pathname.endsWith('/values:batchGet'),
      ),
    ).toBe(true);
    expect(ctx.enqueueTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.judgeDriveChange).toHaveBeenCalled();
    expect(ctx.writeEvents).toHaveBeenCalled();
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHash: hashDrivePayload(nextWorkbook),
        snapshotText: nextWorkbook,
      }),
    );
    const saved = (
      ctx.saveDriveSnapshot as unknown as {
        mock: { calls: [{ contentHash: string }][] };
      }
    ).mock.calls[0]?.[0];
    expect(saved?.contentHash).not.toBe(hashDrivePayload(firstSheetCsv));
    expect(saved?.contentHash).not.toBe(hashDrivePayload(previousWorkbook));
  });

  it('takes the unchanged-snapshot branch when every Sheet tab is unchanged', async () => {
    const workbook = formatDriveSpreadsheetWorkbook([
      { title: 'Summary', rows: [['ok']] },
      { title: 'Notes', rows: [['same']] },
    ]);
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >(
      driveSpreadsheetFetch({
        sheets: [
          { title: 'Summary', values: [['ok']] },
          { title: 'Notes', index: 1, values: [['same']] },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadLatestDriveSnapshot: vi.fn().mockResolvedValue({
        contentHash: hashDrivePayload(workbook),
        snapshotText: workbook,
        snapshotLocate: buildDriveSnapshotLocate(workbook),
        commentsHash: driveCommentsHash([]),
        permissionsHash: drivePermissionsHash([]),
        mimeType: 'application/vnd.google-apps.spreadsheet',
        ancestry: selectedFileAncestry(),
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
    expect(ctx.saveDriveSnapshot).not.toHaveBeenCalled();
  });

  it('hashes every Google Doc tab so a later-tab edit is not dropped as unchanged', async () => {
    const first = 'Meeting notes for Northstar.\n';
    const previousSecond = 'Transcript: signed $12k.\n';
    const nextSecond = 'Transcript: signed $48k.\n';
    const previousDocument = formatDriveDocumentTabs([
      { title: 'Notes', text: first },
      { title: 'Transcript', text: previousSecond },
    ]);
    const nextDocument = formatDriveDocumentTabs([
      { title: 'Notes', text: first },
      { title: 'Transcript', text: nextSecond },
    ]);
    expect(hashDrivePayload(first)).toBe(
      hashDrivePayload(formatDriveDocumentTabs([{ title: 'Notes', text: first }])),
    );
    expect(hashDrivePayload(previousDocument)).not.toBe(hashDrivePayload(nextDocument));

    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >(
      driveDocumentFetch({
        name: 'SOW',
        tabs: [
          { title: 'Notes', text: first },
          { title: 'Transcript', text: nextSecond },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadLatestDriveSnapshot: vi.fn().mockResolvedValue({
        contentHash: hashDrivePayload(previousDocument),
        snapshotText: previousDocument,
        snapshotLocate: buildDriveSnapshotLocate(previousDocument),
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

    const requested = fetch.mock.calls.map(([input]) => requestUrl(input));
    expect(
      requested.some(
        (url) => url.hostname === 'www.googleapis.com' && url.pathname.includes('/export'),
      ),
    ).toBe(false);
    expect(
      requested.some(
        (url) =>
          url.hostname === 'docs.googleapis.com' &&
          url.pathname.endsWith('/documents/file-1') &&
          url.searchParams.get('includeTabsContent') === 'true' &&
          url.searchParams.get('suggestionsViewMode') === 'PREVIEW_WITHOUT_SUGGESTIONS',
      ),
    ).toBe(true);
    expect(ctx.enqueueTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.judgeDriveChange).toHaveBeenCalled();
    expect(ctx.writeEvents).toHaveBeenCalled();
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHash: hashDrivePayload(nextDocument),
        snapshotText: nextDocument,
      }),
    );
    const saved = (
      ctx.saveDriveSnapshot as unknown as {
        mock: { calls: [{ contentHash: string }][] };
      }
    ).mock.calls[0]?.[0];
    expect(saved?.contentHash).not.toBe(hashDrivePayload(first));
    expect(saved?.contentHash).not.toBe(hashDrivePayload(previousDocument));
  });

  it('takes the unchanged-snapshot branch when every Doc tab is unchanged', async () => {
    const document = formatDriveDocumentTabs([
      { title: 'Notes', text: 'ok\n' },
      {
        title: 'Transcript',
        text: 'same\n',
      },
    ]);
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >(
      driveDocumentFetch({
        tabs: [
          {
            title: 'Notes',
            text: 'ok\n',
            childTabs: [{ title: 'Transcript', text: 'same\n' }],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadLatestDriveSnapshot: vi.fn().mockResolvedValue({
        contentHash: hashDrivePayload(document),
        snapshotText: document,
        snapshotLocate: buildDriveSnapshotLocate(document),
        commentsHash: driveCommentsHash([]),
        permissionsHash: drivePermissionsHash([]),
        mimeType: 'application/vnd.google-apps.document',
        ancestry: selectedFileAncestry(),
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
    expect(ctx.saveDriveSnapshot).not.toHaveBeenCalled();
  });

  it('persists live ancestry on an unchanged-content move from folder A to B', async () => {
    const document = 'Contract amount is forty eight thousand dollars for Northstar.\n';
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(document));
      }
      if (url.pathname.endsWith('/files/file-1')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'SOW',
            mimeType: 'application/vnd.google-apps.document',
            parents: ['folder-b'],
            modifiedTime: '2026-06-20T10:00:00.000Z',
          }),
        );
      }
      if (url.pathname.endsWith('/files/folder-b') || url.pathname.endsWith('/files/folder-a')) {
        return Promise.resolve(jsonResponse({ id: url.pathname.split('/').pop(), parents: [] }));
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments: [] }));
      }
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadLatestDriveSnapshot: vi.fn().mockResolvedValue({
        contentHash: hashDrivePayload(document),
        snapshotText: document,
        snapshotLocate: buildDriveSnapshotLocate(document),
        commentsHash: driveCommentsHash([]),
        permissionsHash: drivePermissionsHash([]),
        mimeType: 'application/vnd.google-apps.document',
        ancestry: folderAncestry('file-1', 'folder-a'),
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [
        { kind: 'drive.folder', externalId: 'folder-a' },
        { kind: 'drive.folder', externalId: 'folder-b' },
      ],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.judgeDriveChange).not.toHaveBeenCalled();
    expect(ctx.writeEvents).not.toHaveBeenCalled();
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledOnce();
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHash: hashDrivePayload(document),
        ancestry: folderAncestry('file-1', 'folder-b'),
      }),
    );
  });

  it('skips a whitespace-only prefix edit on a long document when the suffix window is unchanged', async () => {
    const paragraph = 'Contract amount is forty eight thousand dollars for Northstar.\n';
    const previousFull = paragraph.repeat(500);
    const nextFull = previousFull.replace('forty eight', 'forty  eight');
    expect(previousFull.length).toBeGreaterThan(DRIVE_SNAPSHOT_MAX_CHARS);
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(nextFull));
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
        snapshotLocate: buildDriveSnapshotLocate(previousFull),
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
      expect.objectContaining({ reason: 'formatting' }),
    );
  });

  it('judges a renewal amount changed at char 25k and writes it on the event', async () => {
    const previousFull = `${'A'.repeat(25_000)}Renewal amount is $12k for Northstar.\n${'B'.repeat(200)}`;
    const nextFull = `${'A'.repeat(25_000)}Renewal amount is $48k for Northstar.\n${'B'.repeat(200)}`;
    expect(previousFull.indexOf('$12k')).toBeGreaterThan(DRIVE_SNAPSHOT_MAX_CHARS);
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(nextFull));
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
        snapshotLocate: buildDriveSnapshotLocate(previousFull),
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

    expect(ctx.judgeDriveChange).toHaveBeenCalled();
    const judgeInput = (
      ctx.judgeDriveChange as unknown as {
        mock: { calls: [{ hunks: string[] }][] };
      }
    ).mock.calls[0]?.[0];
    expect(judgeInput?.hunks.join(' ')).toContain('$48k');
    expect(judgeInput?.hunks.join(' ')).not.toContain(
      'Text changed past the stored snapshot window.',
    );
    const written = (
      ctx.writeEvents as unknown as {
        mock: { calls: [{ contentText: string }[]][] };
      }
    ).mock.calls[0]?.[0]?.[0];
    expect(written?.contentText).toContain('$48k');
    expect(ctx.saveDriveSnapshot).toHaveBeenCalled();
  });

  it('judges a 41,001-char renewal change at offset 20,200 instead of advancing unjudged', async () => {
    const approved = 'Customer renewal approved.';
    const rejected = 'Customer renewal rejected.';
    const previousFull = `${'A'.repeat(20_200)}${approved}${'B'.repeat(41_001 - 20_200 - approved.length)}`;
    const nextFull = `${'A'.repeat(20_200)}${rejected}${'B'.repeat(41_001 - 20_200 - rejected.length)}`;
    expect(previousFull.length).toBe(41_001);
    expect(nextFull.indexOf(rejected)).toBe(20_200);
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(nextFull));
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
        snapshotLocate: buildDriveSnapshotLocate(previousFull),
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

    expect(ctx.judgeDriveChange).toHaveBeenCalled();
    const judgeInput = (
      ctx.judgeDriveChange as unknown as {
        mock: { calls: [{ hunks: string[] }][] };
      }
    ).mock.calls[0]?.[0];
    expect(judgeInput?.hunks.join(' ')).toContain('rejected');
    expect(judgeInput?.hunks.join(' ')).not.toContain(
      'Text changed past the stored snapshot window.',
    );
    expect(ctx.writeEvents).toHaveBeenCalled();
    const written = (
      ctx.writeEvents as unknown as {
        mock: { calls: [{ contentText: string }[]][] };
      }
    ).mock.calls[0]?.[0]?.[0];
    expect(written?.contentText).toContain('rejected');
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHash: hashDrivePayload(nextFull),
        snapshotLocate: buildDriveSnapshotLocate(nextFull),
      }),
    );
    expect(ctx.recordAudit).not.toHaveBeenCalledWith(
      'drive_change_skipped',
      expect.objectContaining({ reason: 'no_evidence' }),
    );
    expect(ctx.recordAudit).not.toHaveBeenCalledWith(
      'drive_change_skipped',
      expect.objectContaining({ reason: 'identical' }),
    );
  });

  it('judges a 73,600-char mixed-filler renewal at offset 22,000 instead of advancing on filler hunks', async () => {
    const approved = 'Customer renewal approved.';
    const rejected = 'Customer renewal rejected.';
    const fill = 'Northstar SOW covers implementation, training, and support. #';
    const mixed = fill.repeat(Math.ceil(73_600 / fill.length)).slice(0, 73_600);
    const previousFull = `${mixed.slice(0, 22_000)}${approved}${mixed.slice(22_000 + approved.length)}`;
    const nextFull = `${mixed.slice(0, 22_000)}${rejected}${mixed.slice(22_000 + rejected.length)}`;
    expect(previousFull.length).toBe(73_600);
    expect(nextFull.indexOf(rejected)).toBe(22_000);
    const chunkStart = Math.floor(22_000 / 4_096) * 4_096;
    expect(22_000 - chunkStart).toBeGreaterThan(400);
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(nextFull));
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
        snapshotLocate: buildDriveSnapshotLocate(previousFull),
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

    expect(ctx.judgeDriveChange).toHaveBeenCalled();
    const judgeInput = (
      ctx.judgeDriveChange as unknown as {
        mock: { calls: [{ hunks: string[] }][] };
      }
    ).mock.calls[0]?.[0];
    expect(judgeInput?.hunks.join(' ')).toContain('rejected');
    expect(judgeInput?.hunks.join(' ')).not.toContain(
      'Text changed past the stored snapshot window.',
    );
    expect(ctx.writeEvents).toHaveBeenCalled();
    const written = (
      ctx.writeEvents as unknown as {
        mock: { calls: [{ contentText: string }[]][] };
      }
    ).mock.calls[0]?.[0]?.[0];
    expect(written?.contentText).toContain('rejected');
    expect(ctx.saveDriveSnapshot).toHaveBeenCalled();
    expect(ctx.recordAudit).not.toHaveBeenCalledWith(
      'drive_change_skipped',
      expect.objectContaining({ reason: 'no_evidence' }),
    );
  });

  it('skips a cosmetic suffix punctuation edit instead of judging it as substantive', async () => {
    const previousFull = `${'A'.repeat(25_000)}Status is open\n${'B'.repeat(200)}`;
    const nextFull = `${'A'.repeat(25_000)}Status is open.\n${'B'.repeat(200)}`;
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(nextFull));
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
        snapshotLocate: buildDriveSnapshotLocate(previousFull),
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
      expect.objectContaining({ reason: 'tiny' }),
    );
    expect(ctx.saveDriveSnapshot).toHaveBeenCalled();
  });

  it('judges an appended contract-signing paragraph instead of saving it as formatting', async () => {
    const previousFull = 'Northstar SOW covers implementation, training, and support.\n'.repeat(24);
    const nextFull = `${previousFull}\nAcme Labs signed a $48k annual contract with Northstar this quarter.`;
    expect(previousFull.length).toBeLessThan(DRIVE_SNAPSHOT_MAX_CHARS);
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(nextFull));
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
        snapshotText: previousFull,
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

    expect(ctx.judgeDriveChange).toHaveBeenCalled();
    const judgeInput = (
      ctx.judgeDriveChange as unknown as {
        mock: { calls: [{ hunks: string[] }][] };
      }
    ).mock.calls[0]?.[0];
    expect(judgeInput?.hunks.join(' ')).toContain('$48k');
    expect(ctx.recordAudit).not.toHaveBeenCalledWith(
      'drive_change_skipped',
      expect.objectContaining({ reason: 'formatting' }),
    );
  });

  it('judges a same-title rich-link URI retarget instead of skipping it as formatting', async () => {
    const linked = (uri: string) =>
      extractDriveDocumentStructuralText([
        {
          paragraph: {
            elements: [
              { textRun: { content: 'See ' } },
              {
                richLink: {
                  richLinkProperties: {
                    title: 'Northstar SOW',
                    uri,
                  },
                },
              },
            ],
          },
        },
      ]);
    const previousFull = linked('https://docs.google.com/document/d/draft');
    const nextFull = linked('https://docs.google.com/document/d/signed');
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(
          jsonResponse({
            tabs: [
              {
                tabProperties: { title: 'Tab 1' },
                documentTab: {
                  body: {
                    content: [
                      {
                        paragraph: {
                          elements: [
                            { textRun: { content: 'See ' } },
                            {
                              richLink: {
                                richLinkProperties: {
                                  title: 'Northstar SOW',
                                  uri: 'https://docs.google.com/document/d/signed',
                                },
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
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
        snapshotText: previousFull,
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

    expect(ctx.judgeDriveChange).toHaveBeenCalled();
    const judgeInput = (
      ctx.judgeDriveChange as unknown as {
        mock: { calls: [{ hunks: string[] }][] };
      }
    ).mock.calls[0]?.[0];
    expect(judgeInput?.hunks.join(' ')).toContain('signed');
    expect(ctx.recordAudit).not.toHaveBeenCalledWith(
      'drive_change_skipped',
      expect.objectContaining({ reason: 'formatting' }),
    );
    expect(nextFull).toBe('See [Northstar SOW](https://docs.google.com/document/d/signed)');
  });

  it('judges a deleted tail paragraph on a short doc', async () => {
    const body = 'Northstar SOW covers implementation, training, and support.\n'.repeat(24);
    const signing = 'Acme Labs signed a $48k annual contract with Northstar this quarter.';
    const previousFull = `${body}\n${signing}`;
    const nextFull = body;
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(nextFull));
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
        snapshotText: previousFull,
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

    expect(ctx.judgeDriveChange).toHaveBeenCalled();
    const judgeInput = (
      ctx.judgeDriveChange as unknown as {
        mock: { calls: [{ hunks: string[] }][] };
      }
    ).mock.calls[0]?.[0];
    expect(judgeInput?.hunks.join(' ')).toContain('$48k');
    expect(judgeInput?.hunks.some((hunk) => hunk.startsWith('- '))).toBe(true);
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
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse('Initial contract draft'));
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
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotText: 'Initial contract draft',
        ancestry: {
          parentIds: ['root'],
          driveId: null,
          matchedAncestorId: 'root',
          inheritedCandidates: ['file-1', 'root'],
        },
      }),
    );
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
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(`${snapshotText} Signed.`));
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
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(snapshotText));
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
      new RegExp(
        `^google_drive:file:file-1:mod:2026-06-20T10:00:00\\.000Z:${contentHash}:[a-f0-9]{64}:[a-f0-9]{64}$`,
      ),
    );
    expect(events[0]?.contentText).toContain('Please confirm the $48k annual term.');
    expect(events[0]?.contentText).toContain('Ada (resolved):');
    expect(events[0]?.extra).toMatchObject({
      drive: {
        linked_object_id: '11111111-1111-4111-8111-111111111111',
        inherited_from: 'file-1',
        inherited_candidates: ['file-1', 'root'],
        matched_ancestor_id: 'file-1',
        integration_id: 'integration-1',
        parents: ['root'],
      },
    });
    expect(events[0]?.objectMap).toMatchObject({
      type: 'company',
      canonicalName: 'Northstar',
      externalId: '11111111-1111-4111-8111-111111111111',
      displayTitle: 'SOW',
      aliases: ['file-1'],
    });
    expect(ctx.linkedObjectForDriveSelection).toHaveBeenCalledWith(
      'file-1',
      ['file-1', 'root'],
      'file-1',
      {},
    );
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledOnce();
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        commentsSnapshot: [
          expect.objectContaining({
            id: 'c1',
            content: 'Please confirm the $48k annual term.',
            resolved: true,
            author: 'Ada',
          }),
        ],
      }),
    );
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
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(snapshotText));
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

  it('captures a 1,600-char comment-only approval instead of skipping as no_evidence', async () => {
    const snapshotText = 'Contract amount is forty eight thousand dollars for Northstar.';
    const contentHash = hashDrivePayload(snapshotText);
    const longComment = `${'A'.repeat(1500)}APPROVED-$48k`;
    const comments = [
      {
        id: 'c-long',
        content: longComment,
        resolved: false,
        modifiedTime: '2026-06-20T10:00:00.000Z',
        author: { displayName: 'Ada' },
      },
    ];
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(snapshotText));
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments }));
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

    expect(ctx.recordAudit).not.toHaveBeenCalledWith(
      'drive_change_skipped',
      expect.objectContaining({ reason: 'no_evidence' }),
    );
    const events: IntegrationEvent[] =
      (ctx.writeEvents as unknown as { mock: { calls: [IntegrationEvent[]][] } }).mock
        .calls[0]?.[0] ?? [];
    const blob = events.map((event) => event.contentText).join('');
    expect(blob).toContain('APPROVED-$48k');
    expect(blob).toContain(longComment);
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        commentsHash: driveCommentsHash(comments),
      }),
    );
  });

  it('puts a last-page comment change first in the bounded event context', async () => {
    const snapshotText = 'Contract amount is forty eight thousand dollars for Northstar.';
    const contentHash = hashDrivePayload(snapshotText);
    const previousComments = Array.from({ length: 10 }, (_, index) => ({
      id: `c${String(index + 1)}`,
      content: `Keep comment ${String(index + 1)}`,
      resolved: false,
      modifiedTime: `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      author: { displayName: `Author ${String(index + 1)}` },
    }));
    const nextComments = previousComments.map((comment, index) =>
      index === previousComments.length - 1
        ? {
            ...comment,
            content: 'Please confirm the $48k annual term.',
            resolved: true,
            author: { displayName: 'Ada' },
          }
        : comment,
    );
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(snapshotText));
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments: nextComments }));
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
        commentsHash: driveCommentsHash(previousComments),
        permissionsHash: drivePermissionsHash([]),
        mimeType: 'application/vnd.google-apps.document',
        commentsSnapshot: previousComments.map((comment) => ({
          id: comment.id,
          content: comment.content,
          resolved: comment.resolved,
          modifiedTime: comment.modifiedTime,
          author: comment.author.displayName,
        })),
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
    const preview = events[0]?.contentText ?? '';
    expect(preview).toContain('Ada (resolved): Please confirm the $48k annual term.');
    expect(preview.indexOf('Ada (resolved):')).toBeLessThan(preview.indexOf('Keep comment 1'));
    expect(preview).not.toContain('Keep comment 9');
    expect(preview).not.toContain('Keep comment 10');
  });

  it('does not advance the text baseline when more than 20 spans ride along with a comment change', async () => {
    const gap = 800;
    const spanCount = DRIVE_CHANGED_SPAN_MAX + 1;
    const length = 200 + spanCount * gap;
    const token = 'Northstar SOW covers implementation, training, and support. #';
    const previousText = token.repeat(Math.ceil(length / token.length)).slice(0, length);
    let nextText = previousText;
    let shift = 0;
    for (let index = 0; index < spanCount; index++) {
      const offset = 40 + index * gap + shift;
      const insert = `[[DROP${String(index)}]]`;
      nextText = `${nextText.slice(0, offset)}${insert}${nextText.slice(offset + 1)}`;
      shift += insert.length - 1;
    }
    const previousHash = hashDrivePayload(previousText);
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(nextText));
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
      return Promise.resolve(jsonResponse({ permissions: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      loadLatestDriveSnapshot: vi.fn().mockResolvedValue({
        contentHash: previousHash,
        snapshotText: previousText.slice(0, DRIVE_SNAPSHOT_MAX_CHARS),
        snapshotLocate: buildDriveSnapshotLocate(previousText),
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

    expect(ctx.writeEvents).toHaveBeenCalled();
    const saved = (
      ctx.saveDriveSnapshot as unknown as {
        mock: { calls: [{ contentHash: string; commentsHash: string }][] };
      }
    ).mock.calls[0]?.[0];
    expect(saved?.contentHash).toBe(previousHash);
    expect(saved?.commentsHash).not.toBe(driveCommentsHash([]));
    expect(ctx.judgeDriveChange).not.toHaveBeenCalled();
  });

  it('keeps comment evidence and passages 7-8 when ten 400-char hunks would overflow the event cap', async () => {
    const previousText = Array.from(
      { length: 10 },
      (_, index) => `Keep paragraph ${String(index + 1)}.`,
    ).join('\n');
    const nextText = Array.from({ length: 10 }, (_, index) => {
      if (index === 6) return `${'N'.repeat(350)}-PASSAGE7-$48k`;
      if (index === 7) return `${'N'.repeat(350)}-PASSAGE8-Northstar`;
      return `${'N'.repeat(400)}-${String(index)}`;
    }).join('\n');
    const previousComments = [
      {
        id: 'c1',
        content: 'Looks good.',
        resolved: false,
        modifiedTime: '2026-06-19T00:00:00.000Z',
        author: { displayName: 'Ada' },
      },
    ];
    const nextComments = [
      {
        id: 'c1',
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
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(nextText));
      }
      if (url.pathname.endsWith('/comments')) {
        expect(url.searchParams.get('fields') ?? '').toContain('replies(');
        return Promise.resolve(jsonResponse({ comments: nextComments }));
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
        contentHash: hashDrivePayload(previousText),
        snapshotText: previousText,
        commentsHash: driveCommentsHash(previousComments),
        permissionsHash: drivePermissionsHash([]),
        commentsSnapshot: previousComments.map((comment) => ({
          id: comment.id,
          content: comment.content,
          resolved: comment.resolved,
          modifiedTime: comment.modifiedTime,
          author: comment.author.displayName,
        })),
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

    const events: IntegrationEvent[] = (
      ctx.writeEvents as unknown as { mock: { calls: [IntegrationEvent[]][] } }
    ).mock.calls.flatMap(([batch]) => batch);
    expect(events.length).toBeGreaterThan(1);
    const preview = events.map((event) => event.contentText).join('\n');
    for (const event of events) {
      expect(event.contentText.length).toBeLessThanOrEqual(DRIVE_EVENT_CONTENT_MAX_CHARS);
    }
    expect(preview).toContain('Ada (resolved): Please confirm the $48k annual term.');
    expect(preview).toContain('comment_changed');
    expect(preview).toContain('PASSAGE7-$48k');
    expect(preview).toContain('PASSAGE8-Northstar');
    expect(preview.indexOf('Ada (resolved):')).toBeLessThan(preview.indexOf('PASSAGE7-$48k'));
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledOnce();
    expect(ctx.judgeDriveChange).not.toHaveBeenCalled();
    expect(new Set(events.map((event) => event.dedupKey))).toHaveLength(events.length);
  });

  it('puts a deleted last-page comment first in the bounded event context', async () => {
    const snapshotText = 'Contract amount is forty eight thousand dollars for Northstar.';
    const contentHash = hashDrivePayload(snapshotText);
    const previousComments = Array.from({ length: 10 }, (_, index) => ({
      id: `c${String(index + 1)}`,
      content: index === 9 ? 'Approved — $48k annual term.' : `Keep comment ${String(index + 1)}`,
      resolved: false,
      modifiedTime: `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      author: { displayName: index === 9 ? 'Ada' : `Author ${String(index + 1)}` },
    }));
    const nextComments = previousComments.slice(0, -1);
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(snapshotText));
      }
      if (url.pathname.endsWith('/comments')) {
        expect(url.searchParams.get('includeDeleted')).toBe('false');
        return Promise.resolve(jsonResponse({ comments: nextComments }));
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
        commentsHash: driveCommentsHash(previousComments),
        permissionsHash: drivePermissionsHash([]),
        mimeType: 'application/vnd.google-apps.document',
        commentsSnapshot: previousComments.map((comment) => ({
          id: comment.id,
          content: comment.content,
          resolved: comment.resolved,
          modifiedTime: comment.modifiedTime,
          author: comment.author.displayName,
        })),
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
    const preview = events[0]?.contentText ?? '';
    expect(preview).toContain('Ada (removed): Approved — $48k annual term.');
    expect(preview.indexOf('Ada (removed):')).toBeLessThan(preview.indexOf('Keep comment 1'));
    expect(preview).not.toContain('Keep comment 9');
    const savedSnapshot = (
      ctx.saveDriveSnapshot as unknown as {
        mock: { calls: [{ commentsSnapshot: { id: string }[] }][] };
      }
    ).mock.calls[0]?.[0];
    const savedIds = savedSnapshot?.commentsSnapshot.map((comment) => comment.id) ?? [];
    expect(savedIds).toEqual(nextComments.map((comment) => comment.id));
    expect(savedIds).not.toContain('c10');
  });

  it('includes a new reply in the event and only then advances the comment baseline', async () => {
    const snapshotText = 'Contract amount is forty eight thousand dollars for Northstar.';
    const contentHash = hashDrivePayload(snapshotText);
    const previousComments = [
      {
        id: 'c1',
        content: 'Looks good.',
        resolved: false,
        modifiedTime: '2026-06-19T00:00:00.000Z',
        author: { displayName: 'Ada' },
      },
    ];
    const nextComments = [
      {
        id: 'c1',
        content: 'Looks good.',
        resolved: false,
        modifiedTime: '2026-06-19T00:00:00.000Z',
        author: { displayName: 'Ada' },
        replies: [
          {
            id: 'r1',
            content: 'Please confirm the $48k annual term.',
            modifiedTime: '2026-06-20T10:00:00.000Z',
            author: { displayName: 'Sam' },
          },
        ],
      },
    ];
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(snapshotText));
      }
      if (url.pathname.endsWith('/comments')) {
        expect(url.searchParams.get('fields') ?? '').toContain('replies(');
        return Promise.resolve(jsonResponse({ comments: nextComments }));
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
        commentsHash: driveCommentsHash(previousComments),
        permissionsHash: drivePermissionsHash([]),
        commentsSnapshot: previousComments.map((comment) => ({
          id: comment.id,
          content: comment.content,
          resolved: comment.resolved,
          modifiedTime: comment.modifiedTime,
          author: comment.author.displayName,
          replies: [],
        })),
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

    const events: IntegrationEvent[] = (
      ctx.writeEvents as unknown as { mock: { calls: [IntegrationEvent[]][] } }
    ).mock.calls.flatMap(([batch]) => batch);
    expect(events).toHaveLength(1);
    expect(events[0]?.contentText).toContain('Sam (reply): Please confirm the $48k annual term.');
    expect(ctx.saveDriveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        commentsHash: driveCommentsHash(nextComments),
      }),
    );
  });

  it('puts a reopened last-page comment first in the bounded event context', async () => {
    const snapshotText = 'Contract amount is forty eight thousand dollars for Northstar.';
    const contentHash = hashDrivePayload(snapshotText);
    const previousComments = Array.from({ length: 10 }, (_, index) => ({
      id: `c${String(index + 1)}`,
      content: `Keep comment ${String(index + 1)}`,
      resolved: index === 9,
      modifiedTime: `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      author: { displayName: `Author ${String(index + 1)}` },
    }));
    const nextComments = previousComments.map((comment, index) =>
      index === previousComments.length - 1 ? { ...comment, resolved: false } : comment,
    );
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(snapshotText));
      }
      if (url.pathname.endsWith('/comments')) {
        return Promise.resolve(jsonResponse({ comments: nextComments }));
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
        commentsHash: driveCommentsHash(previousComments),
        permissionsHash: drivePermissionsHash([]),
        mimeType: 'application/vnd.google-apps.document',
        commentsSnapshot: previousComments.map((comment) => ({
          id: comment.id,
          content: comment.content,
          resolved: comment.resolved,
          modifiedTime: comment.modifiedTime,
          author: comment.author.displayName,
        })),
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
    const preview = events[0]?.contentText ?? '';
    expect(preview).toContain('Author 10 (reopened): Keep comment 10');
    expect(preview.indexOf('Author 10 (reopened):')).toBeLessThan(
      preview.indexOf('Keep comment 1'),
    );
    expect(preview).not.toContain('Keep comment 9');
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
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(snapshotText));
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
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(`${snapshotText} Signed.`));
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
      expect.arrayContaining(['nested', 'selected-folder']),
      'selected-folder',
      {},
    );
  });

  it('walks ancestors of an explicit file so nested linked-folder inheritance still resolves', async () => {
    const snapshotText = 'Contract amount is forty eight thousand dollars for Northstar.';
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (isGoogleDocsGet(url)) {
        return Promise.resolve(googleDocsPlainResponse(`${snapshotText} Signed.`));
      }
      if (url.pathname.endsWith('/files/nested')) {
        return Promise.resolve(jsonResponse({ parents: ['selected-folder'] }));
      }
      if (url.pathname.endsWith('/files/selected-folder')) {
        return Promise.resolve(jsonResponse({ parents: [] }));
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
      selections: [
        { kind: 'drive.file', externalId: 'file-nested' },
        { kind: 'drive.folder', externalId: 'selected-folder' },
      ],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-nested' },
    });

    expect(ctx.linkedObjectForDriveSelection).toHaveBeenCalledWith(
      'file-nested',
      expect.arrayContaining(['nested', 'selected-folder']),
      'file-nested',
      {},
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

  it('clears a transient extract when the Drive file is missing', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/files/file-1')) {
        return Promise.resolve(jsonResponse({ error: 'not found' }, { status: 404 }));
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext();

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'file-1' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.deleteDriveSnapshotsForFile).toHaveBeenCalledWith('file-1');
    expect(ctx.cancelTransientDriveExtract).toHaveBeenCalledWith('file-1');
    expect(ctx.consumeTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.writeEvents).not.toHaveBeenCalled();
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_file_missing',
      expect.objectContaining({ file_id: 'file-1' }),
    );
  });

  it('clears a transient extract when the Drive file leaves the selected subtree', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/files/file-1')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'Moved SOW',
            mimeType: 'application/pdf',
            parents: ['outside'],
          }),
        );
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext();

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'other-file' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.deleteDriveSnapshotsForFile).toHaveBeenCalledWith('file-1');
    expect(ctx.cancelTransientDriveExtract).toHaveBeenCalledWith('file-1');
    expect(ctx.consumeTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.writeEvents).not.toHaveBeenCalled();
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_file_out_of_scope',
      expect.objectContaining({ file_id: 'file-1' }),
    );
  });

  it('uses discardDriveTrackedFile when the sync context supplies the shared primitive', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/files/file-1')) {
        return Promise.resolve(
          jsonResponse({
            id: 'file-1',
            name: 'Moved SOW',
            mimeType: 'application/pdf',
            parents: ['outside'],
          }),
        );
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = syncContext({
      discardDriveTrackedFile: vi.fn().mockResolvedValue(undefined),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.file', externalId: 'other-file' }],
      ctx: ctx,
      target: { resourceType: 'drive.file', externalId: 'file-1' },
    });

    expect(ctx.discardDriveTrackedFile).toHaveBeenCalledWith('file-1');
    expect(ctx.deleteDriveSnapshotsForFile).not.toHaveBeenCalled();
    expect(ctx.cancelTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_file_out_of_scope',
      expect.objectContaining({ file_id: 'file-1' }),
    );
  });

  it('deletes snapshots and cancels extract for a removed changes-feed file before saving the cursor', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/changes')) {
        return Promise.resolve(
          jsonResponse({
            changes: [
              {
                changeType: 'file',
                removed: true,
                fileId: 'file-removed',
              },
              {
                changeType: 'file',
                fileId: 'file-video',
                file: {
                  id: 'file-video',
                  name: 'Clip',
                  mimeType: 'video/mp4',
                  parents: ['root'],
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
    const order: string[] = [];
    const ctx = syncContext({
      loadCursor: vi.fn().mockResolvedValue({ page_token: 'page-1' }),
      deleteDriveSnapshotsForFile: vi.fn((fileId: string) => {
        order.push(`delete:${fileId}`);
        return Promise.resolve();
      }),
      cancelTransientDriveExtract: vi.fn((fileId: string) => {
        order.push(`cancel:${fileId}`);
        return Promise.resolve();
      }),
      saveCursor: vi.fn(() => {
        order.push('save');
        return Promise.resolve();
      }),
    });

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.folder', externalId: 'root' }],
      ctx: ctx,
    });

    expect(ctx.scheduleTargetedSync).not.toHaveBeenCalled();
    expect(ctx.deleteDriveSnapshotsForFile).toHaveBeenCalledWith('file-removed');
    expect(ctx.deleteDriveSnapshotsForFile).toHaveBeenCalledWith('file-video');
    expect(ctx.cancelTransientDriveExtract).toHaveBeenCalledWith('file-removed');
    expect(ctx.cancelTransientDriveExtract).toHaveBeenCalledWith('file-video');
    expect(ctx.consumeTransientDriveExtract).not.toHaveBeenCalled();
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_file_removed',
      expect.objectContaining({ file_id: 'file-removed' }),
    );
    expect(ctx.recordAudit).toHaveBeenCalledWith(
      'drive_file_unsupported_mime',
      expect.objectContaining({ file_id: 'file-video', mime_type: 'video/mp4' }),
    );
    expect(order.indexOf('delete:file-removed')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('delete:file-removed')).toBeLessThan(order.indexOf('save'));
    expect(order.indexOf('cancel:file-removed')).toBeLessThan(order.indexOf('save'));
    expect(ctx.saveCursor).toHaveBeenCalledWith('drive.changes', { page_token: 'page-2' });
  });
});
