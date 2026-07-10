import type {
  IntegrationEvent,
  IntegrationProvider,
  IntegrationRow,
  OAuthCallbackInput,
  OAuthStartInput,
  ProviderResource,
  SyncContext,
} from '#src/integrations/types.js';

import { getEnv } from '#src/env.js';
import { externalFetch as fetch } from '#src/http/external-fetch.js';
import { childLogger } from '#src/logger.js';

// Phase 11 — Google Drive provider.
//
// Uses OAuth 2.0 web flow + Drive v3 REST API. The minimum viable sync
// surface this phase ships:
//   - drive.changes.list for incremental deltas (server-issued startPageToken).
//   - drive.files.list per selected folder for backfill enumeration.
//   - drive.files.get for per-file metadata used as the event body.
//
// Full file body download + comment activity require additional API
// quota and (for activity) Activity v2; those land as follow-ups. The
// shape implemented here writes one integration_event per file delta /
// metadata change, which is the value-add over a manual upload.

const log = childLogger('integrations:google-drive');

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';

interface DriveTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
  scope?: string;
  sub?: string;
}

async function postForm(
  url: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new Error(
      `Google Drive ${String(res.status)}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`,
    );
  }
  return parsed as Record<string, unknown>;
}

async function ensureAccessToken(tokens: DriveTokens): Promise<DriveTokens> {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured');
  }
  const now = Date.now();
  if (tokens.expires_at && tokens.expires_at > now + 60_000) return tokens;
  if (!tokens.refresh_token) {
    // Access token has lifetime ~1h; without a refresh token we'll fail
    // explicitly so the operator reconnects.
    throw new Error('Google Drive access token expired and no refresh_token available');
  }
  const body = await postForm(TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
  });
  const access = typeof body.access_token === 'string' ? body.access_token : '';
  const expiresIn = Number(body.expires_in ?? 3600);
  if (!access) throw new Error('Google Drive refresh returned no access_token');
  return {
    ...tokens,
    access_token: access,
    expires_at: now + expiresIn * 1000,
  };
}

async function driveGet<T>(
  tokens: DriveTokens,
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`${DRIVE_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Drive GET ${path} ${String(res.status)}: ${text}`);
  }
  return JSON.parse(text) as T;
}

const MAX_HARVEST_BYTES = 20 * 1024 * 1024;

/**
 * Download a file's bytes. For Google-native MIMEs (Docs/Sheets/Slides) we
 * use the export endpoint to a downloadable format. Returns null if the
 * file is too large (>20MB) or its MIME type is not supported.
 */
async function downloadFileBody(
  tokens: DriveTokens,
  fileId: string,
  mimeType: string,
): Promise<{ body: Buffer; contentType: string; filenameSuffix: string } | null> {
  let url: string;
  let exportedContentType: string | null = null;
  let suffix = '';
  if (mimeType === 'application/vnd.google-apps.document') {
    url = `${DRIVE_BASE}/files/${fileId}/export?mimeType=${encodeURIComponent('text/markdown')}`;
    exportedContentType = 'text/markdown';
    suffix = '.md';
  } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    url = `${DRIVE_BASE}/files/${fileId}/export?mimeType=${encodeURIComponent('text/csv')}`;
    exportedContentType = 'text/csv';
    suffix = '.csv';
  } else if (mimeType === 'application/vnd.google-apps.presentation') {
    url = `${DRIVE_BASE}/files/${fileId}/export?mimeType=${encodeURIComponent('application/pdf')}`;
    exportedContentType = 'application/pdf';
    suffix = '.pdf';
  } else if (mimeType.startsWith('application/vnd.google-apps.')) {
    return null;
  } else {
    url = `${DRIVE_BASE}/files/${fileId}?alt=media`;
  }
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!res.ok) {
    throw new Error(`Drive download ${fileId} ${String(res.status)}`);
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_HARVEST_BYTES) return null;
  const contentType = exportedContentType ?? res.headers.get('content-type') ?? mimeType;
  return { body: Buffer.from(ab), contentType, filenameSuffix: suffix };
}

/**
 * Check whether a file lives under one of the selected folders. Performs an
 * upward walk through `parents` until we hit a selected folder, a shared
 * drive root, or run out. The result is cached for the lifetime of a sync
 * page so a tree of files under one folder pays for ancestor lookup once.
 */
