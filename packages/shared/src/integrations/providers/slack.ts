import type { externalFetch } from '#src/http/external-fetch.js';
import type {
  IntegrationEvent,
  IntegrationProvider,
  OAuthCallbackInput,
  ProviderRateLimitError,
  ProviderResource,
  SyncContext,
  SyncContinuation,
} from '#src/integrations/types.js';

import { getEnv } from '#src/env.js';
import { providerFetch, providerRetryAt } from '#src/integrations/request.js';
import {
  attachSyncContinuation,
  ProviderRateLimitError as ProviderRateLimit,
} from '#src/integrations/types.js';
import { SlackApi } from '#src/slack/api.js';

const defaultFetch = providerFetch('slack');

let fetch: typeof externalFetch = defaultFetch;

export function setSlackProviderFetchForTests(transport?: typeof externalFetch): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Slack provider test transport is unavailable in production');
  }
  fetch = transport ?? defaultFetch;
}

const AUTH_URL = 'https://slack.com/oauth/v2/authorize';
const SCOPES = [
  'channels:read',
  'channels:history',
  'groups:read',
  'groups:history',
  'files:read',
  'reactions:read',
  'users:read',
  'users:read.email',
];
const INCREMENTAL_LOOKBACK_MS = 48 * 60 * 60 * 1000;

interface SlackTokens {
  access_token: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: { id: string; name?: string };
  authed_user?: { id?: string; access_token?: string; scope?: string };
}

interface SlackMessage {
  type?: string;
  subtype?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  latest_reply?: string;
  edited?: { user?: string; ts?: string };
  reactions?: { name: string; count: number; users?: string[] }[];
  files?: {
    id?: string;
    name?: string;
    title?: string;
    mimetype?: string;
    url_private?: string;
  }[];
}

interface SlackHistoryResponse {
  ok: boolean;
  error?: string;
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

interface SlackCursor {
  latest_ts?: string | undefined;
  backfill_before_ts?: string | undefined;
  history_page?: string | undefined;
  history_oldest?: string | undefined;
  pending_threads?: { ts: string; next?: string; signature: string }[];
  thread_versions?: Record<string, string>;
  history_complete?: boolean;
  full_walk?: boolean;
  initialized?: boolean;
}

function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('user_scope', 'channels:history,groups:history');
  url.searchParams.set('state', input.state);
  return url.toString();
}

function slackRateLimitError(method: string, res: Response): ProviderRateLimitError {
  const retryAt = providerRetryAt(res.headers);
  const retryAfter = Math.max(1, Math.ceil((retryAt.getTime() - Date.now()) / 1000));
  return new ProviderRateLimit({
    provider: 'slack',
    retryAt,
    retryAfterSeconds: retryAfter,
    scope: 'web_api',
    reason: 'slack_rate_limited',
    message: `slack_rate_limited: Slack Web API ${method} limited; retry after ${retryAt.toISOString()}`,
  });
}

async function slackCall<T extends { ok: boolean; error?: string }>(
  token: string,
  method: string,
  body: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(
      Object.entries(body).flatMap(([key, value]) =>
        value === undefined ? [] : ([[key, String(value)]] as [string, string][]),
      ),
    ).toString(),
  });
  if (res.status === 429) throw slackRateLimitError(method, res);
  const json = (await res.json()) as T;
  if (json.error === 'ratelimited') throw slackRateLimitError(method, res);
  if (!res.ok || !json.ok) throw new Error(`Slack ${method} failed: ${json.error ?? res.status}`);
  return json;
}

