import { Buffer } from 'node:buffer';

import type {
  IntegrationEvent,
  IntegrationProvider,
  ObjectMapping,
  OAuthCallbackInput,
  ProviderResource,
} from '#src/integrations/types.js';

import { getEnv } from '#src/env.js';

const AUTH_URL = 'https://auth.monday.com/oauth2/authorize';
const TOKEN_URL = 'https://auth.monday.com/oauth2/token';
const GRAPHQL_URL = 'https://api.monday.com/v2';
const SCOPES = ['boards:read', 'users:read', 'updates:read', 'docs:read'];
const BOARD_PAGE_LIMIT = 100;
const ITEM_PAGE_LIMIT = 100;
const UPDATE_LIMIT = 50;
const DOC_PAGE_LIMIT = 100;
const BLOCK_PAGE_LIMIT = 100;

interface MondayTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_at?: number;
}

interface MondayWorkspace {
  id?: string;
  name?: string;
}

interface MondayColumn {
  id: string;
  title?: string | null;
  type?: string | null;
}

interface MondayBoard {
  id: string;
  name: string;
  updated_at?: string;
  workspace?: MondayWorkspace | null;
  columns?: MondayColumn[];
}

interface MondayColumnValue {
  id: string;
  text?: string | null;
  type?: string;
  value?: unknown;
  updated_at?: string | null;
}

interface MondayActivityLog {
  id: string;
  event: string;
  data?: string | null;
  created_at?: string;
  user_id?: string | null;
}

interface MondayUpdate {
  id: string;
  body?: string | null;
  created_at?: string;
  updated_at?: string | null;
  creator?: { id?: string; name?: string; email?: string | null } | null;
}

interface MondayItem {
  id: string;
  name: string;
  updated_at?: string;
  url?: string;
  creator?: { id?: string; name?: string; email?: string | null } | null;
  parent_item?: { id?: string; name?: string } | null;
  column_values?: MondayColumnValue[];
  updates?: MondayUpdate[];
  subitems?: MondayItem[];
}

interface MondayItemsPage {
  cursor?: string | null;
  items?: MondayItem[];
}

interface MondayDocBlock {
  id: string;
  type?: string | null;
  content?: unknown;
  position?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  parent_block_id?: string | null;
}

interface MondayDoc {
  id: string;
  object_id?: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  url?: string;
  relative_url?: string | null;
  doc_kind?: string;
  workspace?: MondayWorkspace | null;
  workspace_id?: string | null;
  created_by?: { id?: string; name?: string; email?: string | null } | null;
  blocks?: MondayDocBlock[];
}

interface MondayCursor {
  activity_since?: string | undefined;
  item_since?: string | undefined;
  doc_since?: string | undefined;
}

interface NormalizedColumn {
  id: string;
  title: string;
  type: string | null;
  text: string | null;
  value: unknown;
  updated_at: string | null;
}

const ITEM_FIELDS = `
  id name updated_at url
  creator { id name email }
  parent_item { id name }
  column_values { id text type value updated_at }
  updates(limit: ${String(UPDATE_LIMIT)}) { id body created_at updated_at creator { id name email } }
  subitems {
    id name updated_at url
    creator { id name email }
    parent_item { id name }
    column_values { id text type value updated_at }
    updates(limit: ${String(UPDATE_LIMIT)}) { id body created_at updated_at creator { id name email } }
  }
`;

function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', input.state);
  return url.toString();
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
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) throw new Error(`Monday ${String(res.status)}: ${text}`);
  return parsed;
}

async function gql<T>(
  tokens: MondayTokens,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      authorization: tokens.access_token,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Monday GraphQL ${String(res.status)}: ${text}`);
  const json = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`Monday GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  if (!json.data) throw new Error('Monday GraphQL returned no data');
  return json.data;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function tokenExpiry(body: Record<string, unknown>): number | null {
  const expiresIn = numberValue(body.expires_in);
  return expiresIn ? Date.now() + expiresIn * 1000 : null;
}

function tokenFromBody(body: Record<string, unknown>, previous?: MondayTokens): MondayTokens {
  const access = stringValue(body.access_token);
  if (!access) throw new Error('Monday token exchange returned no access_token');
  const refreshToken =
    stringValue(body.refresh_token) ?? stringValue(body.refreshToken) ?? previous?.refresh_token;
  const tokenType = stringValue(body.token_type) ?? previous?.token_type;
  const scope = stringValue(body.scope) ?? previous?.scope;
  const expiresAt = tokenExpiry(body);
  return {
    access_token: access,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    ...(tokenType ? { token_type: tokenType } : {}),
    ...(scope ? { scope } : {}),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
  };
}

async function refreshAccessToken(tokens: MondayTokens): Promise<MondayTokens> {
  const env = getEnv();
  if (!tokens.refresh_token || !env.MONDAY_CLIENT_ID || !env.MONDAY_CLIENT_SECRET) {
    return tokens;
  }
  const body = await postForm(TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: env.MONDAY_CLIENT_ID,
    client_secret: env.MONDAY_CLIENT_SECRET,
  });
  return tokenFromBody(body, tokens);
}

