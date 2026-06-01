import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('uses Drive webhooks only as wake-up signals', async () => {
    await expect(
      googleDriveProvider.handleWebhook?.({
        integration: { id: 'integration-1' } as never,
        payload: { headers: { 'x-goog-resource-state': 'change' } },
      }),
    ).resolves.toEqual([]);
  });
});
