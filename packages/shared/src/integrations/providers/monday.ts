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
const SCOPES = ['boards:read', 'users:read', 'updates:read'];

interface MondayTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
}

interface MondayBoard {
  id: string;
  name: string;
  updated_at?: string;
  workspace?: { id?: string; name?: string } | null;
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
  column_values?: { id: string; text?: string | null; type?: string; updated_at?: string | null }[];
  updates?: MondayUpdate[];
}

interface MondayCursor {
  activity_since?: string | undefined;
  item_since?: string | undefined;
}

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
  if (lowered.includes('done') || lowered.includes('complete')) return 'done';
  if (lowered.includes('working') || lowered.includes('progress')) return 'in_progress';
  if (lowered.includes('cancel')) return 'cancelled';
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
  const title = itemName ?? `Monday item ${itemId}`;
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
      monday_board_id: board.id,
      monday_board_name: board.name,
      monday_activity_event: log.event,
      monday_activity_data: data,
    },
    objectMap: {
      type: 'task',
      canonicalName: title,
      displayTitle: title,
      externalId: itemId,
      status: mondayStatus(stringValue(data.value)),
    },
  };
}

function itemEvent(board: MondayBoard, item: MondayItem): IntegrationEvent {
  const occurredAt = dateValue(item.updated_at);
  const statusColumn = item.column_values?.find((column) => column.type === 'status');
  return {
    dedupKey: `monday:item:${board.id}:${item.id}:${occurredAt.toISOString()}`,
    provider: 'monday',
    externalObjectId: item.id,
    eventType: 'item.updated',
    occurredAt,
    actor: actor(item.creator),
    contentText: [
      `Monday item updated on ${board.name}: ${item.name}`,
      statusColumn?.text ? `Status: ${statusColumn.text}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    extra: {
      monday_board_id: board.id,
      monday_board_name: board.name,
      monday_item_id: item.id,
      external_url: item.url ?? null,
      columns: item.column_values ?? [],
    },
    objectMap: {
      type: 'task',
      canonicalName: item.name,
      displayTitle: item.name,
      externalId: item.id,
      status: mondayStatus(statusColumn?.text),
      ...(item.url ? { url: item.url } : {}),
    },
  };
}

function updateEvent(board: MondayBoard, item: MondayItem, update: MondayUpdate): IntegrationEvent {
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
      monday_board_id: board.id,
      monday_board_name: board.name,
      monday_item_id: item.id,
      monday_update_id: update.id,
      external_url: item.url ?? null,
    },
    objectMap: {
      type: 'task',
      canonicalName: item.name,
      displayTitle: item.name,
      externalId: item.id,
      ...(item.url ? { url: item.url } : {}),
    },
  };
}

async function fetchBoard(tokens: MondayTokens, boardId: string): Promise<MondayBoard | null> {
  const data = await gql<{ boards: MondayBoard[] }>(
    tokens,
    `query ($ids: [ID!]) {
      boards(ids: $ids) { id name updated_at workspace { id name } }
    }`,
    { ids: [boardId] },
  );
  return data.boards[0] ?? null;
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
  const data = await gql<{
    boards: {
      activity_logs?: MondayActivityLog[];
      items_page?: { items?: MondayItem[] };
    }[];
  }>(
    tokens,
    `query ($ids: [ID!], $from: ISO8601DateTime!, $to: ISO8601DateTime!) {
      boards(ids: $ids) {
        activity_logs(from: $from, to: $to) { id event data created_at user_id }
        items_page(limit: 50) {
          items {
            id name updated_at url
            creator { id name email }
            column_values { id text type updated_at }
            updates(limit: 10) { id body created_at updated_at creator { id name email } }
          }
        }
      }
    }`,
    { ids: [boardId], from, to },
  );
  const payload = data.boards[0];
  const activityEvents = (payload?.activity_logs ?? []).map((log) => activityEvent(board, log));
  const itemEvents = (payload?.items_page?.items ?? []).flatMap((item) => [
    itemEvent(board, item),
    ...(item.updates ?? []).map((update) => updateEvent(board, item, update)),
  ]);
  const events = [...activityEvents, ...itemEvents];
  const latest = events
    .map((event) => event.occurredAt.toISOString())
    .sort()
    .at(-1);
  return {
    events,
    cursor: {
      activity_since: latest ?? cursor.activity_since ?? to,
      item_since: latest ?? cursor.item_since,
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
    const access = stringValue(body.access_token);
    if (!access) throw new Error('Monday token exchange returned no access_token');
    const refreshToken = stringValue(body.refresh_token);
    const tokenType = stringValue(body.token_type);
    const scope = stringValue(body.scope);
    const tokens: MondayTokens = {
      access_token: access,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      ...(tokenType ? { token_type: tokenType } : {}),
      ...(scope ? { scope } : {}),
    };
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

  async listSyncableResources(_integration, tokens): Promise<ProviderResource[]> {
    const data = await gql<{ boards: MondayBoard[] }>(
      tokens as MondayTokens,
      `query { boards(limit: 100) { id name workspace { id name } } }`,
    );
    return data.boards.map((board) => ({
      externalId: board.id,
      label: board.workspace?.name ? `${board.workspace.name} / ${board.name}` : board.name,
      kind: 'monday.board',
    }));
  },

  async backfill({ tokens, selections, ctx }) {
    for (const selection of selections.filter((item) => item.kind === 'monday.board')) {
      const cursor = (await ctx.loadCursor(`monday.board:${selection.externalId}`)) as MondayCursor;
      const result = await syncBoard(tokens as MondayTokens, selection.externalId, cursor);
      await ctx.writeEvents(result.events);
      await ctx.saveCursor(`monday.board:${selection.externalId}`, result.cursor);
    }
  },

  async incrementalSync({ tokens, selections, ctx }) {
    await this.backfill({ integration: {} as never, tokens, selections, ctx });
  },
};