async function ensureAccessToken(
  tokens: MondayTokens,
  ctx?: { persistTokens(tokens: Record<string, unknown>): Promise<void> },
): Promise<MondayTokens> {
  const shouldRefresh =
    Boolean(tokens.refresh_token) &&
    (!tokens.expires_at || tokens.expires_at <= Date.now() + 60_000);
  if (!shouldRefresh) return tokens;
  const refreshed = await refreshAccessToken(tokens);
  if (
    ctx &&
    (refreshed.access_token !== tokens.access_token ||
      refreshed.refresh_token !== tokens.refresh_token ||
      refreshed.expires_at !== tokens.expires_at)
  ) {
    await ctx.persistTokens(refreshed as unknown as Record<string, unknown>);
  }
  return refreshed;
}

function dateValue(value: unknown, fallback = new Date()): Date {
  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function parseActivityData(data?: string | null): Record<string, unknown> {
  if (!data) return {};
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { raw: data };
  }
}

function mondayStatus(text?: string | null): NonNullable<ObjectMapping['status']> {
  const lowered = text?.toLowerCase() ?? '';
  if (lowered.includes('done') || lowered.includes('complete') || lowered.includes('won')) {
    return 'done';
  }
  if (lowered.includes('working') || lowered.includes('progress') || lowered.includes('active')) {
    return 'in_progress';
  }
  if (lowered.includes('cancel') || lowered.includes('lost')) return 'cancelled';
  return 'open';
}

