import { Buffer } from 'node:buffer';

import { getEnv } from '#src/env.js';
import { externalFetch as fetch } from '#src/http/external-fetch.js';
import {
  type IntegrationEvent,
  type IntegrationProvider,
  type ObjectMapping,
  type OAuthCallbackInput,
  ProviderRateLimitError as ProviderRateLimitErrorValue,
  type ProviderRateLimitError as ProviderRateLimitErrorType,
  type ProviderResource,
  type SyncContext,
  type SyncPartialFailure,
  type TargetedSyncTask,
  type WebhookSubscription,
} from '#src/integrations/types.js';

// Phase 11 — Monday.com provider.
//
// Idempotency for items/subitems is by lifecycle status buckets (not
// updated_at), so column text churn reuses the raw_event. Sync and webhook
// share the same item key family; triggerUuid stays on externalEventId only.
// Updates/docs/board-schema key by stable ids; activity logs stay per log.id.

const AUTH_URL = 'https://auth.monday.com/oauth2/authorize';
const TOKEN_URL = 'https://auth.monday.com/oauth2/token';
const GRAPHQL_URL = 'https://api.monday.com/v2';
const API_VERSION = '2026-04';
const SCOPES = [
  'boards:read',
  'users:read',
  'updates:read',
  'docs:read',
  'account:read',
  'webhooks:read',
  'webhooks:write',
];
const BOARD_PAGE_LIMIT = 100;
const ITEM_PAGE_LIMIT = 100;
const UPDATE_LIMIT = 50;
const DOC_PAGE_LIMIT = 100;
const BLOCK_PAGE_LIMIT = 100;
const ITEM_PAGE_CURSOR_TTL_MS = 60 * 60 * 1000;
const DOC_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MONDAY_WEBHOOK_EVENTS = [
  'create_item',
  'change_column_value',
  'change_status_column_value',
  'change_name',
  'create_update',
  'edit_update',
  'delete_update',
  'create_subitem',
  'change_subitem_column_value',
  'item_archived',
  'item_deleted',
  'item_restored',
] as const;

interface MondayTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_at?: number;
}

interface MondayIdentity {
  id?: string;
  name?: string;
}

interface MondayAccountIdentity {
  id?: string;
  slug?: string;
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
  type?: string | null;
  board_kind?: string | null;
  hierarchy_type?: string | null;
  updated_at?: string;
  workspace?: MondayWorkspace | null;
  columns?: MondayColumn[];
}

interface MondayColumnValue {
  id: string;
  text?: string | null;
  type?: string;
  value?: unknown;
  persons_and_teams?: MondayPeopleEntity[];
}

interface MondayPeopleEntity {
  id?: string | number;
  kind?: string | null;
  name?: string | null;
}

interface MondayGroup {
  id?: string | number;
  title?: string | null;
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
  creator?: { id?: string; name?: string } | null;
}

interface MondayItem {
  id: string;
  name: string;
  updated_at?: string;
  url?: string;
  board?: MondayBoard | null;
  group?: MondayGroup | null;
  creator?: { id?: string; name?: string } | null;
  parent_item?: { id?: string; name?: string; board?: MondayBoard | null } | null;
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
  created_by?: { id?: string; name?: string } | null;
  blocks?: MondayDocBlock[];
}

interface MondayCursor {
  activity_since?: string | undefined;
  item_since?: string | undefined;
  item_page_cursor?: string | undefined;
  item_page_cursor_created_at?: string | undefined;
  item_page_cursor_expires_at?: string | undefined;
  doc_since?: string | undefined;
  doc_last_polled_at?: string | undefined;
}

interface MondayGraphQLError {
  message?: string;
  extensions?: {
    code?: string;
    retry_in_seconds?: number;
  };
}

interface MondayWebhookMutationResult {
  id?: string | number | null;
  board_id?: string | number | null;
}

interface NormalizedColumn {
  id: string;
  title: string;
  type: string | null;
  text: string | null;
  value: unknown;
  assignees?: MondayAssignee[];
}

interface MondayAssignee {
  id: string;
  kind: string | null;
  name: string | null;
}

interface MondayGroupMembership {
  id: string | null;
  title: string | null;
}

interface MondayItemSemantics {
  columns: NormalizedColumn[];
  group: MondayGroupMembership | null;
  assignees: (MondayAssignee & { columnId: string; columnTitle: string })[];
}

const BOARD_FIELDS = `
  id name type board_kind hierarchy_type updated_at
  workspace { id name }
  columns { id title type }
`;

const ITEM_BOARD_FIELDS = `
  id name type board_kind hierarchy_type updated_at
  columns { id title type }
`;

const ITEM_FIELDS = `
  id name updated_at url
  group { id title }
  creator { id name }
  parent_item { id name board { ${ITEM_BOARD_FIELDS} } }
  column_values {
    id text type value
    ... on PeopleValue { persons_and_teams { id kind } }
  }
  updates(limit: ${String(UPDATE_LIMIT)}) { id body created_at updated_at creator { id name } }
  subitems {
    id name updated_at url
    group { id title }
    board { ${ITEM_BOARD_FIELDS} }
    creator { id name }
    parent_item { id name }
    column_values {
      id text type value
      ... on PeopleValue { persons_and_teams { id kind } }
    }
    updates(limit: ${String(UPDATE_LIMIT)}) { id body created_at updated_at creator { id name } }
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
      'api-version': API_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  const httpRateLimit = mondayRateLimitError(res, text);
  if (httpRateLimit) throw httpRateLimit;
  if (!res.ok) throw new Error(`Monday GraphQL ${String(res.status)}: ${text}`);
  const json = JSON.parse(text) as { data?: T; errors?: MondayGraphQLError[] };
  if (json.errors?.length) {
    const gqlRateLimit = mondayRateLimitError(res, text, json.errors);
    if (gqlRateLimit) throw gqlRateLimit;
    throw new Error(`Monday GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  if (!json.data) throw new Error('Monday GraphQL returned no data');
  return json.data;
}

