import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#src/http/external-fetch.js', () => ({
  externalFetch: (input: string | URL, init?: RequestInit) => globalThis.fetch(input, init),
}));


import type { IntegrationEvent, SyncContext } from '#src/integrations/types.js';

import { resetEnvForTests } from '#src/env.js';
import { googleDriveProvider } from '#src/integrations/providers/google-drive.js';

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

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
  );
}

describe('googleDriveProvider', () => {
  beforeEach(() => {
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
    expect(url.searchParams.get('scope')).toContain('drive.readonly');
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
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://www.googleapis.com/drive/v3/drives'),
      expect.objectContaining({ headers: { authorization: 'Bearer access-token' } }),
    );
  });

  it('does not sync Drive changes until folders or shared drives are selected', async () => {
    const ctx = {
      loadCursor: vi.fn(),
      saveCursor: vi.fn(),
      writeEvents: vi.fn(),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await googleDriveProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [],
      ctx,
    });

    expect(ctx.loadCursor).not.toHaveBeenCalled();
    expect(ctx.writeEvents).not.toHaveBeenCalled();
  });

  it('follows Drive changes pagination and saves the final start page token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/changes')) {
        const pageToken = url.searchParams.get('pageToken');
        expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true');
        expect(url.searchParams.get('supportsAllDrives')).toBe('true');
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
                    mimeType: 'text/plain',
                    modifiedTime: '2026-06-20T10:00:00.000Z',
                    webViewLink: 'https://drive.google.com/file/d/file-1',
                    parents: ['folder-1'],
                    driveId: 'shared-drive-1',
                    owners: [{ displayName: 'Ada', emailAddress: 'ada@example.com' }],
                  },
                },
              ],
              nextPageToken: 'page-2',
            }),
          );
        }
        if (pageToken === 'page-2') {
          return Promise.resolve(
            jsonResponse({
              changes: [
                {
                  changeType: 'file',
                  time: '2026-06-20T10:05:00.000Z',
                  fileId: 'file-2',
                  file: {
                    id: 'file-2',
                    name: 'Incident Notes',
                    mimeType: 'text/plain',
                    modifiedTime: '2026-06-20T10:05:00.000Z',
                    webViewLink: 'https://drive.google.com/file/d/file-2',
                    parents: ['folder-1'],
                  },
                },
              ],
              newStartPageToken: 'page-3',
            }),
          );
        }
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({ page_token: 'page-1' }),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.folder', externalId: 'root' }],
      ctx,
    });

    const changeCalls = fetch.mock.calls
      .map(([input]) => requestUrl(input))
      .filter((url) => url.pathname.endsWith('/changes'));
    expect(changeCalls.map((url) => url.searchParams.get('pageToken'))).toEqual([
      'page-1',
      'page-2',
    ]);
    const events: IntegrationEvent[] = ctx.writeEvents.mock.calls.flatMap(([batch]) => batch);
    expect(events.map((event) => event.externalObjectId)).toEqual(['file-1', 'file-2']);
    expect(events[0]).toMatchObject({
      provider: 'google_drive',
      eventType: 'file.changed',
      contentText: 'Drive file "Roadmap" (text/plain) was modified',
      actor: { name: 'Ada', email: 'ada@example.com' },
      extra: {
        drive: {
          modified_time: '2026-06-20T10:00:00.000Z',
          drive_id: 'shared-drive-1',
          parents: ['folder-1'],
        },
      },
    });
    expect(ctx.saveCursor).toHaveBeenCalledWith('drive.changes', { page_token: 'page-3' });
    expect(ctx.recordAudit).not.toHaveBeenCalledWith('drive_page_cap_hit', expect.anything());
  });

  it('persists a Drive changes resume token when the page safety cap is hit', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
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
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({ page_token: 'page-1' }),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn().mockResolvedValue(undefined),
    };

    await googleDriveProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'access-token', expires_at: Date.now() + 600_000 },
      selections: [{ kind: 'drive.folder', externalId: 'root' }],
      ctx,
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

  it('uses Drive webhooks only as wake-up signals', async () => {
    await expect(
      googleDriveProvider.handleWebhook?.({
        integration: { id: 'integration-1' } as never,
        payload: { headers: { 'x-goog-resource-state': 'change' } },
      }),
    ).resolves.toEqual([]);
  });
});