function actor(
  input?: { id?: string; name?: string; email?: string | null } | null,
): { externalId?: string; name?: string; email?: string } | null {
  if (!input) return null;
  return {
    ...(input.id ? { externalId: input.id } : {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.email ? { email: input.email } : {}),
  };
}

function boardMetadata(board: MondayBoard): Record<string, unknown> {
  return {
    monday_board_id: board.id,
    monday_board_name: board.name,
    monday_workspace_id: board.workspace?.id ?? null,
    monday_workspace_name: board.workspace?.name ?? null,
  };
}

function normalizedColumns(board: MondayBoard, item: MondayItem): NormalizedColumn[] {
  const schemaById = new Map((board.columns ?? []).map((column) => [column.id, column]));
  return (item.column_values ?? []).map((column) => {
    const schema = schemaById.get(column.id);
    return {
      id: column.id,
      title: schema?.title ?? column.id,
      type: column.type ?? schema?.type ?? null,
      text: column.text ?? null,
      value: column.value ?? null,
      updated_at: column.updated_at ?? null,
    };
  });
}

function statusColumn(board: MondayBoard, item: MondayItem): NormalizedColumn | undefined {
  return normalizedColumns(board, item).find((column) => column.type === 'status');
}

function mondayRecordMap(
  board: MondayBoard,
  item: MondayItem,
  kind: 'item' | 'subitem',
): ObjectMapping {
  const status = statusColumn(board, item);
  const parent = item.parent_item;
  return {
    type: 'other',
    canonicalName: `Monday ${kind} ${item.id}: ${item.name}`,
    displayTitle: item.name,
    externalId: item.id,
    status: mondayStatus(status?.text),
    ...(item.url ? { url: item.url } : {}),
    metadata: {
      monday_record_kind: kind,
      ...boardMetadata(board),
      monday_item_id: item.id,
      monday_item_name: item.name,
      monday_parent_item_id: parent?.id ?? null,
      monday_parent_item_name: parent?.name ?? null,
      monday_columns: normalizedColumns(board, item),
    },
  };
}

function boardSchemaEvent(board: MondayBoard): IntegrationEvent {
  const occurredAt = dateValue(board.updated_at);
  return {
    dedupKey: `monday:board-schema:${board.id}:${occurredAt.toISOString()}`,
    provider: 'monday',
    externalObjectId: board.id,
    eventType: 'board.schema',
    occurredAt,
    contentText: [
      `Monday board schema: ${board.name}`,
      ...(board.columns ?? []).map(
        (column) => `Column: ${column.title ?? column.id} (${column.type ?? 'unknown'})`,
      ),
    ].join('\n'),
    extra: { ...boardMetadata(board), columns: board.columns ?? [] },
    objectMap: {
      type: 'other',
      canonicalName: `Monday board ${board.id}: ${board.name}`,
      displayTitle: board.name,
      externalId: `board:${board.id}`,
      metadata: {
        monday_record_kind: 'board',
        ...boardMetadata(board),
        columns: board.columns ?? [],
      },
    },
  };
}

function activityEvent(board: MondayBoard, log: MondayActivityLog): IntegrationEvent {
  const data = parseActivityData(log.data);
  const itemId = stringValue(data.pulse_id) ?? stringValue(data.item_id) ?? `${board.id}:${log.id}`;
  const itemName = stringValue(data.pulse_name) ?? stringValue(data.item_name);
  const columnTitle = stringValue(data.column_title) ?? stringValue(data.column_id);
  const occurredAt = dateValue(log.created_at);
  const eventType =
    log.event === 'create_pulse'
      ? 'item.created'
      : log.event.includes('status')
        ? 'status.changed'
        : log.event.includes('person')
          ? 'owner.changed'
          : 'item.updated';
  const title = itemName ?? `Monday record ${itemId}`;
  return {
    dedupKey: `monday:activity:${board.id}:${log.id}`,
    provider: 'monday',
    externalObjectId: itemId,
    externalEventId: log.id,
    eventType,
    occurredAt,
    actor: log.user_id ? { externalId: log.user_id } : null,
    contentText: [
      `Monday ${eventType.replace('.', ' ')} on ${board.name}: ${title}`,
      columnTitle ? `Column: ${columnTitle}` : null,
      stringValue(data.value) ? `Value: ${stringValue(data.value)}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    extra: {
      ...boardMetadata(board),
      monday_item_id: itemId,
      monday_activity_event: log.event,
      monday_activity_data: data,
    },
    objectMap: {
      type: 'other',
      canonicalName: `Monday record ${itemId}: ${title}`,
      displayTitle: title,
      externalId: itemId,
      status: mondayStatus(stringValue(data.value)),
      metadata: {
        monday_record_kind: 'activity-record',
        ...boardMetadata(board),
        monday_item_id: itemId,
      },
    },
  };
}

function itemEvent(
  board: MondayBoard,
  item: MondayItem,
  kind: 'item' | 'subitem',
): IntegrationEvent {
  const occurredAt = dateValue(item.updated_at);
  const status = statusColumn(board, item);
  return {
    dedupKey: `monday:${kind}:${board.id}:${item.id}:${occurredAt.toISOString()}`,
    provider: 'monday',
    externalObjectId: item.id,
    eventType: kind === 'subitem' ? 'subitem.updated' : 'item.updated',
    occurredAt,
    actor: actor(item.creator),
    contentText: [
      `Monday ${kind} updated on ${board.name}: ${item.name}`,
      item.parent_item?.name ? `Parent: ${item.parent_item.name}` : null,
      status?.text ? `Status: ${status.text}` : null,
      ...normalizedColumns(board, item)
        .filter((column) => column.text && column.type !== 'status')
        .slice(0, 12)
        .map((column) => `${column.title}: ${column.text}`),
    ]
      .filter(Boolean)
      .join('\n'),
    extra: {
      ...boardMetadata(board),
      monday_item_id: item.id,
      monday_parent_item_id: item.parent_item?.id ?? null,
      external_url: item.url ?? null,
      columns: normalizedColumns(board, item),
    },
    objectMap: mondayRecordMap(board, item, kind),
  };
}

function updateEvent(
  board: MondayBoard,
  item: MondayItem,
  update: MondayUpdate,
  kind: 'item' | 'subitem',
): IntegrationEvent {
  const occurredAt = dateValue(update.updated_at ?? update.created_at);
  return {
    dedupKey: `monday:update:${item.id}:${update.id}:${occurredAt.toISOString()}`,
    provider: 'monday',
    externalObjectId: item.id,
    externalEventId: update.id,
    eventType: 'update.created',
    occurredAt,
    actor: actor(update.creator),
    contentText: `Monday update on ${item.name}: ${update.body ?? ''}`.trim(),
    extra: {
      ...boardMetadata(board),
      monday_item_id: item.id,
      monday_record_kind: kind,
      monday_parent_item_id: item.parent_item?.id ?? null,
      monday_update_id: update.id,
      external_url: item.url ?? null,
    },
    objectMap: mondayRecordMap(board, item, kind),
  };
}

function docTextFromBlocks(blocks: MondayDocBlock[] | undefined): string {
  if (!blocks?.length) return '';
  return blocks
    .map((block) => {
      const content = block.content;
      if (typeof content === 'string') return content;
      return JSON.stringify(content ?? {});
    })
    .join('\n');
}

function docMarkdown(doc: MondayDoc): string {
  return [`# ${doc.name}`, '', docTextFromBlocks(doc.blocks)].filter(Boolean).join('\n');
}

function docEvent(doc: MondayDoc): IntegrationEvent {
  const occurredAt = dateValue(doc.updated_at ?? doc.created_at);
  const text = docTextFromBlocks(doc.blocks);
  return {
    dedupKey: `monday:doc:${doc.id}:${occurredAt.toISOString()}`,
    provider: 'monday',
    externalObjectId: doc.id,
    eventType: 'doc.updated',
    occurredAt,
    actor: actor(doc.created_by),
    contentText: [`Monday doc updated: ${doc.name}`, text].filter(Boolean).join('\n'),
    extra: {
      monday_doc_id: doc.id,
      monday_doc_object_id: doc.object_id ?? null,
      monday_workspace_id: doc.workspace_id ?? doc.workspace?.id ?? null,
      monday_workspace_name: doc.workspace?.name ?? null,
      external_url: doc.url ?? null,
      doc_kind: doc.doc_kind ?? null,
      blocks: doc.blocks ?? [],
    },
    objectMap: {
      type: 'document',
      canonicalName: `Monday doc ${doc.id}: ${doc.name}`,
      displayTitle: doc.name,
      externalId: `doc:${doc.id}`,
      ...(doc.url ? { url: doc.url } : {}),
      metadata: {
        monday_record_kind: 'doc',
        monday_doc_id: doc.id,
        monday_doc_object_id: doc.object_id ?? null,
        monday_workspace_id: doc.workspace_id ?? doc.workspace?.id ?? null,
        monday_workspace_name: doc.workspace?.name ?? null,
      },
    },
  };
}

async function fetchBoard(tokens: MondayTokens, boardId: string): Promise<MondayBoard | null> {
  const data = await gql<{ boards: MondayBoard[] }>(
    tokens,
    `query ($ids: [ID!]) {
      boards(ids: $ids) {
        id name updated_at
        workspace { id name }
        columns { id title type }
      }
    }`,
    { ids: [boardId] },
  );
  return data.boards[0] ?? null;
}

async function fetchInitialItemsPage(
  tokens: MondayTokens,
  boardId: string,
): Promise<MondayItemsPage> {
  const data = await gql<{ boards: { items_page?: MondayItemsPage }[] }>(
    tokens,
    `query ($ids: [ID!], $limit: Int!) {
      boards(ids: $ids) {
        items_page(limit: $limit) {
          cursor
          items { ${ITEM_FIELDS} }
        }
      }
    }`,
    { ids: [boardId], limit: ITEM_PAGE_LIMIT },
  );
  return data.boards[0]?.items_page ?? {};
}

async function fetchNextItemsPage(tokens: MondayTokens, cursor: string): Promise<MondayItemsPage> {
  const data = await gql<{ next_items_page?: MondayItemsPage }>(
    tokens,
    `query ($cursor: String!, $limit: Int!) {
      next_items_page(cursor: $cursor, limit: $limit) {
        cursor
        items { ${ITEM_FIELDS} }
      }
    }`,
    { cursor, limit: ITEM_PAGE_LIMIT },
  );
  return data.next_items_page ?? {};
}

async function fetchAllBoardItems(tokens: MondayTokens, boardId: string): Promise<MondayItem[]> {
  const items: MondayItem[] = [];
  let page = await fetchInitialItemsPage(tokens, boardId);
  for (let index = 0; index < 100; index++) {
    items.push(...(page.items ?? []));
    if (!page.cursor) break;
    page = await fetchNextItemsPage(tokens, page.cursor);
  }
  return items;
}

async function fetchActivityLogs(
  tokens: MondayTokens,
  boardId: string,
  from: string,
  to: string,
): Promise<MondayActivityLog[]> {
  const data = await gql<{ boards: { activity_logs?: MondayActivityLog[] }[] }>(
    tokens,
    `query ($ids: [ID!], $from: ISO8601DateTime!, $to: ISO8601DateTime!) {
      boards(ids: $ids) {
        activity_logs(from: $from, to: $to) { id event data created_at user_id }
      }
    }`,
    { ids: [boardId], from, to },
  );
  return data.boards[0]?.activity_logs ?? [];
}

async function fetchDocPage(
  tokens: MondayTokens,
  docId: string,
  page: number,
): Promise<MondayDoc | null> {
  const data = await gql<{ docs: MondayDoc[] }>(
    tokens,
    `query ($ids: [ID!], $blockLimit: Int!, $blockPage: Int!) {
      docs(ids: $ids) {
        id object_id name doc_kind created_at updated_at url relative_url workspace_id
        workspace { id name }
        created_by { id name email }
        blocks(limit: $blockLimit, page: $blockPage) {
          id type content position created_at updated_at parent_block_id
        }
      }
    }`,
    { ids: [docId], blockLimit: BLOCK_PAGE_LIMIT, blockPage: page },
  );
  return data.docs[0] ?? null;
}

async function fetchDoc(tokens: MondayTokens, docId: string): Promise<MondayDoc | null> {
  const first = await fetchDocPage(tokens, docId, 1);
  if (!first) return null;
  const blocks = [...(first.blocks ?? [])];
  for (let page = 2; page <= 100; page++) {
    if ((first.blocks?.length ?? 0) < BLOCK_PAGE_LIMIT) break;
    const next = await fetchDocPage(tokens, docId, page);
    const nextBlocks = next?.blocks ?? [];
    blocks.push(...nextBlocks);
    if (nextBlocks.length < BLOCK_PAGE_LIMIT) break;
  }
  return { ...first, blocks };
}

async function fetchDocsPage(tokens: MondayTokens, page: number): Promise<MondayDoc[]> {
  const data = await gql<{ docs: MondayDoc[] }>(
    tokens,
    `query ($limit: Int!, $page: Int!) {
      docs(limit: $limit, page: $page, order_by: used_at) {
        id object_id name doc_kind created_at updated_at url relative_url workspace_id
        workspace { id name }
      }
    }`,
    { limit: DOC_PAGE_LIMIT, page },
  );
  return data.docs;
}

async function listDocs(tokens: MondayTokens): Promise<MondayDoc[]> {
  const docs: MondayDoc[] = [];
  for (let page = 1; page <= 25; page++) {
    const batch = await fetchDocsPage(tokens, page);
    docs.push(...batch);
    if (batch.length < DOC_PAGE_LIMIT) break;
  }
  return docs;
}

async function fetchBoardsPage(tokens: MondayTokens, page: number): Promise<MondayBoard[]> {
  const data = await gql<{ boards: MondayBoard[] }>(
    tokens,
    `query ($limit: Int!, $page: Int!) {
      boards(limit: $limit, page: $page) {
        id name
        workspace { id name }
      }
    }`,
    { limit: BOARD_PAGE_LIMIT, page },
  );
  return data.boards;
}

async function listBoards(tokens: MondayTokens): Promise<MondayBoard[]> {
  const boards: MondayBoard[] = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await fetchBoardsPage(tokens, page);
    boards.push(...batch);
    if (batch.length < BOARD_PAGE_LIMIT) break;
  }
  return boards;
}

function recordEvents(
  board: MondayBoard,
  item: MondayItem,
  kind: 'item' | 'subitem',
): IntegrationEvent[] {
  return [
    itemEvent(board, item, kind),
    ...(item.updates ?? []).map((update) => updateEvent(board, item, update, kind)),
  ];
}

async function syncBoard(
  tokens: MondayTokens,
  boardId: string,
  cursor: MondayCursor,
): Promise<{ events: IntegrationEvent[]; cursor: MondayCursor }> {
  const board = await fetchBoard(tokens, boardId);
  if (!board) return { events: [], cursor };
  const from =
    cursor.activity_since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();
  const [activityLogs, items] = await Promise.all([
    fetchActivityLogs(tokens, boardId, from, to),
    fetchAllBoardItems(tokens, boardId),
  ]);
  const activityEvents = activityLogs.map((log) => activityEvent(board, log));
  const itemEvents = items.flatMap((item) => [
    ...recordEvents(board, item, 'item'),
    ...(item.subitems ?? []).flatMap((subitem) => recordEvents(board, subitem, 'subitem')),
  ]);
  const events = [boardSchemaEvent(board), ...activityEvents, ...itemEvents];
  const latest = events
    .map((event) => event.occurredAt.toISOString())
    .sort()
    .at(-1);
  return {
    events,
    cursor: {
      activity_since: latest ?? cursor.activity_since ?? to,
      item_since: latest ?? cursor.item_since ?? to,
    },
  };
}

export const mondayProvider: IntegrationProvider = {
  id: 'monday',
  displayLabel: 'Monday.com',

  // eslint-disable-next-line @typescript-eslint/require-await
  async startOAuth(input) {
    const env = getEnv();
    if (!env.MONDAY_CLIENT_ID) throw new Error('MONDAY_CLIENT_ID not configured');
    return {
      authorizeUrl: buildAuthorizeUrl({
        clientId: env.MONDAY_CLIENT_ID,
        redirectUri: input.redirectUri,
        state: input.state,
      }),
    };
  },

  async handleOAuthCallback(input: OAuthCallbackInput) {
    const env = getEnv();
    if (!env.MONDAY_CLIENT_ID || !env.MONDAY_CLIENT_SECRET) {
      throw new Error('MONDAY_CLIENT_ID / MONDAY_CLIENT_SECRET not configured');
    }
    const body = await postForm(TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: env.MONDAY_CLIENT_ID,
      client_secret: env.MONDAY_CLIENT_SECRET,
      code: input.code,
      redirect_uri: input.redirectUri,
    });
    const tokens = tokenFromBody(body);
    const me = await gql<{ me?: { id?: string; name?: string; email?: string } }>(
      tokens,
      'query { me { id name email } }',
    );
    const externalAccountId = me.me?.id ?? 'monday';
    return {
      externalAccountId,
      displayName: `Monday.com — ${me.me?.name ?? me.me?.email ?? externalAccountId}`,
      scopes: SCOPES,
      tokens: tokens as unknown as Record<string, unknown>,
    };
  },

  async listSyncableResources(_integration, tokens, ctx): Promise<ProviderResource[]> {
    const mondayTokens = await ensureAccessToken(tokens as MondayTokens, ctx);
    const boards = (await listBoards(mondayTokens)).map((board) => ({
      externalId: board.id,
      label: board.workspace?.name ? `${board.workspace.name} / ${board.name}` : board.name,
      kind: 'monday.board',
    }));
    const docs = await listDocs(mondayTokens).catch(() => []);
    return [
      ...boards,
      ...docs.map((doc) => ({
        externalId: doc.id,
        label: doc.workspace?.name ? `${doc.workspace.name} / ${doc.name}` : doc.name,
        kind: 'monday.doc',
      })),
    ];
  },

  async backfill({ tokens, selections, ctx }) {
    const mondayTokens = await ensureAccessToken(tokens as MondayTokens, ctx);
    for (const selection of selections.filter((item) => item.kind === 'monday.board')) {
      const cursor = (await ctx.loadCursor(`monday.board:${selection.externalId}`)) as MondayCursor;
      const result = await syncBoard(mondayTokens, selection.externalId, cursor);
      await ctx.writeEvents(result.events);
      await ctx.saveCursor(`monday.board:${selection.externalId}`, result.cursor);
    }
    for (const selection of selections.filter((item) => item.kind === 'monday.doc')) {
      const cursor = (await ctx.loadCursor(`monday.doc:${selection.externalId}`)) as MondayCursor;
      const doc = await fetchDoc(mondayTokens, selection.externalId);
      if (!doc) continue;
      const event = docEvent(doc);
      const eventIds = await ctx.writeEvents([event]);
      const docSince = event.occurredAt.toISOString();
      if (ctx.harvestDocument && (eventIds.length > 0 || cursor.doc_since !== docSince)) {
        await ctx.harvestDocument({
          filename: `${doc.name}.md`,
          contentType: 'text/markdown',
          body: Buffer.from(docMarkdown(doc), 'utf8'),
          externalId: `monday.doc:${doc.id}`,
          metadata: {
            monday_doc_id: doc.id,
            monday_doc_object_id: doc.object_id ?? null,
            monday_workspace_id: doc.workspace_id ?? doc.workspace?.id ?? null,
            integration_provider: 'monday',
          },
        });
      }
      await ctx.saveCursor(`monday.doc:${selection.externalId}`, {
        doc_since: docSince,
      });
    }
  },

  async incrementalSync({ tokens, selections, ctx }) {
    await this.backfill({ integration: {} as never, tokens, selections, ctx });
  },
};
