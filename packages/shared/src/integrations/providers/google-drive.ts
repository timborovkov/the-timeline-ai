import { createHmac, randomUUID } from 'node:crypto';

import { getEnv } from '#src/env.js';
import {
  driveDebouncePlan,
  driveExtractMatchesFileRevision,
  driveFileChangeDedupKey,
  driveFileContentRevision,
  driveObjectLinkCandidates,
  driveObjectLinkHintsEqual,
  driveSnapshotAncestryFromMembership,
  hashDrivePayload,
  isDriveExtractResultTooLarge,
  takeDriveExtractSlot,
  takeDriveProcessSlot,
  type DriveObjectLinkHints,
} from '#src/integrations/google-drive-capture.js';
import {
  commentEventContext,
  compactDriveComments,
  driveCommentsHashEntries,
  parseDriveCommentSnapshots,
  type DriveComment,
} from '#src/integrations/google-drive-comments.js';
import {
  buildDriveSnapshotLocate,
  diffDriveSnapshots,
  driveDiffHasEvidence,
  driveHunksContainChangedSpan,
  parseDriveSnapshotLocate,
  truncateDriveSnapshot,
} from '#src/integrations/google-drive-diff.js';
import {
  formatDriveDocumentFromApi,
  type DriveDocumentApiResource,
} from '#src/integrations/google-drive-document.js';
import { decideDriveSnapshotAdvance } from '#src/integrations/google-drive-evidence.js';
import {
  DRIVE_FILE_KIND,
  DRIVE_FOLDER_KIND,
  DRIVE_SHARED_DRIVE_KIND,
  createDriveAncestryCache,
  driveResourceKindForMime,
  driveScopeFromSelections,
  driveSelectionIsWatchable,
  isSupportedDriveMimeType,
  resolveDriveFileMembership,
  type DriveAncestryCache,
  type DriveFileMembership,
  type DriveScopeSets,
} from '#src/integrations/google-drive-scope.js';
import {
  formatDriveSpreadsheetWorkbook,
  quoteSheetsA1SheetName,
} from '#src/integrations/google-drive-spreadsheet.js';
import { providerFetch } from '#src/integrations/request.js';
import { attachSyncContinuation, isProviderRateLimitError } from '#src/integrations/types.js';
import { childLogger } from '#src/logger.js';

import type { DriveChangeJudge } from '#src/integrations/google-drive-judge.js';
import type {
  IntegrationEvent,
  IntegrationProvider,
  IntegrationRow,
  OAuthCallbackInput,
  OAuthStartInput,
  ProviderResource,
  SyncContext,
  SyncResult,
  WebhookHandleResult,
} from '#src/integrations/types.js';

const fetch = providerFetch('google_drive');

const log = childLogger('integrations:google-drive');

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DOCS_BASE = 'https://docs.googleapis.com/v1/documents';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
/** Repeated `ranges` query params stay well under typical URL length limits. */
const SHEETS_BATCH_RANGE_LIMIT = 40;
const MAX_HARVEST_BYTES = 20 * 1024 * 1024;
/** Same page size and page cap as folder listing so comment/ACL fingerprints stay bounded. */
const DRIVE_METADATA_PAGE_SIZE = '100';
const DRIVE_METADATA_MAX_PAGES = 10;
const FILE_FIELDS =
  'id,name,mimeType,modifiedTime,headRevisionId,md5Checksum,webViewLink,parents,driveId,owners(displayName,emailAddress),shortcutDetails(targetId,targetMimeType)';
export const DRIVE_EVENT_CONTENT_MAX_CHARS = 4000;

interface DriveTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
  scope?: string;
  sub?: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  headRevisionId?: string;
  md5Checksum?: string;
  webViewLink?: string;
  owners?: { displayName?: string; emailAddress?: string }[];
  parents?: string[];
  driveId?: string;
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
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
  firstQueuedAt?: string;
}