function mondayRateLimitError(
  res: Response,
  body: string,
  errors?: MondayGraphQLError[],
): ProviderRateLimitErrorType | null {
  const parsedErrors = errors ?? parseMondayErrors(body);
  const limitError = parsedErrors.find((error) => {
    const code = error.extensions?.code ?? '';
    return (
      /LIMIT|RATE|COMPLEXITY|CONCURRENCY/i.test(code) ||
      /limit|rate|complexity|concurrency/i.test(error.message ?? '')
    );
  });
  if (!limitError && res.status !== 429) return null;

  const retryAfter =
    positiveNumber(limitError?.extensions?.retry_in_seconds) ??
    parsePositiveInt(res.headers.get('retry-after')) ??
    parseRateLimitWaitSeconds(res.headers.get('ratelimit')) ??
    60;
  const retryAt = new Date(Date.now() + retryAfter * 1000);
  const code = limitError?.extensions?.code ?? (res.status === 429 ? 'HTTP_429' : 'LIMIT_EXCEEDED');
  return new ProviderRateLimitErrorValue({
    provider: 'monday',
    retryAt,
    retryAfterSeconds: retryAfter,
    scope: mondayLimitScope(code, limitError?.message),
    reason: code.toLowerCase(),
    message: `monday_rate_limited: Monday API ${code}; retry after ${retryAt.toISOString()}`,
  });
}

function parseMondayErrors(body: string): MondayGraphQLError[] {
  try {
    const parsed = JSON.parse(body) as { errors?: MondayGraphQLError[] };
    return Array.isArray(parsed.errors) ? parsed.errors : [];
  } catch {
    return [];
  }
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseRateLimitWaitSeconds(value: string | null): number | null {
  if (!value) return null;
  const waitMatch = /(?:^|[,\s])t=(\d+)/i.exec(value);
  if (waitMatch?.[1]) return parsePositiveInt(waitMatch[1]);
  const resetMatch = /(?:^|[,\s])reset=(\d+)/i.exec(value);
  if (!resetMatch?.[1]) return null;
  const reset = parsePositiveInt(resetMatch[1]);
  if (!reset) return null;
  return reset > 1_000_000_000 ? Math.max(1, reset - Math.floor(Date.now() / 1000)) : reset;
}

function mondayLimitScope(code: string, message = ''): string {
  const value = `${code} ${message}`.toLowerCase();
  if (value.includes('daily')) return 'daily';
  if (value.includes('minute')) return 'minute';
  if (value.includes('complexity')) return 'complexity';
  if (value.includes('concurrency')) return 'concurrency';
  if (value.includes('ip')) return 'ip';
  return 'requests';
}

function isMondayUnauthorizedFieldError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /Unauthorized field or type/i.test(error.message) ||
    /Unauthorized to load field ['"]?Query\.boards\.workspace['"]?.*missing required scopes/i.test(
      error.message,
    )
  );
}

async function fetchViewerIdentity(tokens: MondayTokens): Promise<MondayIdentity | null> {
  try {
    const data = await gql<{ me?: MondayIdentity }>(tokens, 'query { me { id name } }');
    return data.me ?? null;
  } catch (error) {
    if (!isMondayUnauthorizedFieldError(error)) throw error;
    return null;
  }
}

async function fetchAccountIdentity(tokens: MondayTokens): Promise<MondayAccountIdentity | null> {
  try {
    const data = await gql<{ account?: MondayAccountIdentity }>(
      tokens,
      'query { account { id slug } }',
    );
    return data.account ?? null;
  } catch (error) {
    if (!isMondayUnauthorizedFieldError(error)) throw error;
    return null;
  }
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
  input?: { id?: string; name?: string } | null,
): { externalId?: string; name?: string } | null {
  if (!input) return null;
  return {
    ...(input.id ? { externalId: input.id } : {}),
    ...(input.name ? { name: input.name } : {}),
  };
}

function boardMetadata(board: MondayBoard): Record<string, unknown> {
  return {
    monday_board_id: board.id,
    monday_parent_board_id: board.id,
    monday_board_name: board.name,
    monday_board_type: board.type ?? null,
    monday_board_kind: board.board_kind ?? null,
    monday_board_hierarchy_type: board.hierarchy_type ?? null,
    monday_hierarchy_type: board.hierarchy_type ?? 'classic',
    monday_workspace_id: board.workspace?.id ?? null,
    monday_workspace_name: board.workspace?.name ?? null,
  };
}

function mondayPeopleEntities(value: unknown): MondayPeopleEntity[] {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  const record = recordValue(parsed);
  const entities = record?.personsAndTeams ?? record?.persons_and_teams;
  if (!Array.isArray(entities)) return [];
  return entities.flatMap((entity) => {
    const item = recordValue(entity);
    const id = mondayIdValue(item?.id);
    return id
      ? [
          {
            id,
            kind: stringValue(item?.kind) ?? null,
            name: stringValue(item?.name),
          },
        ]
      : [];
  });
}

function isMondayPeopleColumnType(type: string | null | undefined): boolean {
  return type === 'people' || type === 'person' || type === 'team';
}

function mondayColumnAssignees(
  column: MondayColumnValue,
  columnType: string | null,
): MondayAssignee[] {
  const entities = column.persons_and_teams?.length
    ? column.persons_and_teams
    : mondayPeopleEntities(column.value);
  const legacyKind = columnType === 'person' || columnType === 'team' ? columnType : null;
  const assignees = entities.flatMap((entity) => {
    const id = mondayIdValue(entity.id);
    return id
      ? [
          {
            id,
            kind: stringValue(entity.kind)?.toLowerCase() ?? legacyKind,
            name: stringValue(entity.name),
          },
        ]
      : [];
  });
  return [
    ...new Map(
      assignees.map((assignee) => [`${assignee.kind ?? ''}:${assignee.id}`, assignee]),
    ).values(),
  ];
}

function normalizedColumns(board: MondayBoard, item: MondayItem): NormalizedColumn[] {
  const schemaById = new Map((board.columns ?? []).map((column) => [column.id, column]));
  return (item.column_values ?? []).map((column) => {
    const schema = schemaById.get(column.id);
    const type = column.type ?? schema?.type ?? null;
    const assignees = isMondayPeopleColumnType(type) ? mondayColumnAssignees(column, type) : [];
    return {
      id: column.id,
      title: schema?.title ?? column.id,
      type,
      text: column.text ?? null,
      value: column.value ?? null,
      ...(assignees.length ? { assignees } : {}),
    };
  });
}