async function fileInSelectedSubtree(
  tokens: DriveTokens,
  fileId: string,
  parents: string[],
  selectedIds: Set<string>,
  cache: Map<string, boolean>,
  // Drive folder nesting is bounded in practice by the user's appetite
  // for clicking "New folder"; cap is intentionally generous (it
  // bounds runaway loops and accidental cycles, not real trees). The
  // per-page `cache` map collapses repeated ancestor walks within the
  // same sync page so 32 hops is essentially free after the first
  // file in a deep folder.
  depthCap = 32,
): Promise<boolean> {
  if (selectedIds.size === 0) return false;
  if (selectedIds.has('root')) {
    // 'root' means everything under My Drive — treat any reachable file as in-scope.
    return true;
  }
  const stack = [...parents];
  let depth = 0;
  while (stack.length > 0 && depth++ < depthCap) {
    const p = stack.pop();
    if (!p) break;
    if (selectedIds.has(p)) return true;
    const cached = cache.get(p);
    if (cached === true) return true;
    if (cached === false) continue;
    try {
      const info = await driveGet<{ parents?: string[] }>(
        tokens,
        `/files/${encodeURIComponent(p)}`,
        {
          fields: 'parents',
        },
      );
      cache.set(p, false);
      if (info.parents) {
        for (const pp of info.parents) stack.push(pp);
      }
    } catch {
      cache.set(p, false);
    }
  }
  void fileId;
  return false;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  owners?: { displayName?: string; emailAddress?: string }[];
  parents?: string[];
  /** Shared drive id when the file lives in a shared (Team) drive. Shared
   *  drives don't expose the drive id via `parents` — only this field. */
  driveId?: string;
}

interface DriveChange {
  changeType?: 'file' | 'drive';
  removed?: boolean;
  time?: string;
  fileId?: string;
  file?: DriveFile;
}

interface DriveChangesPage {
  changes?: DriveChange[];
  nextPageToken?: string;
  newStartPageToken?: string;
}

interface DriveCursor {
  page_token?: string;
}

async function startPageToken(tokens: DriveTokens): Promise<string> {
  const data = await driveGet<{ startPageToken: string }>(tokens, '/changes/startPageToken');
  return data.startPageToken;
}

function buildAuthorizeUrl(input: OAuthStartInput): string {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID not configured');
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', input.state);
  return url.toString();
}

function changeToEvent(_integration: IntegrationRow, change: DriveChange): IntegrationEvent | null {
  void _integration;
  if (!change.fileId) return null;
  if (change.removed) {
    return {
      dedupKey: `google_drive:change:${change.fileId}:removed:${change.time ?? ''}`,
      provider: 'google_drive',
      externalObjectId: change.fileId,
      externalEventId: change.time ?? null,
      eventType: 'file.removed',
      occurredAt: change.time ? new Date(change.time) : new Date(),
      contentText: `Drive file ${change.fileId} was removed`,
      extra: { drive: { changeType: change.changeType } },
    };
  }
  const file = change.file;
  if (!file) return null;
  const owner = file.owners?.[0];
  const occurred = file.modifiedTime ? new Date(file.modifiedTime) : new Date();
  const actor: { externalId?: string; name?: string; email?: string } | null = owner
    ? {
        ...(owner.displayName ? { name: owner.displayName } : {}),
        ...(owner.emailAddress ? { email: owner.emailAddress } : {}),
      }
    : null;
  return {
    dedupKey: `google_drive:change:${file.id}:${file.modifiedTime ?? ''}`,
    provider: 'google_drive',
    externalObjectId: file.id,
    externalEventId: file.modifiedTime ?? null,
    eventType: 'file.changed',
    occurredAt: occurred,
    actor,
    contentText: `Drive file "${file.name}" (${file.mimeType}) was modified`,
    extra: {
      drive: {
        name: file.name,
        mime_type: file.mimeType,
        web_view_link: file.webViewLink ?? null,
        modified_time: file.modifiedTime ?? null,
        drive_id: file.driveId ?? null,
        parents: file.parents ?? [],
      },
    },
  };
}