interface DrivePermission {
  id?: string;
  type?: string;
  role?: string;
  emailAddress?: string;
  domain?: string;
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

async function persistRefreshedTokens(
  ctx: { persistTokens(tokens: Record<string, unknown>): Promise<void> } | undefined,
  original: DriveTokens,
  refreshed: DriveTokens,
): Promise<void> {
  if (!ctx) return;
  if (
    refreshed.access_token === original.access_token &&
    refreshed.expires_at === original.expires_at
  )
    return;
  await ctx.persistTokens(refreshed as unknown as Record<string, unknown>);
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

async function driveGetOptional<T>(
  tokens: DriveTokens,
  path: string,
  params: Record<string, string> = {},
): Promise<T | null> {
  try {
    return await driveGet<T>(tokens, path, params);
  } catch (error) {
    if (isProviderRateLimitError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(' 404:') || message.includes(' 403:')) return null;
    throw error;
  }
}

function driveQueryLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function supportedMimeQuery(): string {
  return [
    "mimeType = 'application/vnd.google-apps.folder'",
    "mimeType = 'application/vnd.google-apps.document'",
    "mimeType = 'application/vnd.google-apps.spreadsheet'",
    "mimeType = 'application/vnd.google-apps.presentation'",
    "mimeType = 'application/pdf'",
    "mimeType = 'application/msword'",
    "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
  ].join(' or ');
}

async function startPageToken(tokens: DriveTokens): Promise<string> {
  const data = await driveGet<{ startPageToken: string }>(tokens, '/changes/startPageToken', {
    supportsAllDrives: 'true',
  });
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

function resourceFromFile(file: DriveFile): ProviderResource {
  return {
    externalId: file.id,
    label: file.name,
    kind: driveResourceKindForMime(file.mimeType),
  };
}

async function listFolderChildren(
  tokens: DriveTokens,
  parentId: string,
): Promise<ProviderResource[]> {
  const items: ProviderResource[] = [];
  let pageToken: string | undefined;
  let safety = 0;
  while (safety++ < 10) {
    const page = await driveGet<{ files?: DriveFile[]; nextPageToken?: string }>(tokens, '/files', {
      q: `'${driveQueryLiteral(parentId)}' in parents and trashed = false and (${supportedMimeQuery()})`,
      fields: `files(${FILE_FIELDS}),nextPageToken`,
      pageSize: '100',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      ...(pageToken ? { pageToken } : {}),
    });
    for (const file of page.files ?? []) {
      if (
        file.mimeType === 'application/vnd.google-apps.folder' ||
        isSupportedDriveMimeType(file.mimeType)
      ) {
        items.push(resourceFromFile(file));
      }
    }
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return items;
}

async function searchDriveResources(
  tokens: DriveTokens,
  query: string,
): Promise<ProviderResource[]> {
  const needle = driveQueryLiteral(query.trim().slice(0, 100));
  if (!needle) return [];
  const page = await driveGet<{ files?: DriveFile[] }>(tokens, '/files', {
    q: `trashed = false and name contains '${needle}' and (${supportedMimeQuery()})`,
    fields: `files(${FILE_FIELDS})`,
    pageSize: '50',
    corpora: 'user',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const items: ProviderResource[] = [];
  for (const file of page.files ?? []) {
    if (
      file.mimeType === 'application/vnd.google-apps.folder' ||
      isSupportedDriveMimeType(file.mimeType)
    ) {
      items.push(resourceFromFile(file));
    }
  }
  try {
    const drives = await driveGet<{ drives?: { id: string; name: string }[] }>(tokens, '/drives', {
      pageSize: '100',
      q: `name contains '${needle}'`,
    });
    for (const drive of drives.drives ?? []) {
      items.push({
        externalId: drive.id,
        label: drive.name,
        kind: DRIVE_SHARED_DRIVE_KIND,
      });
    }
  } catch (error) {
    if (isProviderRateLimitError(error)) throw error;
    log.warn({ err: error }, 'drive shared-drive search failed');
  }
  return items;
}

async function resolveIncludeIds(
  tokens: DriveTokens,
  includeIds: { kind: string; externalId: string }[],
): Promise<ProviderResource[]> {
  const items: ProviderResource[] = [];
  const seen = new Set<string>();
  for (const requested of includeIds) {
    const key = `${requested.kind}\x00${requested.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (requested.externalId === 'root' && requested.kind === DRIVE_FOLDER_KIND) {
      items.push({ externalId: 'root', label: 'My Drive (root)', kind: DRIVE_FOLDER_KIND });
      continue;
    }
    if (requested.kind === DRIVE_SHARED_DRIVE_KIND) {
      const drive = await driveGetOptional<{ id: string; name: string }>(
        tokens,
        `/drives/${encodeURIComponent(requested.externalId)}`,
        { fields: 'id,name' },
      );
      if (drive) {
        items.push({
          externalId: drive.id,
          label: drive.name,
          kind: DRIVE_SHARED_DRIVE_KIND,
        });
      }
      continue;
    }
    const file = await driveGetOptional<DriveFile>(
      tokens,
      `/files/${encodeURIComponent(requested.externalId)}`,
      { fields: FILE_FIELDS, supportsAllDrives: 'true' },
    );
    if (!file) continue;
    const kind = driveResourceKindForMime(file.mimeType);
    if (
      kind === requested.kind ||
      requested.kind === DRIVE_FILE_KIND ||
      requested.kind === DRIVE_FOLDER_KIND
    ) {
      items.push({ externalId: file.id, label: file.name, kind });
    }
  }
  return items;
}

async function listTopLevelResources(tokens: DriveTokens): Promise<ProviderResource[]> {
  const items: ProviderResource[] = [
    { externalId: 'root', label: 'My Drive (root)', kind: DRIVE_FOLDER_KIND },
  ];
  try {
    const drives = await driveGet<{ drives?: { id: string; name: string }[] }>(tokens, '/drives', {
      pageSize: '100',
    });
    for (const drive of drives.drives ?? []) {
      items.push({ externalId: drive.id, label: drive.name, kind: DRIVE_SHARED_DRIVE_KIND });
    }
  } catch (error) {
    if (isProviderRateLimitError(error)) throw error;
    log.warn({ err: error }, 'listing drives failed');
  }
  return items;
}

async function resolveDriveScope(
  tokens: DriveTokens,
  selections: { kind: string; externalId: string }[],
): Promise<DriveScopeSets> {
  const scope = driveScopeFromSelections(selections);
  if (!scope.watchesRoot) return scope;
  // Drive file `parents` use the real My Drive folder UUID, never the `root`
  // alias. Resolve it once per sync so My Drive selections match production
  // change payloads. Tests that still stub `parents: ['root']` keep working
  // because `driveScopeFromSelections` also records the alias.
  const root = await driveGetOptional<{ id?: string }>(tokens, '/files/root', { fields: 'id' });
  if (root?.id) {
    scope.folders.add(root.id);
    scope.myDriveRootId = root.id;
  }
  return scope;
}

async function fileInSelectedSubtree(
  tokens: DriveTokens,
  file: Pick<DriveFile, 'id' | 'parents' | 'driveId'>,
  scope: DriveScopeSets,
  cache: DriveAncestryCache,
): Promise<DriveFileMembership> {
  return resolveDriveFileMembership({
    fileId: file.id,
    scope,
    cache,
    getParents: async (folderId) => {
      const info = await driveGetOptional<{ parents?: string[] }>(
        tokens,
        `/files/${encodeURIComponent(folderId)}`,
        { fields: 'parents', supportsAllDrives: 'true' },
      );
      if (!info) return null;
      return info.parents ?? [];
    },
    ...(file.parents ? { parents: file.parents } : {}),
    ...(file.driveId ? { driveId: file.driveId } : {}),
  });
}

function exportSpec(
  mimeType: string,
): { urlPath: string; contentType: string; suffix: string } | null {
  if (mimeType === 'application/vnd.google-apps.presentation') {
    return {
      urlPath: `/files/{id}/export?mimeType=${encodeURIComponent('application/pdf')}`,
      contentType: 'application/pdf',
      suffix: '.pdf',
    };
  }
  if (mimeType.startsWith('application/vnd.google-apps.')) return null;
  return { urlPath: `/files/{id}?alt=media`, contentType: mimeType, suffix: '' };
}

function isResponseTooLarge(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === 'response_too_large',
  );
}

interface SheetsTabProperties {
  title?: string;
  index?: number;
}

interface SheetsSpreadsheetMeta {
  sheets?: { properties?: SheetsTabProperties }[];
}

interface SheetsValueRange {
  values?: unknown[][];
}

async function googleJsonFetch<T>(tokens: DriveTokens, url: URL, label: string): Promise<T> {
  const res = await fetch(
    url.toString(),
    { headers: { authorization: `Bearer ${tokens.access_token}` } },
    { maxResponseBytes: MAX_HARVEST_BYTES },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${label} GET ${url.pathname} ${String(res.status)}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function downloadDocumentTabs(
  tokens: DriveTokens,
  fileId: string,
): Promise<{ body: Buffer; contentType: string; filenameSuffix: string } | null> {
  try {
    const url = new URL(`${DOCS_BASE}/${encodeURIComponent(fileId)}`);
    url.searchParams.set('includeTabsContent', 'true');
    // Reject pending suggestions so suggested inserts are not hashed as committed text.
    url.searchParams.set('suggestionsViewMode', 'PREVIEW_WITHOUT_SUGGESTIONS');
    const doc = await googleJsonFetch<DriveDocumentApiResource>(tokens, url, 'Docs');
    const formatted = formatDriveDocumentFromApi(doc);
    const body = Buffer.from(formatted, 'utf8');
    if (body.byteLength > MAX_HARVEST_BYTES) return null;
    return { body, contentType: 'text/plain', filenameSuffix: '.txt' };
  } catch (error) {
    if (isResponseTooLarge(error)) return null;
    throw error;
  }
}

async function sheetsFetchJson<T>(tokens: DriveTokens, url: URL): Promise<T> {
  return googleJsonFetch<T>(tokens, url, 'Sheets');
}

async function sheetsBatchGetValues(
  tokens: DriveTokens,
  spreadsheetId: string,
  titles: string[],
): Promise<unknown[][][]> {
  const rowsByTitle: unknown[][][] = titles.map(() => []);
  for (let offset = 0; offset < titles.length; offset += SHEETS_BATCH_RANGE_LIMIT) {
    const chunk = titles.slice(offset, offset + SHEETS_BATCH_RANGE_LIMIT);
    const url = new URL(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet`);
    url.searchParams.set('majorDimension', 'ROWS');
    url.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
    for (const title of chunk) {
      url.searchParams.append('ranges', quoteSheetsA1SheetName(title));
    }
    const page = await sheetsFetchJson<{ valueRanges?: SheetsValueRange[] }>(tokens, url);
    const valueRanges = page.valueRanges ?? [];
    for (let index = 0; index < chunk.length; index++) {
      rowsByTitle[offset + index] = valueRanges[index]?.values ?? [];
    }
  }
  return rowsByTitle;
}

async function downloadSpreadsheetWorkbook(
  tokens: DriveTokens,
  fileId: string,
): Promise<{ body: Buffer; contentType: string; filenameSuffix: string } | null> {
  try {
    const metaUrl = new URL(`${SHEETS_BASE}/${encodeURIComponent(fileId)}`);
    metaUrl.searchParams.set('fields', 'sheets.properties(title,index)');
    const meta = await sheetsFetchJson<SheetsSpreadsheetMeta>(tokens, metaUrl);
    const tabs = [...(meta.sheets ?? [])]
      .map((sheet) => sheet.properties)
      .filter((properties): properties is SheetsTabProperties & { title: string } =>
        Boolean(properties?.title),
      )
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
    const values =
      tabs.length > 0
        ? await sheetsBatchGetValues(
            tokens,
            fileId,
            tabs.map((tab) => tab.title),
          )
        : [];
    const workbook = formatDriveSpreadsheetWorkbook(
      tabs.map((tab, index) => ({ title: tab.title, rows: values[index] ?? [] })),
    );
    const body = Buffer.from(workbook, 'utf8');
    if (body.byteLength > MAX_HARVEST_BYTES) return null;
    return { body, contentType: 'text/plain', filenameSuffix: '.txt' };
  } catch (error) {
    if (isResponseTooLarge(error)) return null;
    throw error;
  }
}

async function downloadFileBody(
  tokens: DriveTokens,
  fileId: string,
  mimeType: string,
): Promise<{ body: Buffer; contentType: string; filenameSuffix: string } | null> {
  if (mimeType === 'application/vnd.google-apps.document') {
    return downloadDocumentTabs(tokens, fileId);
  }
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    return downloadSpreadsheetWorkbook(tokens, fileId);
  }
  const spec = exportSpec(mimeType);
  if (!spec) return null;
  const url = `${DRIVE_BASE}${spec.urlPath.replace('{id}', encodeURIComponent(fileId))}`;
  let res: Response;
  try {
    res = await fetch(
      url,
      { headers: { authorization: `Bearer ${tokens.access_token}` } },
      { maxResponseBytes: MAX_HARVEST_BYTES },
    );
  } catch (err) {
    if (isResponseTooLarge(err)) {
      return null;
    }
    throw err;
  }
  if (!res.ok) {
    throw new Error(`Drive download ${fileId} ${String(res.status)}`);
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_HARVEST_BYTES) return null;
  const contentType = res.headers.get('content-type') ?? spec.contentType;
  return { body: Buffer.from(ab), contentType, filenameSuffix: spec.suffix };
}

function driveMimeNeedsPaidExtract(mimeType: string): boolean {
  return (
    mimeType === 'application/pdf' ||
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.google-apps.presentation' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

function downloadedBodyNeedsPaidExtract(contentType: string): boolean {
  const ct = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  return (
    ct === 'application/pdf' ||
    ct === 'application/msword' ||
    ct.includes('officedocument') ||
    ct.includes('msword')
  );
}

interface LoadedDriveText {
  text: string;
  skippedReason?: string;
  extractError?: string;
  extractCapReason?: 'file' | 'connection';
  consumeReadyExtract?: boolean;
  rescheduleExtract?: boolean;
}

async function consumeReadyDriveExtract(
  ctx: SyncContext,
  fileId: string,
  loaded: LoadedDriveText,
): Promise<void> {
  if (loaded.consumeReadyExtract) await ctx.consumeTransientDriveExtract?.(fileId);
}

async function discardTransientDriveExtract(ctx: SyncContext, fileId: string): Promise<void> {
  if (ctx.cancelTransientDriveExtract) {
    await ctx.cancelTransientDriveExtract(fileId);
    return;
  }
  await ctx.consumeTransientDriveExtract?.(fileId);
}

async function discardTrackedDriveFile(
  ctx: SyncContext,
  fileId: string,
  reason: 'missing' | 'out_of_scope' | 'removed' | 'unsupported_mime',
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (ctx.discardDriveTrackedFile) {
    await ctx.discardDriveTrackedFile(fileId);
  } else {
    await ctx.deleteDriveSnapshotsForFile?.(fileId);
    await discardTransientDriveExtract(ctx, fileId);
  }
  await ctx.recordAudit(`drive_file_${reason}`, { file_id: fileId, ...extra });
}

async function loadDriveText(
  integrationId: string,
  tokens: DriveTokens,
  file: DriveFile,
  ctx: SyncContext,
): Promise<LoadedDriveText> {
  const fileRevisionId = driveFileContentRevision(file);
  if (driveMimeNeedsPaidExtract(file.mimeType) && ctx.loadTransientDriveExtract) {
    const existing = await ctx.loadTransientDriveExtract(file.id);
    const revisionMatches = driveExtractMatchesFileRevision(existing?.revisionId, fileRevisionId);
    if (existing?.status === 'ready' && revisionMatches) {
      if (!existing.text.trim()) {
        return { text: '', skippedReason: 'extract_empty', consumeReadyExtract: true };
      }
      return { text: existing.text, consumeReadyExtract: true };
    }
    if (existing?.status === 'failed') {
      if (!ctx.consumeTransientDriveExtract) {
        return { text: '', skippedReason: 'extract_failed', extractError: existing.error };
      }
      const terminal = isDriveExtractResultTooLarge(existing.error);
      if (terminal) {
        await ctx.consumeTransientDriveExtract(file.id);
        return { text: '', skippedReason: 'extract_failed', extractError: existing.error };
      }
      await ctx.recordAudit('drive_extract_failed', {
        file_id: file.id,
        mime_type: file.mimeType,
        error: existing.error,
        retrying: true,
      });
      await ctx.consumeTransientDriveExtract(file.id);
      // Fall through: take a new extract slot (the daily budget is the bound)
      // and enqueue again after a config fix or a later edit.
    } else if (existing?.status === 'pending' && revisionMatches) {
      return {
        text: '',
        skippedReason: 'extract_pending',
        ...(existing.reschedule ? { rescheduleExtract: true } : {}),
      };
    } else if (existing && !revisionMatches) {
      await ctx.recordAudit('drive_extract_stale_revision', {
        file_id: file.id,
        mime_type: file.mimeType,
        status: existing.status,
        stored_revision: existing.revisionId ?? null,
        file_revision: fileRevisionId,
      });
      await discardTransientDriveExtract(ctx, file.id);
    }
  }

  const download = await downloadFileBody(tokens, file.id, file.mimeType);
  if (!download) {
    return {
      text: '',
      skippedReason: file.mimeType.startsWith('application/vnd.google-apps.')
        ? 'unsupported_google_app_mime'
        : 'too_large_or_unsupported',
    };
  }
  if (
    driveMimeNeedsPaidExtract(file.mimeType) ||
    downloadedBodyNeedsPaidExtract(download.contentType)
  ) {
    const extractSlot = ctx.takeDriveExtractSlot
      ? await ctx.takeDriveExtractSlot({ integrationId, fileId: file.id })
      : await takeDriveExtractSlot({ integrationId, fileId: file.id });
    if (!extractSlot.allowed) {
      return {
        text: '',
        skippedReason: 'extract_capped',
        extractCapReason: extractSlot.reason,
      };
    }
    if (!ctx.enqueueTransientDriveExtract) {
      return { text: '', skippedReason: 'extract_unavailable' };
    }
    await ctx.enqueueTransientDriveExtract({
      fileId: file.id,
      filename: `${file.name}${download.filenameSuffix}`,
      contentType: download.contentType,
      body: download.body,
      ...(fileRevisionId ? { revisionId: fileRevisionId } : {}),
    });
    return { text: '', skippedReason: 'extract_enqueued' };
  }
  return { text: download.body.toString('utf8') };
}

async function paginateDriveList<TItem>(
  tokens: DriveTokens,
  path: string,
  params: Record<string, string>,
  readItems: (page: Record<string, unknown> | null) => TItem[],
): Promise<TItem[]> {
  const items: TItem[] = [];
  let pageToken: string | undefined;
  let safety = 0;
  while (safety++ < DRIVE_METADATA_MAX_PAGES) {
    const page = await driveGetOptional<Record<string, unknown>>(tokens, path, {
      ...params,
      pageSize: DRIVE_METADATA_PAGE_SIZE,
      ...(pageToken ? { pageToken } : {}),
    });
    items.push(...readItems(page));
    const next = typeof page?.nextPageToken === 'string' ? page.nextPageToken : undefined;
    if (!next) return items;
    pageToken = next;
  }
  return items;
}

async function listDriveComments(tokens: DriveTokens, fileId: string): Promise<DriveComment[]> {
  return paginateDriveList(
    tokens,
    `/files/${encodeURIComponent(fileId)}/comments`,
    {
      fields:
        'nextPageToken,comments(id,content,resolved,modifiedTime,author(displayName,emailAddress),replies(id,content,modifiedTime,author(displayName,emailAddress)))',
      includeDeleted: 'false',
    },
    (page) => (Array.isArray(page?.comments) ? (page.comments as DriveComment[]) : []),
  );
}

async function listDrivePermissions(
  tokens: DriveTokens,
  fileId: string,
): Promise<DrivePermission[]> {
  // Shared-drive files.get never populates `permissions`; permissions.list is
  // the paginated ACL surface for both My Drive and shared drives.
  return paginateDriveList(
    tokens,
    `/files/${encodeURIComponent(fileId)}/permissions`,
    {
      fields: 'nextPageToken,permissions(id,type,role,emailAddress,domain)',
      supportsAllDrives: 'true',
    },
    (page) => (Array.isArray(page?.permissions) ? (page.permissions as DrivePermission[]) : []),
  );
}

function commentsFingerprint(comments: DriveComment[]): string {
  return hashDrivePayload(JSON.stringify(driveCommentsHashEntries(comments, hashDrivePayload)));
}

function permissionsFingerprint(permissions: DrivePermission[]): string {
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

function clientShareSignals(permissions: DrivePermission[], teamDomains: string[]): string[] {
  const team = new Set(teamDomains.map((domain) => domain.toLowerCase()));
  const signals = new Set<string>();
  for (const permission of permissions) {
    if (permission.type === 'anyone') signals.add('shared_anyone');
    const domain = (
      permission.domain ??
      permission.emailAddress?.slice(permission.emailAddress.lastIndexOf('@') + 1)
    )?.toLowerCase();
    if (domain && domain.length > 0 && !team.has(domain)) signals.add('shared_external_domain');
  }
  return [...signals];
}

function commentSignals(comments: DriveComment[], commentsChanged: boolean): string[] {
  if (!commentsChanged) return [];
  const signals = ['comment_changed'];
  if (comments.some((comment) => comment.resolved)) signals.push('comment_resolved');
  return signals;
}

async function persistDriveSnapshot(
  ctx: SyncContext,
  fileId: string,
  snapshot: {
    contentHash: string;
    snapshotText: string;
    commentsHash: string;
    permissionsHash: string;
    mimeType: string;
    commentsSnapshot: ReturnType<typeof compactDriveComments>;
    snapshotLocate: ReturnType<typeof buildDriveSnapshotLocate>;
  },
  ancestry: DriveObjectLinkHints,
): Promise<void> {
  if (!ctx.saveDriveSnapshot) return;
  await ctx.saveDriveSnapshot({ fileId, ...snapshot, ancestry });
}

function snapshotFromAdvanceDecision(
  decision: ReturnType<typeof decideDriveSnapshotAdvance>,
  nextLocate: ReturnType<typeof buildDriveSnapshotLocate>,
  mimeType: string,
): Parameters<typeof persistDriveSnapshot>[2] {
  const locate = decision.advanceText
    ? (decision.snapshot.snapshotLocate ?? nextLocate)
    : (decision.snapshot.snapshotLocate ??
      buildDriveSnapshotLocate(decision.snapshot.snapshotText));
  return {
    contentHash: decision.snapshot.contentHash,
    snapshotText: decision.snapshot.snapshotText,
    commentsHash: decision.snapshot.commentsHash,
    permissionsHash: decision.snapshot.permissionsHash,
    mimeType,
    commentsSnapshot: decision.snapshot.commentsSnapshot,
    snapshotLocate: locate,
  };
}

function driveDebounceCursorKey(fileId: string): string {
  return `drive.debounce.${fileId}`;
}

async function scheduleTrackedDescendantsForFolderAcl(
  integration: IntegrationRow,
  folderId: string,
  ctx: SyncContext,
): Promise<void> {
  if (!ctx.listDriveTrackedDescendantFileIds) return;
  const fileIds = await ctx.listDriveTrackedDescendantFileIds(folderId);
  for (const fileId of fileIds) {
    await scheduleFileCapture(integration, fileId, ctx, 'drive_folder_acl');
  }
}

async function scheduleFileCapture(
  integration: IntegrationRow,
  fileId: string,
  ctx: SyncContext,
  reason: string,
): Promise<void> {
  if (!ctx.scheduleTargetedSync) return;
  const existing = (await ctx.loadCursor(driveDebounceCursorKey(fileId))) as DriveCursor;
  const plan = driveDebouncePlan(existing);
  await ctx.saveCursor(driveDebounceCursorKey(fileId), {
    firstQueuedAt: plan.firstQueuedAt,
    quietUntil: plan.quietUntil,
  });
  await ctx.scheduleTargetedSync(
    {
      integrationId: integration.id,
      teamId: integration.teamId,
      triggeredBy: 'webhook',
      resourceType: DRIVE_FILE_KIND,
      externalId: fileId,
      reason,
    },
    { delayMs: plan.delayMs, replaceDelayed: true },
  );
}

async function scheduleExtractResume(
  integration: IntegrationRow,
  fileId: string,
  ctx: SyncContext,
): Promise<void> {
  if (!ctx.scheduleTargetedSync) return;
  await ctx.scheduleTargetedSync(
    {
      integrationId: integration.id,
      teamId: integration.teamId,
      triggeredBy: 'webhook',
      resourceType: DRIVE_FILE_KIND,
      externalId: fileId,
      reason: 'drive_transient_extract',
    },
    { delayMs: 0 },
  );
}

function packDriveEvidence(input: {
  summary: string;
  hunks: string[];
  commentPreview: string;
  previousText: string;
  nextText: string;
}): ReturnType<typeof packDriveChangeEvents> {
  const packed = packDriveChangeEvents(input);
  if (packed) return packed;
  if (!input.commentPreview.trim()) return null;
  return packDriveChangeEvents({ ...input, hunks: [] });
}

async function fetchChanges(
  integration: IntegrationRow,
  tokens: DriveTokens,
  selections: { kind: string; externalId: string }[],
  ctx: SyncContext,
  resourceType: string,
): Promise<SyncResult | undefined> {
  const continuation = { resourceType: 'drive.changes', externalId: integration.id };
  const scope = await resolveDriveScope(tokens, selections);
  if (
    scope.files.size === 0 &&
    scope.folders.size === 0 &&
    scope.sharedDrives.size === 0 &&
    !scope.watchesRoot
  ) {
    return undefined;
  }
  try {
    let cursor = (await ctx.loadCursor(resourceType)) as DriveCursor;
    if (!cursor.page_token) {
      cursor = { page_token: await startPageToken(tokens) };
      await ctx.saveCursor(resourceType, cursor);
    }
    let pageToken = cursor.page_token;
    let safety = 0;
    const ancestorCache = createDriveAncestryCache();
    while (pageToken && safety++ < 50) {
      const page = await driveGet<DriveChangesPage>(tokens, '/changes', {
        pageToken,
        includeRemoved: 'true',
        fields: `changes(changeType,removed,time,fileId,file(${FILE_FIELDS})),nextPageToken,newStartPageToken`,
        pageSize: '100',
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
      });
      for (const change of page.changes ?? []) {
        const fileId = change.fileId;
        if (!fileId) continue;
        if (change.removed) {
          await discardTrackedDriveFile(ctx, fileId, 'removed');
          continue;
        }
        const file = change.file;
        if (!file) continue;
        const mimeType = file.shortcutDetails?.targetMimeType ?? file.mimeType;
        if (mimeType === 'application/vnd.google-apps.folder') {
          await scheduleTrackedDescendantsForFolderAcl(integration, fileId, ctx);
          continue;
        }
        if (!isSupportedDriveMimeType(mimeType)) {
          await discardTrackedDriveFile(ctx, fileId, 'unsupported_mime', { mime_type: mimeType });
          continue;
        }
        const membership = await fileInSelectedSubtree(tokens, file, scope, ancestorCache);
        if (!membership.inScope) {
          await discardTrackedDriveFile(ctx, fileId, 'out_of_scope');
          continue;
        }
        await scheduleFileCapture(integration, file.id, ctx, 'drive_watch');
      }
      if (page.nextPageToken) {
        pageToken = page.nextPageToken;
        await ctx.saveCursor(resourceType, { page_token: pageToken });
      } else if (page.newStartPageToken) {
        await ctx.saveCursor(resourceType, { page_token: page.newStartPageToken });
        return;
      } else {
        return;
      }
    }
    if (pageToken) {
      if (ctx.saveCursorWithContinuations)
        await ctx.saveCursorWithContinuations(resourceType, { page_token: pageToken }, [
          continuation,
        ]);
      else await ctx.saveCursor(resourceType, { page_token: pageToken });
      await ctx.recordAudit('drive_page_cap_hit', {
        integration_id: integration.id,
        next_page_token: pageToken,
      });
      log.warn({ integrationId: integration.id }, 'drive changes hit page cap');
      return { continuations: [continuation] };
    }
    return undefined;
  } catch (error) {
    if (error instanceof Error) throw attachSyncContinuation(error, continuation);
    throw error;
  }
}

function actorFromFile(file: DriveFile): IntegrationEvent['actor'] {
  const owner = file.owners?.[0];
  if (!owner) return null;
  return {
    ...(owner.displayName ? { name: owner.displayName } : {}),
    ...(owner.emailAddress ? { email: owner.emailAddress } : {}),
  };
}

function appendBounded(parts: string[], next: string, maxChars: number): void {
  const trimmed = next.trim();
  if (!trimmed) return;
  const used = parts.join('\n\n').length;
  const sep = parts.length > 0 ? 2 : 0;
  const remaining = maxChars - used - sep;
  if (remaining <= 0) return;
  parts.push(trimmed.slice(0, remaining));
}

/** Pack Drive event text so comment evidence cannot be sliced off by hunks. */
export function packDriveEventContent(input: {
  summary: string;
  hunkPreview: string;
  commentPreview: string;
  maxChars?: number;
  commentBudget?: number;
}): string {
  const maxChars = input.maxChars ?? DRIVE_EVENT_CONTENT_MAX_CHARS;
  const parts: string[] = [];
  appendBounded(parts, input.summary, maxChars);
  const comment = input.commentPreview.trim();
  if (comment) {
    const used = parts.join('\n\n').length;
    const sep = parts.length > 0 ? 2 : 0;
    const remaining = Math.max(0, maxChars - used - sep);
    const budget = input.commentBudget ?? remaining;
    const reserved = Math.min(comment.length, budget, remaining);
    appendBounded(parts, comment.slice(0, reserved), maxChars);
  }
  appendBounded(parts, input.hunkPreview, maxChars);
  return parts.join('\n\n');
}

function packedHunksFitUntruncated(input: {
  summary: string;
  commentPreview: string;
  hunks: string[];
  maxChars: number;
}): boolean {
  const hunkPreview = input.hunks.join('\n');
  if (!hunkPreview) return true;
  const packed = packDriveEventContent({
    summary: input.summary,
    commentPreview: input.commentPreview,
    hunkPreview,
    maxChars: input.maxChars,
  });
  return packed.includes(hunkPreview);
}

/**
 * Split Drive event text so every input hunk appears untruncated in some event.
 * Changed comments take remaining space in the 4000-char cap and continue in
 * later events when they are longer than one event. If a changed span would be
 * dropped, return null so the caller does not advance the snapshot baseline.
 */
export function packDriveChangeEvents(input: {
  summary: string;
  hunks: string[];
  commentPreview: string;
  previousText: string;
  nextText: string;
  maxChars?: number;
}): { contentText: string; hunks: string[] }[] | null {
  const maxChars = input.maxChars ?? DRIVE_EVENT_CONTENT_MAX_CHARS;
  const events: { contentText: string; hunks: string[] }[] = [];
  let remainingHunks = [...input.hunks];
  let remainingComment = input.commentPreview.trim();
  let includeSummary = true;
  const commentEventBudget = Math.max(
    2,
    Math.ceil((remainingComment.length || 1) / Math.max(1, maxChars - 8)),
  );
  while (remainingHunks.length > 0 || remainingComment.length > 0 || events.length === 0) {
    const summary = includeSummary ? input.summary : '';
    const summaryText = summary.trim();
    const commentSep = summaryText.length > 0 && remainingComment.length > 0 ? 2 : 0;
    const commentRoom = Math.max(0, maxChars - summaryText.length - commentSep);
    if (remainingComment.length > 0 && commentRoom === 0) {
      if (includeSummary && summaryText.length > 0) {
        events.push({
          contentText: packDriveEventContent({
            summary,
            hunkPreview: '',
            commentPreview: '',
            maxChars,
          }),
          hunks: [],
        });
        includeSummary = false;
        continue;
      }
      return null;
    }
    const commentSlice = remainingComment.slice(0, commentRoom);
    const commentOverflow = remainingComment.length > commentSlice.length;
    const fitted: string[] = [];
    if (!commentOverflow) {
      for (const hunk of remainingHunks) {
        if (
          packedHunksFitUntruncated({
            summary,
            commentPreview: commentSlice,
            hunks: [...fitted, hunk],
            maxChars,
          })
        ) {
          fitted.push(hunk);
        } else {
          break;
        }
      }
    }
    if (fitted.length === 0 && remainingHunks.length > 0 && commentSlice.length === 0) {
      if (remainingComment.length > 0 && commentRoom === 0 && includeSummary) {
        events.push({
          contentText: packDriveEventContent({
            summary,
            hunkPreview: '',
            commentPreview: '',
            maxChars,
          }),
          hunks: [],
        });
        includeSummary = false;
        continue;
      }
      return null;
    }
    events.push({
      contentText: packDriveEventContent({
        summary,
        hunkPreview: fitted.join('\n'),
        commentPreview: commentSlice,
        maxChars,
      }),
      hunks: fitted,
    });
    remainingComment = remainingComment.slice(commentSlice.length);
    remainingHunks = remainingHunks.slice(fitted.length);
    includeSummary = false;
    if (remainingHunks.length === 0 && remainingComment.length === 0) break;
    if (events.length > input.hunks.length + commentEventBudget + 2) return null;
  }
  const packedHunks = events.flatMap((event) => event.hunks);
  if (packedHunks.length !== input.hunks.length) return null;
  if (packedHunks.some((hunk, index) => hunk !== input.hunks[index])) return null;
  const blob = events.map((event) => event.contentText).join('');
  if (input.hunks.some((hunk) => hunk.length > 0 && !blob.includes(hunk))) return null;
  if (
    input.hunks.length > 0 &&
    input.previousText !== input.nextText &&
    !driveHunksContainChangedSpan(packedHunks, input.previousText, input.nextText)
  ) {
    return null;
  }
  return events;
}

async function processDriveFile(
  integration: IntegrationRow,
  tokens: DriveTokens,
  selections: { kind: string; externalId: string }[],
  ctx: SyncContext,
  fileId: string,
): Promise<SyncResult | undefined> {
  const scope = await resolveDriveScope(tokens, selections);
  const file = await driveGetOptional<DriveFile>(tokens, `/files/${encodeURIComponent(fileId)}`, {
    fields: FILE_FIELDS,
    supportsAllDrives: 'true',
  });
  // The delayed job is the end of this editing burst. Clear the quiet-window
  // cursor so the next changes.watch ping starts a fresh 15-minute debounce.
  await ctx.saveCursor(driveDebounceCursorKey(fileId), {});
  if (!file) {
    await discardTrackedDriveFile(ctx, fileId, 'missing');
    return;
  }
  const membership = await fileInSelectedSubtree(tokens, file, scope, createDriveAncestryCache());
  const snapshotAncestry = driveSnapshotAncestryFromMembership({
    ...(file.parents ? { parents: file.parents } : {}),
    ...(file.driveId ? { driveId: file.driveId } : {}),
    matchedAncestorId: membership.matchedAncestorId,
    ancestryIds: membership.ancestryIds,
  });
  if (!membership.inScope) {
    await discardTrackedDriveFile(ctx, fileId, 'out_of_scope');
    return;
  }
  if (!isSupportedDriveMimeType(file.mimeType)) {
    await discardTrackedDriveFile(ctx, fileId, 'unsupported_mime', { mime_type: file.mimeType });
    return;
  }

  const [comments, permissions, loaded] = await Promise.all([
    listDriveComments(tokens, file.id),
    listDrivePermissions(tokens, file.id),
    loadDriveText(integration.id, tokens, file, ctx),
  ]);
  if (loaded.skippedReason === 'extract_enqueued') {
    await ctx.recordAudit('drive_extract_enqueued', {
      file_id: fileId,
      mime_type: file.mimeType,
    });
    return;
  }
  if (loaded.skippedReason === 'extract_pending') {
    await ctx.recordAudit('drive_extract_pending', { file_id: fileId, mime_type: file.mimeType });
    if (loaded.rescheduleExtract) await scheduleExtractResume(integration, fileId, ctx);
    return;
  }
  if (loaded.skippedReason === 'extract_failed') {
    await ctx.recordAudit('drive_extract_failed', {
      file_id: fileId,
      mime_type: file.mimeType,
      error: loaded.extractError ?? 'extract_failed',
    });
    return;
  }
  if (loaded.skippedReason === 'extract_capped') {
    await ctx.recordAudit('drive_extract_capped', {
      file_id: fileId,
      mime_type: file.mimeType,
      reason: loaded.extractCapReason ?? 'connection',
    });
    return;
  }
  if (loaded.skippedReason) {
    await consumeReadyDriveExtract(ctx, file.id, loaded);
    await ctx.recordAudit('drive_extract_skipped', {
      file_id: fileId,
      mime_type: file.mimeType,
      reason: loaded.skippedReason,
    });
    return;
  }

  const fullText = loaded.text;
  const snapshotText = truncateDriveSnapshot(fullText);
  const snapshotLocate = buildDriveSnapshotLocate(fullText);
  const contentHash = hashDrivePayload(fullText);
  const commentsHash = commentsFingerprint(comments);
  const permissionsHash = permissionsFingerprint(permissions);
  const previous = ctx.loadLatestDriveSnapshot ? await ctx.loadLatestDriveSnapshot(file.id) : null;
  const commentsChanged = previous?.commentsHash !== commentsHash;
  const permissionsChanged = previous?.permissionsHash !== permissionsHash;
  const teamDomains = ctx.listTeamEmailDomains ? await ctx.listTeamEmailDomains() : [];
  const strongSignals = [
    ...commentSignals(comments, commentsChanged),
    ...(permissionsChanged ? clientShareSignals(permissions, teamDomains) : []),
  ];
  const diff = diffDriveSnapshots({
    previousSnapshotText: previous?.snapshotText ?? '',
    previousLocate: parseDriveSnapshotLocate(previous?.snapshotLocate),
    nextFullText: fullText,
    nextContentHash: contentHash,
    ...(previous?.contentHash ? { previousContentHash: previous.contentHash } : {}),
  });
  const snapshot = {
    contentHash,
    snapshotText,
    snapshotLocate,
    commentsHash,
    permissionsHash,
    mimeType: file.mimeType,
    commentsSnapshot: compactDriveComments(comments),
  };

  if (previous?.contentHash === contentHash && !commentsChanged && !permissionsChanged) {
    const previousLocate = parseDriveSnapshotLocate(previous.snapshotLocate);
    const needsChunkBackfill = !previousLocate || previousLocate.chunkTexts.length === 0;
    const needsAncestryRefresh = !driveObjectLinkHintsEqual(previous.ancestry, snapshotAncestry);
    if (needsChunkBackfill || needsAncestryRefresh) {
      await persistDriveSnapshot(ctx, file.id, snapshot, snapshotAncestry);
    }
    await consumeReadyDriveExtract(ctx, file.id, loaded);
    return;
  }

  if (!previous) {
    await persistDriveSnapshot(ctx, file.id, snapshot, snapshotAncestry);
    await consumeReadyDriveExtract(ctx, file.id, loaded);
    await ctx.recordAudit('drive_baseline_saved', { file_id: fileId });
    return;
  }

  const previousLocate = parseDriveSnapshotLocate(previous.snapshotLocate);
  const previousFull =
    previousLocate &&
    previousLocate.chunkTexts.length === previousLocate.chunkHashes.length &&
    previousLocate.chunkTexts.join('').length === previousLocate.length
      ? previousLocate.chunkTexts.join('')
      : previous.snapshotText;
  const previousComments = parseDriveCommentSnapshots(previous.commentsSnapshot);
  const commentPreview = commentsChanged ? commentEventContext(comments, previousComments) : '';
  const previousFields = {
    contentHash: previous.contentHash,
    snapshotText: previous.snapshotText,
    snapshotLocate: previousLocate,
    commentsHash: previous.commentsHash ?? '',
    commentsSnapshot: previousComments,
    permissionsHash: previous.permissionsHash ?? '',
    mimeType: previous.mimeType,
  };

  const decideFromPacked = (packed: ReturnType<typeof packDriveChangeEvents>) =>
    decideDriveSnapshotAdvance({
      previous: previousFields,
      next: snapshot,
      diff,
      previousText: previousFull,
      nextText: fullText,
      packedEvents: packed,
    });

  if (
    strongSignals.length === 0 &&
    !permissionsChanged &&
    (!driveDiffHasEvidence(diff) ||
      (diff.reason === 'identical' && previous.contentHash !== contentHash))
  ) {
    const decision = decideFromPacked(null);
    if (decision.persist) {
      await persistDriveSnapshot(
        ctx,
        file.id,
        snapshotFromAdvanceDecision(decision, snapshot.snapshotLocate, file.mimeType),
        snapshotAncestry,
      );
    }
    await consumeReadyDriveExtract(ctx, file.id, loaded);
    await ctx.recordAudit('drive_change_skipped', {
      file_id: fileId,
      reason: 'no_evidence',
    });
    return;
  }

  if (!diff.changed && strongSignals.length === 0) {
    const decision = decideFromPacked(null);
    if (decision.persist) {
      await persistDriveSnapshot(
        ctx,
        file.id,
        snapshotFromAdvanceDecision(decision, snapshot.snapshotLocate, file.mimeType),
        snapshotAncestry,
      );
    }
    await consumeReadyDriveExtract(ctx, file.id, loaded);
    await ctx.recordAudit('drive_change_skipped', {
      file_id: fileId,
      reason: diff.reason,
    });
    return;
  }

  const slot = ctx.takeDriveProcessSlot
    ? await ctx.takeDriveProcessSlot({ integrationId: integration.id, fileId: file.id })
    : await takeDriveProcessSlot({ integrationId: integration.id, fileId: file.id });
  if (!slot.allowed) {
    await ctx.recordAudit('drive_process_capped', {
      file_id: fileId,
      reason: slot.reason,
      retry_after_ms: slot.retryAfterMs,
    });
    return {
      continuations: [
        {
          resourceType: DRIVE_FILE_KIND,
          externalId: fileId,
          retryAt: new Date(Date.now() + slot.retryAfterMs),
        },
      ],
    };
  }

  let judge: DriveChangeJudge;
  if (strongSignals.length > 0) {
    judge = {
      matters: true,
      reason: strongSignals.some((signal) => signal.startsWith('shared_'))
        ? 'client_share'
        : 'comment',
      summary: `Drive change on "${file.name}" (${strongSignals.join(', ')})`,
    };
  } else if (ctx.judgeDriveChange) {
    judge = await ctx.judgeDriveChange({
      fileName: file.name,
      mimeType: file.mimeType,
      hunks: diff.hunks,
      strongSignals,
    });
  } else {
    await ctx.recordAudit('drive_judge_unavailable', { file_id: fileId });
    return;
  }

  const packed = packDriveEvidence({
    summary: judge.summary,
    hunks: diff.hunks,
    commentPreview,
    previousText: previousFull,
    nextText: fullText,
  });
  const decision = decideFromPacked(packed);

  if (!judge.matters || judge.reason === 'noise') {
    if (decision.persist) {
      await persistDriveSnapshot(
        ctx,
        file.id,
        snapshotFromAdvanceDecision(decision, snapshot.snapshotLocate, file.mimeType),
        snapshotAncestry,
      );
    }
    await consumeReadyDriveExtract(ctx, file.id, loaded);
    await ctx.recordAudit('drive_change_noise', { file_id: fileId, reason: judge.reason });
    return;
  }

  if (!packed) {
    await ctx.recordAudit('drive_pack_incomplete', {
      file_id: fileId,
      hunk_count: diff.hunks.length,
    });
    if (decision.persist) {
      await persistDriveSnapshot(
        ctx,
        file.id,
        snapshotFromAdvanceDecision(decision, snapshot.snapshotLocate, file.mimeType),
        snapshotAncestry,
      );
    }
    await consumeReadyDriveExtract(ctx, file.id, loaded);
    return;
  }

  if (
    !decision.persist &&
    !decision.advanceText &&
    !decision.advanceComments &&
    !permissionsChanged
  ) {
    await consumeReadyDriveExtract(ctx, file.id, loaded);
    await ctx.recordAudit('drive_change_skipped', {
      file_id: fileId,
      reason: 'no_evidence',
    });
    return;
  }

  const linked = ctx.linkedObjectForDriveSelection
    ? await ctx.linkedObjectForDriveSelection(
        file.id,
        membership.ancestryIds.length > 0 ? membership.ancestryIds : (file.parents ?? []),
        membership.matchedAncestorId,
        {
          ...(file.driveId ? { driveId: file.driveId } : {}),
          ...(scope.myDriveRootId ? { myDriveRootId: scope.myDriveRootId } : {}),
        },
      )
    : null;
  const occurrence = driveFileContentRevision(file) ?? 'unknown';
  const events: IntegrationEvent[] = packed.map((part, index) => ({
    dedupKey: driveFileChangeDedupKey({
      fileId: file.id,
      occurrence,
      contentHash: decision.snapshot.contentHash,
      commentsHash: decision.snapshot.commentsHash,
      permissionsHash: decision.snapshot.permissionsHash,
      ...(packed.length > 1 ? { part: index + 1 } : {}),
    }),
    provider: 'google_drive',
    signalClass: 'communication',
    eventClass: 'communication',
    externalObjectId: file.id,
    externalEventId: occurrence,
    eventType: 'file.changed',
    occurredAt: file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
    actor: actorFromFile(file) ?? null,
    contentText: part.contentText,
    extra: {
      drive: {
        name: file.name,
        mime_type: file.mimeType,
        web_view_link: file.webViewLink ?? null,
        modified_time: file.modifiedTime ?? null,
        drive_id: file.driveId ?? null,
        parents: file.parents ?? [],
        integration_id: integration.id,
        judge_reason: judge.reason,
        strong_signals: strongSignals,
        changed_chars: diff.changedChars,
        ...(packed.length > 1 ? { part: index + 1, parts: packed.length } : {}),
        ...(linked
          ? {
              linked_object_id: linked.id,
              inherited_from: linked.inheritedFrom ?? membership.matchedAncestorId ?? file.id,
              inherited_candidates:
                linked.inheritedCandidates ??
                driveObjectLinkCandidates({
                  fileId: file.id,
                  parentIds: file.parents ?? [],
                  matchedAncestorId: membership.matchedAncestorId,
                  ...(file.driveId ? { driveId: file.driveId } : {}),
                  ...(scope.myDriveRootId ? { myDriveRootId: scope.myDriveRootId } : {}),
                }),
              ...(membership.matchedAncestorId
                ? { matched_ancestor_id: membership.matchedAncestorId }
                : {}),
            }
          : {}),
      },
    },
    ...(linked
      ? {
          objectMap: {
            type: linked.type as NonNullable<IntegrationEvent['objectMap']>['type'],
            canonicalName: linked.canonicalName,
            externalId: linked.id,
            displayTitle: file.name,
            aliases: [file.id],
            ...(file.webViewLink ? { url: file.webViewLink } : {}),
          },
        }
      : {}),
  }));
  await ctx.writeEvents(events);
  if (decision.persist) {
    await persistDriveSnapshot(
      ctx,
      file.id,
      snapshotFromAdvanceDecision(decision, snapshot.snapshotLocate, file.mimeType),
      snapshotAncestry,
    );
  }
  await consumeReadyDriveExtract(ctx, file.id, loaded);
}

function driveWebhookResourceState(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const headers =
    record.headers && typeof record.headers === 'object' && !Array.isArray(record.headers)
      ? (record.headers as Record<string, unknown>)
      : record;
  const state = headers.resourceState ?? headers['x-goog-resource-state'];
  return typeof state === 'string' ? state : null;
}

async function refreshForSync(tokens: unknown, ctx: SyncContext): Promise<DriveTokens> {
  const original = tokens as DriveTokens;
  const refreshed = await ensureAccessToken(original);
  await persistRefreshedTokens(ctx, original, refreshed);
  return refreshed;
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
    let displayName = 'Google Drive';
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
      if (isProviderRateLimitError(err)) throw err;
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

  async listSyncableResources(integration, tokens, ctx): Promise<ProviderResource[]> {
    const original = tokens as DriveTokens;
    const refreshed = await ensureAccessToken(original);
    await persistRefreshedTokens(ctx, original, refreshed);
    try {
      if (ctx?.includeIds && ctx.includeIds.length > 0 && !ctx.parentId && !ctx.query) {
        return await resolveIncludeIds(refreshed, ctx.includeIds);
      }
      if (ctx?.query?.trim()) {
        const found = await searchDriveResources(refreshed, ctx.query);
        if (ctx.includeIds?.length) {
          const included = await resolveIncludeIds(refreshed, ctx.includeIds);
          const seen = new Set(found.map((item) => `${item.kind}\x00${item.externalId}`));
          for (const item of included) {
            const key = `${item.kind}\x00${item.externalId}`;
            if (!seen.has(key)) found.push(item);
          }
        }
        return found;
      }
      if (ctx?.parentId) {
        return await listFolderChildren(refreshed, ctx.parentId);
      }
      return await listTopLevelResources(refreshed);
    } catch (err) {
      if (isProviderRateLimitError(err)) throw err;
      log.warn({ err, integrationId: integration.id }, 'listing drive resources failed');
      throw err;
    }
  },

  async backfill({ integration, tokens, selections, ctx }) {
    if (!selections.some((selection) => driveSelectionIsWatchable(selection.kind))) return;
    const refreshed = await refreshForSync(tokens, ctx);
    const existing = (await ctx.loadCursor('drive.changes')) as DriveCursor;
    if (!existing.page_token) {
      await ctx.saveCursor('drive.changes', { page_token: await startPageToken(refreshed) });
    }
    await ctx.recordAudit('drive_backfill_cursor_set', { integration_id: integration.id });
    return undefined;
  },

  async incrementalSync({ integration, tokens, selections, ctx, target }) {
    if (!selections.some((selection) => driveSelectionIsWatchable(selection.kind))) {
      await ctx.cleanupUncoveredDriveTrackedFiles?.(
        selections.map((selection) => ({
          kind: selection.kind,
          externalId: selection.externalId,
        })),
      );
      return;
    }
    if (target?.resourceType === DRIVE_FILE_KIND) {
      try {
        const refreshed = await refreshForSync(tokens, ctx);
        return await processDriveFile(integration, refreshed, selections, ctx, target.externalId);
      } catch (error) {
        if (error instanceof Error) {
          throw attachSyncContinuation(error, {
            resourceType: DRIVE_FILE_KIND,
            externalId: target.externalId,
          });
        }
        throw error;
      }
    }
    const refreshed = await refreshForSync(tokens, ctx);
    return fetchChanges(
      integration,
      refreshed,
      selections,
      ctx,
      target?.resourceType === 'drive.changes' ? target.resourceType : 'drive.changes',
    );
  },

  async provisionWebhooks({ integration, tokens, selections, existingSubscriptions, ctx }) {
    if (!selections.some((selection) => driveSelectionIsWatchable(selection.kind))) return [];
    const existing = existingSubscriptions?.find(
      (subscription) =>
        subscription.expiresAt && subscription.expiresAt.getTime() > Date.now() + 24 * 3600_000,
    );
    if (existing) return [existing];
    const env = getEnv();
    if (!env.GOOGLE_DRIVE_WEBHOOK_SECRET)
      throw new Error('Google Drive notification setup requires GOOGLE_DRIVE_WEBHOOK_SECRET');
    const original = tokens as DriveTokens;
    const refreshed = await ensureAccessToken(original);
    await persistRefreshedTokens(ctx, original, refreshed);
    const pageToken = await startPageToken(refreshed);
    const token = `${integration.id}.${createHmac('sha256', env.GOOGLE_DRIVE_WEBHOOK_SECRET).update(integration.id).digest('hex')}`;
    const response = await fetch(
      `${DRIVE_BASE}/changes/watch?pageToken=${encodeURIComponent(pageToken)}&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${refreshed.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: randomUUID(),
          type: 'web_hook',
          address: new URL('/api/webhooks/google-drive', env.AUTH_URL).toString(),
          token,
          expiration: String(Date.now() + 7 * 24 * 3600_000),
        }),
      },
    );
    if (!response.ok) throw new Error(`Drive watch failed: ${response.status}`);
    const channel = (await response.json()) as {
      id: string;
      resourceId: string;
      expiration: string;
    };
    if (!channel.id || !channel.resourceId || !Number.isFinite(Number(channel.expiration)))
      throw new Error('Invalid Drive watch response');
    const subscription = {
      resourceKind: 'drive.changes',
      externalResourceId: integration.id,
      eventType: 'change',
      externalSubscriptionId: JSON.stringify({ id: channel.id, resourceId: channel.resourceId }),
      expiresAt: new Date(Number(channel.expiration)),
    };
    await ctx?.persistWebhookSubscription(subscription);
    return [subscription];
  },

  async deprovisionWebhook({ tokens, subscription, ctx }) {
    if (!subscription.externalSubscriptionId) return;
    const original = tokens as DriveTokens;
    const refreshed = await ensureAccessToken(original);
    await persistRefreshedTokens(ctx, original, refreshed);
    const channel = JSON.parse(subscription.externalSubscriptionId) as {
      id: string;
      resourceId: string;
    };
    const response = await fetch(`${DRIVE_BASE}/channels/stop`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${refreshed.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(channel),
    });
    if (!response.ok && response.status !== 404)
      throw new Error(`Drive stop watch failed: ${response.status}`);
  },

  // eslint-disable-next-line @typescript-eslint/require-await
  async handleWebhook({ integration, payload }): Promise<WebhookHandleResult> {
    const state = driveWebhookResourceState(payload);
    if (state === 'sync') {
      return { events: [], syncTasks: [], syncTaskDisposition: 'handled' };
    }
    return {
      events: [],
      syncTasks: [
        {
          integrationId: integration.id,
          teamId: integration.teamId,
          triggeredBy: 'webhook',
          resourceType: 'drive.changes',
          externalId: integration.id,
          reason: 'drive_watch',
        },
      ],
      syncTaskDisposition: 'handled',
    };
  },
};