function mondayGroupMembership(item: MondayItem): MondayGroupMembership | null {
  const id = mondayIdValue(item.group?.id);
  const title = stringValue(item.group?.title);
  return id || title ? { id, title } : null;
}

function mondayItemSemantics(board: MondayBoard, item: MondayItem): MondayItemSemantics {
  const columns = normalizedColumns(board, item);
  return {
    columns,
    group: mondayGroupMembership(item),
    assignees: columns.flatMap((column) =>
      (column.assignees ?? []).map((assignee) => ({
        ...assignee,
        columnId: column.id,
        columnTitle: column.title,
      })),
    ),
  };
}

function mondayItemSemanticMetadata(semantics: MondayItemSemantics): Record<string, unknown> {
  return {
    ...(semantics.group ? { monday_group: semantics.group } : {}),
    ...(semantics.assignees.length ? { monday_assignees: semantics.assignees } : {}),
  };
}

function mondayColumnDisplayValue(column: NormalizedColumn): string | null {
  if (column.text) return column.text;
  if (!isMondayPeopleColumnType(column.type) || !column.assignees?.length) return null;
  return column.assignees
    .map((assignee) => assignee.name ?? `${assignee.kind ?? 'member'} ${assignee.id}`)
    .join(', ');
}

function isSemanticallyImportantMondayColumn(column: NormalizedColumn): boolean {
  if (
    ['status', 'date', 'priority'].includes(column.type ?? '') ||
    isMondayPeopleColumnType(column.type)
  ) {
    return true;
  }
  return /\b(?:owner|assignee|due(?: date)?|deadline|priority|group)\b/iu.test(column.title);
}

function mondayItemColumnLines(columns: NormalizedColumn[]): string[] {
  const textualColumns = columns.flatMap((column) => {
    const value = mondayColumnDisplayValue(column);
    return value ? [{ column, value }] : [];
  });
  const importantColumns = textualColumns.filter(({ column }) =>
    isSemanticallyImportantMondayColumn(column),
  );
  const genericColumns = textualColumns
    .filter(({ column }) => !isSemanticallyImportantMondayColumn(column))
    .slice(0, 12);
  return [...importantColumns, ...genericColumns].map(
    ({ column, value }) => `${column.type === 'status' ? 'Status' : column.title}: ${value}`,
  );
}

function mondayRecordMap(
  board: MondayBoard,
  item: MondayItem,
  kind: 'item' | 'subitem',
  itemBoard: MondayBoard = board,
  hierarchyDepth = kind === 'subitem' ? 1 : 0,
): ObjectMapping {
  const semantics = mondayItemSemantics(itemBoard, item);
  const status = semantics.columns.find((column) => column.type === 'status');
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
      monday_item_board_id: itemBoard.id,
      monday_item_board_name: itemBoard.name,
      monday_item_id: item.id,
      monday_item_name: item.name,
      monday_parent_item_id: parent?.id ?? null,
      monday_parent_item_name: parent?.name ?? null,
      monday_hierarchy_depth: hierarchyDepth,
      ...mondayItemSemanticMetadata(semantics),
      monday_columns: semantics.columns,
    },
  };
}