function occurredAtFromTs(ts: string): Date {
  const millis = Number(ts) * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function messageEvent(teamId: string, channel: string, message: SlackMessage): IntegrationEvent {
  const isEdit = Boolean(message.edited);
  const objectMap =
    message.thread_ts && message.thread_ts === message.ts
      ? {
          type: 'topic' as const,
          canonicalName: message.text?.slice(0, 120) ?? `Slack thread ${message.ts}`,
          displayTitle: message.text?.slice(0, 120) ?? `Slack thread ${message.ts}`,
          externalId: `${channel}:${message.ts}`,
        }
      : undefined;
  return {
    dedupKey: `slack:message:${teamId}:${channel}:${message.ts}:${message.edited?.ts ?? ''}`,
    provider: 'slack',
    signalClass: 'communication',
    externalObjectId: `${channel}:${message.thread_ts ?? message.ts}`,
    externalEventId: message.ts,
    eventType: isEdit
      ? 'message.edited'
      : message.thread_ts && message.thread_ts !== message.ts
        ? 'thread.reply'
        : 'message.created',
    occurredAt: occurredAtFromTs(message.edited?.ts ?? message.ts),
    actor: message.user
      ? { externalId: message.user, ...(message.username ? { name: message.username } : {}) }
      : null,
    contentText: message.text?.trim() ?? '(Slack message without text)',
    extra: {
      slack_team_id: teamId,
      slack_channel_id: channel,
      slack_message_ts: message.ts,
      slack_thread_ts: message.thread_ts ?? null,
      slack_subtype: message.subtype ?? null,
      files: message.files ?? [],
      external_url: `https://slack.com/archives/${channel}/p${message.ts.replace('.', '')}`,
    },
    ...(objectMap ? { objectMap } : {}),
  };
}

function reactionEvents(
  teamId: string,
  channel: string,
  message: SlackMessage,
): IntegrationEvent[] {
  return (message.reactions ?? []).map((reaction) => ({
    dedupKey: `slack:reaction:${teamId}:${channel}:${message.ts}:${reaction.name}`,
    provider: 'slack',
    externalObjectId: `${channel}:${message.thread_ts ?? message.ts}`,
    externalEventId: `${message.ts}:${reaction.name}`,
    eventType: 'reaction.added',
    occurredAt: occurredAtFromTs(message.ts),
    contentText: `Slack reaction :${reaction.name}: x${String(reaction.count)} on ${message.text ?? 'a message'}`,
    extra: {
      slack_team_id: teamId,
      slack_channel_id: channel,
      slack_message_ts: message.ts,
      reaction: reaction.name,
      count: reaction.count,
      users: reaction.users ?? [],
    },
  }));
}

function fileEvents(teamId: string, channel: string, message: SlackMessage): IntegrationEvent[] {
  return (message.files ?? []).flatMap((file) => {
    if (!file.id) return [];
    const title = file.title ?? file.name ?? file.id;
    return [
      {
        dedupKey: `slack:file:${teamId}:${channel}:${message.ts}:${file.id}`,
        provider: 'slack',
        externalObjectId: file.id,
        externalEventId: `${message.ts}:${file.id}`,
        eventType: 'file.shared',
        occurredAt: occurredAtFromTs(message.ts),
        actor: message.user
          ? { externalId: message.user, ...(message.username ? { name: message.username } : {}) }
          : null,
        contentText: `Slack file shared: ${title}`,
        extra: {
          slack_team_id: teamId,
          slack_channel_id: channel,
          slack_message_ts: message.ts,
          slack_file_id: file.id,
          filename: file.name ?? null,
          title,
          mimetype: file.mimetype ?? null,
          external_url: file.url_private ?? null,
        },
        objectMap: {
          type: 'document',
          canonicalName: title,
          displayTitle: title,
          externalId: file.id,
          ...(file.url_private ? { url: file.url_private } : {}),
        },
      },
    ];
  });
}

async function syncChannel(
  token: string,
  teamId: string,
  channel: string,
  cursor: SlackCursor,
  ctx: SyncContext,
  replyToken = token,
): Promise<SyncContinuation[]> {
  const key = `slack.channel:${channel}`;
  const continuation = { resourceType: 'slack.channel', externalId: channel };
  const next: SlackCursor = {
    ...cursor,
    thread_versions: { ...cursor.thread_versions },
    pending_threads: [...(cursor.pending_threads ?? [])],
  };
  const pendingThreads = next.pending_threads ?? [];
  const versions = next.thread_versions ?? {};
  const save = async (pending: boolean) => {
    if (pending && ctx.saveCursorWithContinuations)
      await ctx.saveCursorWithContinuations(key, next, [continuation]);
    else await ctx.saveCursor(key, next);
  };
  try {
    if (!next.pending_threads?.length && !next.history_complete) {
      const oldest =
        next.history_oldest ??
        ((next.initialized || next.latest_ts) && !next.backfill_before_ts && !next.full_walk
          ? ((Date.now() - INCREMENTAL_LOOKBACK_MS) / 1000).toFixed(6)
          : undefined);
      const page = await slackCall<SlackHistoryResponse>(token, 'conversations.history', {
        channel,
        limit: 15,
        cursor: next.history_page,
        oldest,
        ...(next.backfill_before_ts ? { latest: next.backfill_before_ts, inclusive: false } : {}),
      });
      const messages = page.messages ?? [];
      await ctx.writeEvents(
        messages.flatMap((message) => [
          messageEvent(teamId, channel, message),
          ...reactionEvents(teamId, channel, message),
          ...fileEvents(teamId, channel, message),
        ]),
      );
      for (const message of messages) {
        if (!next.latest_ts || Number(message.ts) > Number(next.latest_ts))
          next.latest_ts = message.ts;
        if (message.thread_ts !== message.ts) continue;
        // Root metadata does not prove replies are unchanged. Quota protection
        // deliberately leaves missed reply edits to manual resync.
        const signature = `${message.reply_count ?? ''}:${message.latest_reply ?? ''}:${message.edited?.ts ?? ''}`;
        if (next.thread_versions?.[message.ts] !== signature)
          pendingThreads.push({ ts: message.ts, signature });
      }
      next.history_page = page.response_metadata?.next_cursor ?? undefined;
      next.history_oldest = oldest;
      next.history_complete = !next.history_page;
      await save(false);
    }
    const thread = next.pending_threads?.[0];
    if (thread) {
      const page = await slackCall<SlackHistoryResponse>(replyToken, 'conversations.replies', {
        channel,
        ts: thread.ts,
        cursor: thread.next,
        limit: 15,
      });
      await ctx.writeEvents(
        (page.messages ?? [])
          .filter((message) => message.ts !== thread.ts)
          .flatMap((message) => [
            messageEvent(teamId, channel, message),
            ...reactionEvents(teamId, channel, message),
            ...fileEvents(teamId, channel, message),
          ]),
      );
      const pageCursor = page.response_metadata?.next_cursor;
      if (pageCursor) thread.next = pageCursor;
      else {
        versions[thread.ts] = thread.signature;
        pendingThreads.shift();
      }
    }
    const pending = (next.pending_threads?.length ?? 0) > 0 || Boolean(next.history_page);
    if (!pending) {
      next.initialized = true;
      delete next.full_walk;
      delete next.history_complete;
      delete next.history_oldest;
      delete next.backfill_before_ts;
      // Only retain recent thread metadata; content remains in immutable events.
      next.thread_versions = Object.fromEntries(
        Object.entries(next.thread_versions ?? {}).filter(
          ([ts]) => Number(ts) * 1000 >= Date.now() - INCREMENTAL_LOOKBACK_MS,
        ),
      );
    }
    await save(pending);
    return pending ? [continuation] : [];
  } catch (error) {
    await save(true);
    if (error instanceof Error) throw attachSyncContinuation(error, continuation);
    throw error;
  }
}

async function syncSlackResources(
  { integration, tokens, selections, ctx }: Parameters<IntegrationProvider['backfill']>[0],
  full: boolean,
) {
  const slackTokens = tokens as SlackTokens;
  const teamId = integration.externalAccountId ?? slackTokens.team?.id;
  if (!teamId) throw new Error('slack_missing_team_id');
  const continuations: SyncContinuation[] = [];
  for (const selection of selections.filter((item) => item.kind === 'slack.channel')) {
    const cursor = (await ctx.loadCursor(`slack.channel:${selection.externalId}`)) as SlackCursor;
    // A migration-paused initial import can resume via the scheduled worker.
    // Keep its unbounded initial window stable across all continuation pages.
    if (!cursor.initialized && !cursor.latest_ts) cursor.full_walk = true;
    if (full && !cursor.full_walk && !cursor.history_page && !cursor.pending_threads?.length) {
      cursor.full_walk = true;
      delete cursor.history_oldest;
      cursor.thread_versions = {};
    }
    continuations.push(
      ...(await syncChannel(
        slackTokens.access_token,
        teamId,
        selection.externalId,
        cursor,
        ctx,
        slackTokens.authed_user?.access_token,
      )),
    );
  }
  return continuations.length ? { continuations } : undefined;
}

export const slackProvider: IntegrationProvider = {
  id: 'slack',
  displayLabel: 'Slack',

  // eslint-disable-next-line @typescript-eslint/require-await
  async startOAuth(input) {
    const env = getEnv();
    if (!env.SLACK_CLIENT_ID) throw new Error('SLACK_CLIENT_ID not configured');
    return {
      authorizeUrl: buildAuthorizeUrl({
        clientId: env.SLACK_CLIENT_ID,
        redirectUri: input.redirectUri,
        state: input.state,
      }),
    };
  },

  async handleOAuthCallback(input: OAuthCallbackInput) {
    const env = getEnv();
    if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
      throw new Error('SLACK_CLIENT_ID / SLACK_CLIENT_SECRET not configured');
    }
    const oauth = await new SlackApi('').oauthV2Access({
      clientId: env.SLACK_CLIENT_ID,
      clientSecret: env.SLACK_CLIENT_SECRET,
      code: input.code,
      redirectUri: input.redirectUri,
    });
    if (!oauth.team?.id || !oauth.access_token) {
      throw new Error('slack_oauth_missing_team_or_token');
    }
    const tokens: SlackTokens = {
      access_token: oauth.access_token,
      ...(oauth.token_type ? { token_type: oauth.token_type } : {}),
      ...(oauth.scope ? { scope: oauth.scope } : {}),
      ...(oauth.bot_user_id ? { bot_user_id: oauth.bot_user_id } : {}),
      ...(oauth.app_id ? { app_id: oauth.app_id } : {}),
      team: oauth.team,
      ...(oauth.authed_user ? { authed_user: oauth.authed_user } : {}),
    };
    return {
      externalAccountId: oauth.team.id,
      displayName: `Slack — ${oauth.team.name ?? oauth.team.id}`,
      scopes: oauth.scope?.split(',') ?? [],
      tokens: tokens as unknown as Record<string, unknown>,
    };
  },

  async listSyncableResources(_integration, tokens): Promise<ProviderResource[]> {
    const slackTokens = tokens as SlackTokens;
    const conversations = await new SlackApi(slackTokens.access_token).conversationsList(
      'public_channel,private_channel',
    );
    return conversations.map((conversation) => ({
      externalId: conversation.id,
      label: conversation.name ? `#${conversation.name}` : conversation.id,
      kind: 'slack.channel',
    }));
  },

  backfill(input) {
    return syncSlackResources(input, true);
  },

  async handleWebhook({ integration, tokens, payload }) {
    const root = payload as { event?: Record<string, unknown>; event_id?: string };
    const event = root.event;
    if (!event) return [];
    const item = event.item as { channel?: string; ts?: string } | undefined;
    const channel =
      typeof event.channel === 'string'
        ? event.channel
        : typeof event.channel_id === 'string'
          ? event.channel_id
          : item?.channel;
    if (!channel) return [];
    const team = integration.externalAccountId ?? '';
    if (
      (event.type === 'file_shared' || event.type === 'file_change') &&
      typeof event.file_id === 'string'
    ) {
      const response = await slackCall<{
        ok: boolean;
        file?: NonNullable<SlackMessage['files']>[number];
      }>((tokens as unknown as SlackTokens).access_token, 'files.info', { file: event.file_id });
      if (!response.file) return [];
      return fileEvents(team, channel, {
        ts: typeof event.event_ts === 'string' ? event.event_ts : '0',
        files: [response.file],
      });
    }
    if (event.type === 'message' && event.subtype !== 'message_deleted') {
      const rawMessage = event.subtype === 'message_changed' ? event.message : event;
      if (
        !rawMessage ||
        typeof rawMessage !== 'object' ||
        !('ts' in rawMessage) ||
        typeof rawMessage.ts !== 'string'
      )
        return [];
      const message = rawMessage as SlackMessage;
      return [messageEvent(team, channel, message), ...fileEvents(team, channel, message)];
    }
    const deleted = event.subtype === 'message_deleted';
    const reaction = event.type === 'reaction_added' || event.type === 'reaction_removed';
    const ts = deleted ? event.deleted_ts : item?.ts;
    if ((!deleted && !reaction) || typeof ts !== 'string') return [];
    return [
      {
        provider: 'slack',
        dedupKey: `slack:event:${root.event_id}`,
        externalObjectId: `${channel}:${ts}`,
        externalEventId: root.event_id ?? ts,
        eventType: deleted
          ? 'message.deleted'
          : event.type === 'reaction_added'
            ? 'reaction.added'
            : 'reaction.removed',
        occurredAt: occurredAtFromTs(typeof event.event_ts === 'string' ? event.event_ts : ts),
        contentText: deleted
          ? 'Slack message deleted'
          : `Slack reaction ${typeof event.reaction === 'string' ? event.reaction : ''}`,
        extra: { slack_team_id: team, slack_channel_id: channel, slack_message_ts: ts },
      },
    ];
  },

  async incrementalSync({ integration, tokens, selections, ctx }) {
    return syncSlackResources({ integration, tokens, selections, ctx }, false);
  },
};