async function fetchChanges(
  integration: IntegrationRow,
  tokens: DriveTokens,
  selectedFolderIds: Set<string>,
  ctx: SyncContext,
  resourceType: string,
): Promise<void> {
  let cursor = (await ctx.loadCursor(resourceType)) as DriveCursor;
  if (!cursor.page_token) {
    cursor = { page_token: await startPageToken(tokens) };
  }
  let pageToken = cursor.page_token;
  let safety = 0;
  while (pageToken && safety++ < 50) {
    const page = await driveGet<DriveChangesPage>(tokens, '/changes', {
      pageToken,
      includeRemoved: 'true',
      fields:
        'changes(changeType,removed,time,fileId,file(id,name,mimeType,modifiedTime,webViewLink,parents,driveId,owners(displayName,emailAddress))),nextPageToken,newStartPageToken',
      pageSize: '100',
      // Required by the Drive API to receive changes from shared drives
      // (Team Drives) at all, plus the `driveId` field. Without these
      // params the feed only carries My Drive changes regardless of
      // what scopes the OAuth grants.
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
    });
    const events: IntegrationEvent[] = [];
    const ancestorCache = new Map<string, boolean>();
    for (const c of page.changes ?? []) {
      // Subtree gate applies to BOTH event writes and body harvest. The
      // Drive changes feed is account-wide, but the team has opted in to
      // specific folders / shared drives — matches the opt-in posture
      // GitHub (repo selections) and Linear (team selections) use.
      // Removed-file changes pass through so deletions for previously
      // selected files still produce a tombstone event; we don't have
      // parents on a tombstone to check otherwise.
      let inScope = c.removed === true;
      if (!inScope && c.file) {
        // Shared-drive files don't expose the shared-drive id via
        // `parents` — only via the top-level `driveId`. Check that
        // first so `drive.shared_drive` selections actually match,
        // then fall back to the parent walk for My Drive / nested
        // folder selections.
        if (c.file.driveId && selectedFolderIds.has(c.file.driveId)) {
          inScope = true;
        } else {
          inScope = await fileInSelectedSubtree(
            tokens,
            c.file.id,
            c.file.parents ?? [],
            selectedFolderIds,
            ancestorCache,
          );
        }
      }
      if (!inScope) continue;
      const evt = changeToEvent(integration, c);
      if (evt) events.push(evt);
      // Body harvest: only for non-removed files when the worker
      // supplied a harvestDocument hook. Subtree membership was already
      // checked above.
      if (!c.removed && c.file && ctx.harvestDocument) {
        try {
          const download = await downloadFileBody(tokens, c.file.id, c.file.mimeType);
          if (download) {
            await ctx.harvestDocument({
              filename: `${c.file.name}${download.filenameSuffix}`,
              contentType: download.contentType,
              body: download.body,
              externalId: c.file.id,
              metadata: {
                drive: {
                  web_view_link: c.file.webViewLink ?? null,
                  mime_type: c.file.mimeType,
                  modified_time: c.file.modifiedTime ?? null,
                },
              },
            });
          } else {
            // downloadFileBody returns null for files we can't ingest:
            // > 20MB body, or an unsupported Google-native MIME (forms,
            // drawings, etc.). Surface to the audit log so the admin can
            // tell the difference between "harvest succeeded" and
            // "harvest silently skipped". The integration row's
            // `last_error` is left alone — the sync as a whole still
            // succeeded.
            await ctx.recordAudit('harvest_skipped', {
              file_id: c.file.id,
              file_name: c.file.name,
              mime_type: c.file.mimeType,
              reason:
                c.file.mimeType.startsWith('application/vnd.google-apps.') &&
                c.file.mimeType !== 'application/vnd.google-apps.document' &&
                c.file.mimeType !== 'application/vnd.google-apps.spreadsheet' &&
                c.file.mimeType !== 'application/vnd.google-apps.presentation'
                  ? 'unsupported_google_app_mime'
                  : 'too_large_or_unsupported',
            });
          }
        } catch (err) {
          log.warn({ err, fileId: c.file.id }, 'drive body harvest failed');
          await ctx.recordAudit('harvest_failed', {
            file_id: c.file.id,
            file_name: c.file.name,
            mime_type: c.file.mimeType,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    if (events.length > 0) await ctx.writeEvents(events);
    if (page.nextPageToken) {
      pageToken = page.nextPageToken;
    } else if (page.newStartPageToken) {
      await ctx.saveCursor(resourceType, { page_token: page.newStartPageToken });
      return;
    } else {
      return;
    }
  }
  // Hit the 50-page safety cap with more pages still available. Persist
  // the next `pageToken` so the following tick resumes where we stopped
  // instead of restarting from the stored token and reprocessing the
  // same window forever. Surfaces in audit so operators can spot the
  // accounts that consistently exceed the cap.
  if (pageToken) {
    await ctx.saveCursor(resourceType, { page_token: pageToken });
    await ctx.recordAudit('drive_page_cap_hit', {
      integration_id: integration.id,
      next_page_token: pageToken,
    });
    log.warn({ integrationId: integration.id }, 'drive changes hit page cap');
  }
}

export const googleDriveProvider: IntegrationProvider = {
  id: 'google_drive',
  displayLabel: 'Google Drive',

  // eslint-disable-next-line @typescript-eslint/require-await
  async startOAuth(input) {
    return { authorizeUrl: buildAuthorizeUrl(input) };
  },

  async handleOAuthCallback(input: OAuthCallbackInput) {
    const env = getEnv();
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured');
    }
    const body = await postForm(TOKEN_URL, {
      grant_type: 'authorization_code',
      code: input.code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: input.redirectUri,
    });
    const access = typeof body.access_token === 'string' ? body.access_token : '';
    if (!access) throw new Error('Google Drive token exchange returned no access_token');
    const expiresIn = Number(body.expires_in ?? 3600);
    const tokens: DriveTokens = {
      access_token: access,
      expires_at: Date.now() + expiresIn * 1000,
      token_type: typeof body.token_type === 'string' ? body.token_type : 'Bearer',
      scope: typeof body.scope === 'string' ? body.scope : SCOPES.join(' '),
    };
    if (typeof body.refresh_token === 'string') tokens.refresh_token = body.refresh_token;
    // Fetch the user's primary email + sub for displayName / externalAccountId.
    let displayName = 'Google Drive';
    // externalAccountId MUST be the stable Google subject id so reconnects
    // upsert on the existing integration row. A random fallback would
    // silently produce duplicate integrations every reconnect — fail
    // the OAuth flow instead and let the user retry.
    let sub = '';
    let userInfoOk = false;
    try {
      const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { authorization: `Bearer ${access}` },
      });
      if (info.ok) {
        const j = (await info.json()) as { email?: string; sub?: string };
        if (j.email) displayName = `Google Drive — ${j.email}`;
        if (j.sub) {
          sub = j.sub;
          tokens.sub = j.sub;
          userInfoOk = true;
        }
      }
    } catch (err) {
      log.warn({ err }, 'failed to fetch userinfo');
    }
    if (!userInfoOk || !sub) {
      throw new Error(
        'google_userinfo_lookup_failed: could not resolve the authenticated user subject id from /oauth2/v3/userinfo — reconnect and try again',
      );
    }
    return {
      externalAccountId: sub,
      displayName,
      scopes: SCOPES,
      tokens: tokens as unknown as Record<string, unknown>,
      accessTokenExpiresAt: new Date(tokens.expires_at ?? Date.now() + expiresIn * 1000),
    };
  },

  async listSyncableResources(integration, tokens): Promise<ProviderResource[]> {
    const refreshed = await ensureAccessToken(tokens as DriveTokens);
    // List top-level shared drives + the user's "My Drive" root folder.
    const items: ProviderResource[] = [
      { externalId: 'root', label: 'My Drive (root)', kind: 'drive.folder' },
    ];
    try {
      const drives = await driveGet<{ drives?: { id: string; name: string }[] }>(
        refreshed,
        '/drives',
        {
          pageSize: '100',
        },
      );
      for (const d of drives.drives ?? []) {
        items.push({ externalId: d.id, label: d.name, kind: 'drive.shared_drive' });
      }
    } catch (err) {
      log.warn({ err, integrationId: integration.id }, 'listing drives failed');
    }
    return items;
  },

  async backfill({ integration, tokens, selections, ctx }) {
    const selected = new Set(
      selections
        .filter((s) => s.kind === 'drive.folder' || s.kind === 'drive.shared_drive')
        .map((s) => s.externalId),
    );
    // Opt-in only. fetchChanges walks the whole Drive change feed
    // unconditionally — selections only gate the document-body harvest
    // step inside it. Without this guard, a Drive integration with no
    // folder selections still writes change events for the entire
    // drive into raw_events. Match webhook + Linear posture: an
    // integration with no drive.folder / drive.shared_drive
    // selections syncs nothing.
    if (selected.size === 0) return;
    const refreshed = await ensureAccessToken(tokens as DriveTokens);
    if (refreshed.access_token !== (tokens as DriveTokens).access_token) {
      await ctx.persistTokens(refreshed as unknown as Record<string, unknown>);
    }
    await fetchChanges(integration, refreshed, selected, ctx, 'drive.changes');
  },

  async incrementalSync({ integration, tokens, selections, ctx }) {
    const selected = new Set(
      selections
        .filter((s) => s.kind === 'drive.folder' || s.kind === 'drive.shared_drive')
        .map((s) => s.externalId),
    );
    if (selected.size === 0) return;
    const refreshed = await ensureAccessToken(tokens as DriveTokens);
    if (refreshed.access_token !== (tokens as DriveTokens).access_token) {
      // Persist the refreshed access_token + new expires_at so the next
      // sync doesn't repeat the refresh roundtrip. Skipped when
      // ensureAccessToken returned the same input (token still valid).
      await ctx.persistTokens(refreshed as unknown as Record<string, unknown>);
    }
    await fetchChanges(integration, refreshed, selected, ctx, 'drive.changes');
  },

  // eslint-disable-next-line @typescript-eslint/require-await
  async handleWebhook({ integration, payload }) {
    // Drive push notifications carry a resourceId in headers; we use the
    // payload only as a wake-up signal and rely on the incremental cursor
    // to fetch the actual changes.
    void integration;
    void payload;
    return [];
  },
};