function boardSchemaEvent(board: MondayBoard): IntegrationEvent {
  const occurredAt = dateValue(board.updated_at);
  return {
    dedupKey: `monday:board-schema:${board.id}`,
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
  itemBoard: MondayBoard = board,
  hierarchyDepth = kind === 'subitem' ? 1 : 0,
): IntegrationEvent {
  const occurredAt = dateValue(item.updated_at);
  const semantics = mondayItemSemantics(itemBoard, item);
  const status = mondayStatus(semantics.columns.find((column) => column.type === 'status')?.text);
  return {
    dedupKey: `monday:${kind}:${board.id}:${item.id}:${status}`,
    provider: 'monday',
    externalObjectId: item.id,
    eventType: kind === 'subitem' ? 'subitem.updated' : 'item.updated',
    occurredAt,
    actor: actor(item.creator),
    contentText: [
      `Monday ${kind} updated on ${board.name}: ${item.name}`,
      item.parent_item?.name ? `Parent: ${item.parent_item.name}` : null,
      semantics.group ? `Group: ${semantics.group.title ?? semantics.group.id}` : null,
      ...mondayItemColumnLines(semantics.columns),
    ]
      .filter(Boolean)
      .join('\n'),
    extra: {
      ...boardMetadata(board),
      monday_item_board_id: itemBoard.id,
      monday_item_board_name: itemBoard.name,
      monday_item_id: item.id,
      monday_parent_item_id: item.parent_item?.id ?? null,
      monday_hierarchy_depth: hierarchyDepth,
      external_url: item.url ?? null,
      ...mondayItemSemanticMetadata(semantics),
      columns: semantics.columns,
    },
    objectMap: mondayRecordMap(board, item, kind, itemBoard, hierarchyDepth),
  };
}

function updateEvent(
  board: MondayBoard,
  item: MondayItem,
  update: MondayUpdate,
  kind: 'item' | 'subitem',
  itemBoard: MondayBoard = board,
  hierarchyDepth = kind === 'subitem' ? 1 : 0,
): IntegrationEvent {
  const occurredAt = dateValue(update.updated_at ?? update.created_at);
  return {
    dedupKey: `monday:update:${item.id}:${update.id}`,
    provider: 'monday',
    externalObjectId: item.id,
    externalEventId: update.id,
    eventType: 'update.created',
    occurredAt,
    actor: actor(update.creator),
    contentText: `Monday update on ${item.name}: ${update.body ?? ''}`.trim(),
    extra: {
      ...boardMetadata(board),
      monday_item_board_id: itemBoard.id,
      monday_item_board_name: itemBoard.name,
      monday_item_id: item.id,
      monday_record_kind: kind,
      monday_parent_item_id: item.parent_item?.id ?? null,
      monday_hierarchy_depth: hierarchyDepth,
      monday_update_id: update.id,
      external_url: item.url ?? null,
    },
    objectMap: mondayRecordMap(board, item, kind, itemBoard, hierarchyDepth),
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
    dedupKey: `monday:doc:${doc.id}`,
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

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mondayWebhookTextValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() ? value : null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function mondayIdValue(value: unknown): string | null {
  return stringValue(value) ?? (numberValue(value) !== null ? String(numberValue(value)) : null);
}

function mondayWebhookOccurredAt(event: Record<string, unknown>): Date {
  const triggerTime = stringValue(event.triggerTime);
  if (triggerTime) return dateValue(triggerTime);
  const changedAt = numberValue(event.changedAt);
  if (changedAt) return new Date(changedAt * 1000);
  return new Date();
}

function mondayWebhookEventType(rawType: string, isSubitem = false): string {
  if (rawType === 'create_pulse' || rawType === 'create_item') {
    return isSubitem ? 'subitem.created' : 'item.created';
  }
  if (rawType === 'create_update') return 'update.created';
  if (rawType === 'edit_update') return 'update.updated';
  if (rawType === 'delete_update') return 'update.deleted';
  if (rawType === 'create_subitem') return 'subitem.created';
  if (rawType.includes('status')) return 'status.changed';
  if (rawType.includes('column')) return 'column.changed';
  if (rawType === 'change_name') return 'item.renamed';
  if (rawType === 'item_archived') return 'item.archived';
  if (rawType === 'item_deleted') return 'item.deleted';
  if (rawType === 'item_restored') return 'item.restored';
  return rawType || 'item.updated';
}

function mondayWebhookEvent(payload: unknown): IntegrationEvent[] {
  const event = recordValue(recordValue(payload)?.event);
  if (!event) return [];
  const itemBoardId = mondayIdValue(event.boardId);
  if (!itemBoardId) return [];
  const parentBoardId = mondayIdValue(event.parentItemBoardId);
  const boardId = parentBoardId ?? itemBoardId;
  const parentItemId = mondayIdValue(event.parentItemId);
  const rawType = stringValue(event.type) ?? 'item.updated';
  const isSubitem = parentBoardId !== null || parentItemId !== null || rawType.includes('subitem');
  const eventType = mondayWebhookEventType(rawType, isSubitem);
  const itemId =
    mondayIdValue(event.pulseId) ??
    mondayIdValue(event.itemId) ??
    mondayIdValue(event.parentItemId) ??
    boardId;
  const itemName = stringValue(event.pulseName) ?? stringValue(event.itemName);
  const updateId = mondayIdValue(event.updateId);
  const subscriptionId = mondayIdValue(event.subscriptionId);
  const triggerUuid = stringValue(event.triggerUuid);
  const occurredAt = mondayWebhookOccurredAt(event);
  const columnTitle = stringValue(event.columnTitle) ?? stringValue(event.columnId);
  const valueText = mondayWebhookTextValue(event.value);
  const previousValueText = mondayWebhookTextValue(event.previousValue);
  const title = itemName ?? `Monday item ${itemId}`;
  const status = mondayStatus(valueText);
  const kind = isSubitem ? 'subitem' : 'item';
  const isUpdateEvent =
    updateId !== null &&
    (rawType === 'create_update' ||
      rawType === 'edit_update' ||
      rawType === 'delete_update' ||
      eventType.startsWith('update.'));
  return [
    {
      dedupKey: isUpdateEvent
        ? `monday:update:${itemId}:${updateId}`
        : `monday:${kind}:${boardId}:${itemId}:${status}`,
      provider: 'monday',
      externalObjectId: updateId ? `${itemId}:update:${updateId}` : itemId,
      externalEventId: triggerUuid ?? updateId ?? subscriptionId ?? null,
      eventType,
      occurredAt,
      actor: mondayIdValue(event.userId) ? { externalId: mondayIdValue(event.userId) ?? '' } : null,
      contentText: [
        `Monday ${eventType.replace('.', ' ')} on board ${boardId}: ${title}`,
        columnTitle ? `Column: ${columnTitle}` : null,
        valueText ? `Value: ${valueText}` : null,
        previousValueText ? `Previous: ${previousValueText}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      extra: {
        monday_board_id: boardId,
        monday_parent_board_id: boardId,
        monday_item_board_id: itemBoardId,
        monday_item_id: itemId,
        monday_parent_item_id: parentItemId,
        monday_hierarchy_depth: isSubitem ? 1 : 0,
        monday_update_id: updateId ?? null,
        monday_webhook_type: rawType,
        monday_subscription_id: subscriptionId ?? null,
        monday_trigger_uuid: triggerUuid ?? null,
        monday_column_id: stringValue(event.columnId),
        monday_column_title: columnTitle,
        monday_column_type: stringValue(event.columnType),
        monday_group_id: stringValue(event.groupId),
      },
      objectMap: {
        type: 'other',
        canonicalName: `Monday record ${itemId}: ${title}`,
        displayTitle: title,
        externalId: itemId,
        status,
        metadata: {
          monday_record_kind: isSubitem ? 'subitem' : 'webhook-record',
          monday_board_id: boardId,
          monday_parent_board_id: boardId,
          monday_item_board_id: itemBoardId,
          monday_item_id: itemId,
          monday_parent_item_id: parentItemId,
          monday_hierarchy_depth: isSubitem ? 1 : 0,
        },
      },
    },
  ];
}

function mondayWebhookBoardId(payload: unknown): string | null {
  const event = recordValue(recordValue(payload)?.event);
  return event ? (mondayIdValue(event.parentItemBoardId) ?? mondayIdValue(event.boardId)) : null;
}

function mondayWebhookItemId(payload: unknown): string | null {
  const event = recordValue(recordValue(payload)?.event);
  if (!event) return null;
  return (
    mondayIdValue(event.pulseId) ?? mondayIdValue(event.itemId) ?? mondayIdValue(event.parentItemId)
  );
}

function mondayWebhookUrl(): string {
  const env = getEnv();
  if (!env.MONDAY_WEBHOOK_SECRET) {
    throw new Error('MONDAY_WEBHOOK_SECRET not configured');
  }
  const url = new URL('/api/webhooks/monday', env.AUTH_URL);
  url.searchParams.set('token', env.MONDAY_WEBHOOK_SECRET);
  const rendered = url.toString();
  if (rendered.length > 255) {
    throw new Error('Monday webhook URL exceeds provider 255 character limit');
  }
  return rendered;
}

function mondayWebhookKey(subscription: {
  resourceKind: string;
  externalResourceId: string;
  eventType: string;
}): string {
  return `${subscription.resourceKind}\x00${subscription.externalResourceId}\x00${subscription.eventType}`;
}

function isMondaySubitemsWebhookError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /creating webhook on subitems board isn't allowed/i.test(error.message)
  );
}

async function createMondayWebhook(
  tokens: MondayTokens,
  boardId: string,
  eventType: (typeof MONDAY_WEBHOOK_EVENTS)[number],
  url: string,
): Promise<WebhookSubscription> {
  const data = await gql<{ create_webhook?: MondayWebhookMutationResult }>(
    tokens,
    `mutation CreateTimelineMondayWebhook($boardId: ID!, $url: String!, $event: WebhookEventType!) {
      create_webhook(board_id: $boardId, url: $url, event: $event) {
        id
        board_id
      }
    }`,
    { boardId, url, event: eventType },
  );
  const id = mondayIdValue(data.create_webhook?.id);
  if (!id) throw new Error('Monday create_webhook returned no id');
  return {
    externalSubscriptionId: id,
    resourceKind: 'monday.board',
    externalResourceId: boardId,
    eventType,
    expiresAt: null,
  };
}

async function deleteMondayWebhook(tokens: MondayTokens, subscriptionId: string): Promise<void> {
  await gql<{ delete_webhook?: MondayWebhookMutationResult }>(
    tokens,
    `mutation DeleteTimelineMondayWebhook($id: ID!) {
      delete_webhook(id: $id) {
        id
        board_id
      }
    }`,
    { id: subscriptionId },
  );
}

async function fetchBoard(tokens: MondayTokens, boardId: string): Promise<MondayBoard | null> {
  const query = (includeWorkspace: boolean) => `query ($ids: [ID!]) {
    boards(ids: $ids) {
      id name type board_kind hierarchy_type updated_at
      ${includeWorkspace ? 'workspace { id name }' : ''}
      columns { id title type }
    }
  }`;
  let data: { boards: MondayBoard[] };
  try {
    data = await gql<{ boards: MondayBoard[] }>(tokens, query(true), { ids: [boardId] });
  } catch (error) {
    if (!isMondayUnauthorizedFieldError(error)) throw error;
    data = await gql<{ boards: MondayBoard[] }>(tokens, query(false), { ids: [boardId] });
  }
  return data.boards[0] ?? null;
}

async function fetchItemWithBoard(
  tokens: MondayTokens,
  itemId: string,
): Promise<{ item: MondayItem; board: MondayBoard } | null> {
  const data = await gql<{ items: MondayItem[] }>(
    tokens,
    `query ($itemIds: [ID!]) {
      items(ids: $itemIds) {
        ${ITEM_FIELDS}
        board {
          ${BOARD_FIELDS}
        }
      }
    }`,
    { itemIds: [itemId] },
  );
  const item = data.items[0];
  const board = item?.board ?? null;
  if (!item || !board) return null;
  return { item, board };
}

async function fetchInitialItemsPage(
  tokens: MondayTokens,
  boardId: string,
  updatedSince?: string,
  allItems = false,
): Promise<MondayItemsPage> {
  const updatedSinceDate = updatedSince ? dateValue(updatedSince, new Date(0)) : null;
  const updatedSinceDay =
    updatedSinceDate && updatedSinceDate.getTime() > 0
      ? updatedSinceDate.toISOString().slice(0, 10)
      : null;
  const updatedSinceCompareValue = updatedSinceDay ? ['EXACT', updatedSinceDay] : null;
  const queryParams = updatedSinceCompareValue
    ? `, query_params: {
          rules: [{
            column_id: "__last_updated__",
            compare_value: $updatedSinceCompareValue,
            operator: greater_than_or_equals,
            compare_attribute: "UPDATED_AT"
          }]
        }`
    : '';
  const hierarchyScope = allItems ? ', hierarchy_scope_config: "allItems"' : '';
  const query = updatedSinceCompareValue
    ? `query ($ids: [ID!], $limit: Int!, $updatedSinceCompareValue: CompareValue!) {
        boards(ids: $ids) {
          items_page(limit: $limit${hierarchyScope}${queryParams}) {
            cursor
            items { ${ITEM_FIELDS} }
          }
        }
      }`
    : `query ($ids: [ID!], $limit: Int!) {
        boards(ids: $ids) {
          items_page(limit: $limit${hierarchyScope}) {
            cursor
            items { ${ITEM_FIELDS} }
          }
        }
      }`;
  const data = await gql<{ boards: { items_page?: MondayItemsPage }[] }>(tokens, query, {
    ids: [boardId],
    limit: ITEM_PAGE_LIMIT,
    ...(updatedSinceCompareValue ? { updatedSinceCompareValue } : {}),
  });
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

function isMondayCursorError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (/(?:cursor).*(?:expired|invalid)/iu.test(error.message) ||
      /(?:expired|invalid).*(?:cursor)/iu.test(error.message))
  );
}

async function fetchBoardItemsBatch(
  tokens: MondayTokens,
  boardId: string,
  input: {
    updatedSince?: string;
    pageCursor?: string;
    allItems?: boolean;
  },
): Promise<{ items: MondayItem[]; nextCursor?: string; restarted?: boolean }> {
  const items: MondayItem[] = [];
  let page: MondayItemsPage;
  let restarted = false;
  if (input.pageCursor) {
    try {
      page = await fetchNextItemsPage(tokens, input.pageCursor);
    } catch (error) {
      if (!isMondayCursorError(error)) throw error;
      page = await fetchInitialItemsPage(tokens, boardId, input.updatedSince, input.allItems);
      restarted = true;
    }
  } else {
    page = await fetchInitialItemsPage(tokens, boardId, input.updatedSince, input.allItems);
  }
  for (let index = 0; index < 100; index++) {
    items.push(...(page.items ?? []));
    if (!page.cursor) return { items, ...(restarted ? { restarted: true } : {}) };
    if (index === 99) {
      return { items, nextCursor: page.cursor, ...(restarted ? { restarted: true } : {}) };
    }
    page = await fetchNextItemsPage(tokens, page.cursor);
  }
  return { items, ...(restarted ? { restarted: true } : {}) };
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
        created_by { id name }
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
  let previousPageBlockCount = first.blocks?.length ?? 0;
  for (let page = 2; page <= 100 && previousPageBlockCount === BLOCK_PAGE_LIMIT; page++) {
    const next = await fetchDocPage(tokens, docId, page);
    const nextBlocks = next?.blocks ?? [];
    blocks.push(...nextBlocks);
    previousPageBlockCount = nextBlocks.length;
  }
  return { ...first, blocks };
}

function docReconciliationDue(cursor: MondayCursor, now = Date.now()): boolean {
  if (!cursor.doc_last_polled_at) return true;
  const lastPolledAt = new Date(cursor.doc_last_polled_at);
  if (Number.isNaN(lastPolledAt.getTime())) return true;
  return now - lastPolledAt.getTime() >= DOC_RECONCILIATION_INTERVAL_MS;
}

function usableItemPageCursor(cursor: MondayCursor, now = Date.now()): string | undefined {
  if (!cursor.item_page_cursor) return undefined;
  if (!cursor.item_page_cursor_expires_at) return cursor.item_page_cursor;
  const expiresAt = new Date(cursor.item_page_cursor_expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now) return undefined;
  return cursor.item_page_cursor;
}

async function syncWorkDoc(
  tokens: MondayTokens,
  docId: string,
  cursor: MondayCursor,
  ctx: SyncContext,
): Promise<void> {
  const doc = await fetchDoc(tokens, docId);
  const polledAt = new Date().toISOString();
  if (!doc) {
    await ctx.saveCursor(`monday.doc:${docId}`, {
      ...cursor,
      doc_last_polled_at: polledAt,
    });
    return;
  }
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
  await ctx.saveCursor(`monday.doc:${docId}`, {
    ...cursor,
    doc_since: docSince,
    doc_last_polled_at: polledAt,
  });
}

async function syncTargetedItem(
  tokens: MondayTokens,
  boardId: string,
  itemId: string,
  ctx: SyncContext,
): Promise<void> {
  const result = await fetchItemWithBoard(tokens, itemId);
  if (!result) {
    await ctx.recordAudit('targeted_item_missing', { boardId, itemId });
    return;
  }
  const { board: itemBoard, item } = result;
  const parentBoard = item.parent_item?.board ?? null;
  const board =
    itemBoard.id === boardId ? itemBoard : parentBoard?.id === boardId ? parentBoard : null;
  if (!board) {
    await ctx.recordAudit('targeted_item_board_mismatch', {
      expectedBoardId: boardId,
      actualBoardId: itemBoard.id,
      parentBoardId: parentBoard?.id ?? null,
      itemId,
    });
    return;
  }
  const kind = item.parent_item?.id ? 'subitem' : 'item';
  const events = [
    ...recordEvents(board, item, kind, itemBoard),
    ...(kind === 'item'
      ? (item.subitems ?? []).flatMap((subitem) =>
          recordEvents(board, subitem, 'subitem', subitem.board ?? board),
        )
      : []),
  ];
  await ctx.writeEvents(events);
  const latestItem = events
    .map((event) => event.occurredAt.toISOString())
    .sort()
    .at(-1);
  await ctx.saveCursor(`monday.item:${boardId}:${itemId}`, {
    item_since: latestItem ?? new Date().toISOString(),
  });
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

async function fetchBoardsPage(
  tokens: MondayTokens,
  page: number,
  includeWorkspace: boolean,
): Promise<{ boards: MondayBoard[]; includeWorkspace: boolean }> {
  const query = (includeWorkspace: boolean) => `query ($limit: Int!, $page: Int!) {
    boards(limit: $limit, page: $page, hierarchy_types: [classic, multi_level]) {
      id name type board_kind hierarchy_type
      ${includeWorkspace ? 'workspace { id name }' : ''}
    }
  }`;
  let data: { boards: MondayBoard[] };
  try {
    data = await gql<{ boards: MondayBoard[] }>(tokens, query(includeWorkspace), {
      limit: BOARD_PAGE_LIMIT,
      page,
    });
  } catch (error) {
    if (!includeWorkspace || !isMondayUnauthorizedFieldError(error)) throw error;
    data = await gql<{ boards: MondayBoard[] }>(tokens, query(false), {
      limit: BOARD_PAGE_LIMIT,
      page,
    });
    return { boards: data.boards, includeWorkspace: false };
  }
  return { boards: data.boards, includeWorkspace };
}

async function listBoards(tokens: MondayTokens): Promise<MondayBoard[]> {
  const boards: MondayBoard[] = [];
  let includeWorkspace = true;
  for (let page = 1; page <= 100; page++) {
    const result = await fetchBoardsPage(tokens, page, includeWorkspace);
    includeWorkspace = result.includeWorkspace;
    const batch = result.boards;
    boards.push(...batch);
    if (batch.length < BOARD_PAGE_LIMIT) break;
  }
  return boards;
}

function isSubitemsBoard(board: MondayBoard): boolean {
  if (board.type) return board.type === 'sub_items_board';
  if (board.board_kind) return board.board_kind === 'sub_items_board';
  return board.name.trim().toLowerCase().startsWith('subitems of ');
}

function recordEvents(
  board: MondayBoard,
  item: MondayItem,
  kind: 'item' | 'subitem',
  itemBoard: MondayBoard = board,
  hierarchyDepth = kind === 'subitem' ? 1 : 0,
): IntegrationEvent[] {
  return [
    itemEvent(board, item, kind, itemBoard, hierarchyDepth),
    ...(item.updates ?? []).map((update) =>
      updateEvent(board, item, update, kind, itemBoard, hierarchyDepth),
    ),
  ];
}

function mondayHierarchyDepth(item: MondayItem, itemsById: Map<string, MondayItem>): number {
  let depth = 0;
  let current: MondayItem | undefined = item;
  const seen = new Set<string>();
  while (current?.parent_item?.id && !seen.has(current.id)) {
    seen.add(current.id);
    depth += 1;
    current = itemsById.get(current.parent_item.id);
  }
  return depth;
}

function mondaySyncFailure(resource: string, surface: string, error: unknown): SyncPartialFailure {
  return {
    resource,
    surface,
    error: error instanceof Error ? error.message : String(error),
  };
}

function rethrowMondayRateLimit(error: unknown): void {
  if (error instanceof ProviderRateLimitErrorValue) throw error;
}

async function syncBoard(
  tokens: MondayTokens,
  boardId: string,
  cursor: MondayCursor,
  options: { incremental: boolean },
): Promise<{
  events: IntegrationEvent[];
  cursor: MondayCursor;
  stats: {
    boardId: string;
    hierarchyType: string;
    parentItemCount: number;
    subitemCount: number;
    updateCount: number;
    activityCount: number;
    eventCount: number;
    hasMoreItems: boolean;
    cursorRestarted: boolean;
  };
}> {
  const board = await fetchBoard(tokens, boardId);
  if (!board) {
    return {
      events: [],
      cursor,
      stats: {
        boardId,
        hierarchyType: 'unknown',
        parentItemCount: 0,
        subitemCount: 0,
        updateCount: 0,
        activityCount: 0,
        eventCount: 0,
        hasMoreItems: false,
        cursorRestarted: false,
      },
    };
  }
  const from =
    cursor.activity_since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();
  const pageCursor = usableItemPageCursor(cursor);
  const itemInput = {
    ...(options.incremental && cursor.item_since ? { updatedSince: cursor.item_since } : {}),
    ...(pageCursor ? { pageCursor } : {}),
    ...(board.hierarchy_type === 'multi_level' ? { allItems: true } : {}),
  };
  const [activityLogs, itemBatch] = await Promise.all([
    fetchActivityLogs(tokens, boardId, from, to),
    fetchBoardItemsBatch(tokens, boardId, itemInput),
  ]);
  const items = itemBatch.items;
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const activityEvents = activityLogs.map((log) => activityEvent(board, log));
  const itemEvents = items.flatMap((item) => {
    const kind = item.parent_item?.id ? 'subitem' : 'item';
    return [
      ...recordEvents(
        board,
        item,
        kind,
        item.board ?? board,
        mondayHierarchyDepth(item, itemsById),
      ),
      ...(board.hierarchy_type === 'multi_level'
        ? []
        : (item.subitems ?? []).flatMap((subitem) =>
            recordEvents(board, subitem, 'subitem', subitem.board ?? board, 1),
          )),
    ];
  });
  const schemaEvent = boardSchemaEvent(board);
  const events = [schemaEvent, ...activityEvents, ...itemEvents];
  const flattenedRecords =
    board.hierarchy_type === 'multi_level'
      ? items
      : items.flatMap((item) => [item, ...(item.subitems ?? [])]);
  const latestActivity = activityEvents
    .map((event) => event.occurredAt.toISOString())
    .sort()
    .at(-1);
  const latestItem = itemEvents
    .map((event) => event.occurredAt.toISOString())
    .sort()
    .at(-1);
  return {
    events,
    stats: {
      boardId,
      hierarchyType: board.hierarchy_type ?? 'classic',
      parentItemCount: flattenedRecords.filter((item) => !item.parent_item?.id).length,
      subitemCount: flattenedRecords.filter((item) => Boolean(item.parent_item?.id)).length,
      updateCount: flattenedRecords.reduce((count, item) => count + (item.updates?.length ?? 0), 0),
      activityCount: activityEvents.length,
      eventCount: events.length,
      hasMoreItems: Boolean(itemBatch.nextCursor),
      cursorRestarted: Boolean(itemBatch.restarted),
    },
    cursor: {
      activity_since: latestActivity ?? cursor.activity_since ?? to,
      item_since: itemBatch.nextCursor
        ? cursor.item_since
        : (latestItem ?? cursor.item_since ?? to),
      ...(itemBatch.nextCursor
        ? {
            item_page_cursor: itemBatch.nextCursor,
            item_page_cursor_created_at:
              pageCursor && !itemBatch.restarted ? (cursor.item_page_cursor_created_at ?? to) : to,
            item_page_cursor_expires_at:
              pageCursor && !itemBatch.restarted
                ? (cursor.item_page_cursor_expires_at ??
                  new Date(Date.now() + ITEM_PAGE_CURSOR_TTL_MS).toISOString())
                : new Date(Date.now() + ITEM_PAGE_CURSOR_TTL_MS).toISOString(),
          }
        : {}),
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
    const [account, me] = await Promise.all([
      fetchAccountIdentity(tokens),
      fetchViewerIdentity(tokens),
    ]);
    const externalAccountId =
      account?.id ??
      stringValue(body.account_id) ??
      me?.id ??
      stringValue(body.user_id) ??
      'monday';
    return {
      externalAccountId,
      displayName: `Monday.com — ${account?.slug ?? me?.name ?? externalAccountId}`,
      scopes: SCOPES,
      tokens: tokens as unknown as Record<string, unknown>,
    };
  },

  async listSyncableResources(_integration, tokens, ctx): Promise<ProviderResource[]> {
    const mondayTokens = await ensureAccessToken(tokens as MondayTokens, ctx);
    const boards = (await listBoards(mondayTokens))
      .filter((board) => !isSubitemsBoard(board))
      .map((board) => ({
        externalId: board.id,
        label: board.workspace?.name ? `${board.workspace.name} / ${board.name}` : board.name,
        kind: 'monday.board',
        searchText: [
          board.name,
          board.workspace?.name,
          board.board_kind,
          'monday monday.com board items records pulses updates columns subitems',
        ]
          .filter(Boolean)
          .join(' '),
      }));
    const docs = await listDocs(mondayTokens).catch(() => []);
    return [
      ...boards,
      ...docs.map((doc) => ({
        externalId: doc.id,
        label: doc.workspace?.name ? `${doc.workspace.name} / ${doc.name}` : doc.name,
        kind: 'monday.doc',
        searchText: [
          doc.name,
          doc.workspace?.name,
          doc.doc_kind,
          'monday monday.com workdoc workdocs doc document cited evidence',
        ]
          .filter(Boolean)
          .join(' '),
      })),
    ];
  },

  async backfill({ tokens, selections, ctx }) {
    const mondayTokens = await ensureAccessToken(tokens as MondayTokens, ctx);
    const partialFailures: SyncPartialFailure[] = [];
    const continuations: { resourceType: string; externalId: string }[] = [];
    for (const selection of selections.filter((item) => item.kind === 'monday.board')) {
      try {
        const cursor = (await ctx.loadCursor(
          `monday.board:${selection.externalId}`,
        )) as MondayCursor;
        const result = await syncBoard(mondayTokens, selection.externalId, cursor, {
          incremental: false,
        });
        await ctx.writeEvents(result.events);
        await ctx.recordAudit('monday_board_synced', result.stats);
        await ctx.saveCursor(`monday.board:${selection.externalId}`, result.cursor);
        if (result.stats.hasMoreItems) {
          continuations.push({
            resourceType: 'monday.board',
            externalId: selection.externalId,
          });
        }
      } catch (error) {
        rethrowMondayRateLimit(error);
        partialFailures.push(
          mondaySyncFailure(`monday.board:${selection.externalId}`, 'board', error),
        );
      }
    }
    for (const selection of selections.filter((item) => item.kind === 'monday.doc')) {
      try {
        const cursor = (await ctx.loadCursor(`monday.doc:${selection.externalId}`)) as MondayCursor;
        await syncWorkDoc(mondayTokens, selection.externalId, cursor, ctx);
      } catch (error) {
        rethrowMondayRateLimit(error);
        partialFailures.push(
          mondaySyncFailure(`monday.doc:${selection.externalId}`, 'document', error),
        );
      }
    }
    if (partialFailures.length === 0 && continuations.length === 0) return undefined;
    return {
      ...(partialFailures.length > 0 ? { partialFailures } : {}),
      ...(continuations.length > 0 ? { continuations } : {}),
    };
  },

  async incrementalSync({ tokens, selections, ctx, target }) {
    const mondayTokens = await ensureAccessToken(tokens as MondayTokens, ctx);
    if (target?.resourceType === 'monday.item') {
      const [boardId, itemId] = target.externalId.split(':');
      if (boardId && itemId) {
        await syncTargetedItem(mondayTokens, boardId, itemId, ctx);
      }
      return;
    }
    const partialFailures: SyncPartialFailure[] = [];
    const continuations: { resourceType: string; externalId: string }[] = [];
    for (const selection of selections.filter((item) => item.kind === 'monday.board')) {
      try {
        const cursor = (await ctx.loadCursor(
          `monday.board:${selection.externalId}`,
        )) as MondayCursor;
        const result = await syncBoard(mondayTokens, selection.externalId, cursor, {
          incremental: true,
        });
        await ctx.writeEvents(result.events);
        await ctx.recordAudit('monday_board_synced', result.stats);
        await ctx.saveCursor(`monday.board:${selection.externalId}`, result.cursor);
        if (result.stats.hasMoreItems) {
          continuations.push({
            resourceType: 'monday.board',
            externalId: selection.externalId,
          });
        }
      } catch (error) {
        rethrowMondayRateLimit(error);
        partialFailures.push(
          mondaySyncFailure(`monday.board:${selection.externalId}`, 'board', error),
        );
      }
    }
    for (const selection of selections.filter((item) => item.kind === 'monday.doc')) {
      try {
        const cursor = (await ctx.loadCursor(`monday.doc:${selection.externalId}`)) as MondayCursor;
        if (!docReconciliationDue(cursor)) continue;
        await syncWorkDoc(mondayTokens, selection.externalId, cursor, ctx);
      } catch (error) {
        rethrowMondayRateLimit(error);
        partialFailures.push(
          mondaySyncFailure(`monday.doc:${selection.externalId}`, 'document', error),
        );
      }
    }
    if (partialFailures.length === 0 && continuations.length === 0) return undefined;
    return {
      ...(partialFailures.length > 0 ? { partialFailures } : {}),
      ...(continuations.length > 0 ? { continuations } : {}),
    };
  },

  // eslint-disable-next-line @typescript-eslint/require-await
  async handleWebhook({ integration, payload }) {
    const events = mondayWebhookEvent(payload);
    const boardId = mondayWebhookBoardId(payload);
    const itemId = mondayWebhookItemId(payload);
    const syncTasks: TargetedSyncTask[] = [];
    if (boardId) {
      syncTasks.push({
        integrationId: integration.id,
        teamId: integration.teamId,
        triggeredBy: 'webhook',
        resourceType: itemId ? 'monday.item' : 'monday.board',
        externalId: itemId ? `${boardId}:${itemId}` : boardId,
        ...(events[0]?.eventType ? { surface: events[0].eventType } : {}),
        reason: itemId ? 'monday_item_webhook' : 'monday_board_webhook',
      });
    }
    return {
      events,
      syncTasks,
    };
  },

  async provisionWebhooks({ tokens, selections, existingSubscriptions, ctx }) {
    const mondayTokens = await ensureAccessToken(tokens as MondayTokens, ctx);
    const url = mondayWebhookUrl();
    const existingByKey = new Map(
      (existingSubscriptions ?? [])
        .filter((subscription) => subscription.externalSubscriptionId)
        .map((subscription) => [mondayWebhookKey(subscription), subscription]),
    );
    const active: WebhookSubscription[] = [];
    const boardIds = [
      ...new Set(
        selections
          .filter((selection) => selection.kind === 'monday.board')
          .map((selection) => selection.externalId),
      ),
    ];
    for (const boardId of boardIds) {
      const board = await fetchBoard(mondayTokens, boardId);
      if (!board || isSubitemsBoard(board)) continue;
      const boardSubscriptions: WebhookSubscription[] = [];
      let rejectedSubitemsBoard = false;
      for (const eventType of MONDAY_WEBHOOK_EVENTS) {
        const desired = {
          resourceKind: 'monday.board',
          externalResourceId: boardId,
          eventType,
        };
        const existing = existingByKey.get(mondayWebhookKey(desired));
        if (existing) {
          boardSubscriptions.push({
            ...desired,
            externalSubscriptionId: existing.externalSubscriptionId ?? null,
          });
          continue;
        }
        let created: WebhookSubscription;
        try {
          created = await createMondayWebhook(mondayTokens, boardId, eventType, url);
        } catch (error) {
          if (!isMondaySubitemsWebhookError(error)) throw error;
          rejectedSubitemsBoard = true;
          break;
        }
        await ctx?.persistWebhookSubscription(created);
        boardSubscriptions.push(created);
      }
      if (!rejectedSubitemsBoard) active.push(...boardSubscriptions);
    }
    return active;
  },

  async deprovisionWebhook({ tokens, subscription, ctx }) {
    const subscriptionId = subscription.externalSubscriptionId;
    if (!subscriptionId) return;
    const mondayTokens = await ensureAccessToken(tokens as MondayTokens, ctx);
    await deleteMondayWebhook(mondayTokens, subscriptionId);
  },
};
