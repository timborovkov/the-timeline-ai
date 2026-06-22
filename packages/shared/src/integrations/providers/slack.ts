import type {
  IntegrationEvent,
  IntegrationProvider,
  OAuthCallbackInput,
  ProviderResource,
} from '#src/integrations/types.js';

import { getEnv } from '#src/env.js';
import { SlackApi } from '#src/slack/api.js';

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
  url.searchParams.set('state', input.state);
  return url.toString();
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
  const json = (await res.json()) as T;
  if (!res.ok || !json.ok) throw new Error(`Slack ${method} failed: ${json.error ?? res.status}`);
  return json;
}

async function fetchHistory(
  token: string,
  channel: string,
  cursor: SlackCursor,
): Promise<{ messages: SlackMessage[]; next: SlackCursor }> {
  const messages: SlackMessage[] = [];
  let pageCursor: string | undefined;
  let maxTs = cursor.latest_ts;
  for (;;) {
    const res = await slackCall<SlackHistoryResponse>(token, 'conversations.history', {
      channel,
      limit: 200,
      cursor: pageCursor,
      oldest: cursor.latest_ts,
      inclusive: false,
      include_all_metadata: true,
    });
    for (const message of res.messages ?? []) {
      messages.push(message);
      if (!maxTs || Number(message.ts) > Number(maxTs)) maxTs = message.ts;
    }
    pageCursor = res.response_metadata?.next_cursor ?? undefined;
    if (!pageCursor) break;
  }
  return {
    messages,
    next: (maxTs ?? cursor.latest_ts) ? { latest_ts: maxTs ?? cursor.latest_ts } : {},
  };
}

async function fetchReplies(
  token: string,
  channel: string,
  root: SlackMessage,
): Promise<SlackMessage[]> {
  if (!root.thread_ts || root.thread_ts !== root.ts) return [];
  const replies: SlackMessage[] = [];
  let pageCursor: string | undefined;
  for (;;) {
    const res = await slackCall<SlackHistoryResponse>(token, 'conversations.replies', {
      channel,
      ts: root.thread_ts,
      limit: 200,
      cursor: pageCursor,
    });
    replies.push(...(res.messages ?? []).filter((message) => message.ts !== root.ts));
    pageCursor = res.response_metadata?.next_cursor ?? undefined;
    if (!pageCursor) break;
  }
  return replies;
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
    dedupKey: `slack:reaction:${teamId}:${channel}:${message.ts}:${reaction.name}:${String(reaction.count)}`,
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
): Promise<{ events: IntegrationEvent[]; cursor: SlackCursor }> {
  const history = await fetchHistory(token, channel, cursor);
  const withReplies: SlackMessage[] = [];
  for (const message of history.messages) {
    withReplies.push(message, ...(await fetchReplies(token, channel, message)));
  }
  const latestTs = withReplies.reduce(
    (latest, message) => (!latest || Number(message.ts) > Number(latest) ? message.ts : latest),
    history.next.latest_ts,
  );
  const events = withReplies.flatMap((message) => [
    messageEvent(teamId, channel, message),
    ...reactionEvents(teamId, channel, message),
    ...fileEvents(teamId, channel, message),
  ]);
  return { events, cursor: latestTs ? { latest_ts: latestTs } : history.next };
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
      scopes: SCOPES,
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

  async backfill({ tokens, selections, ctx }) {
    const slackTokens = tokens as SlackTokens;
    const teamId = slackTokens.team?.id ?? 'slack';
    for (const selection of selections.filter((item) => item.kind === 'slack.channel')) {
      const cursor = (await ctx.loadCursor(`slack.channel:${selection.externalId}`)) as SlackCursor;
      const result = await syncChannel(
        slackTokens.access_token,
        teamId,
        selection.externalId,
        cursor,
      );
      await ctx.writeEvents(result.events);
      await ctx.saveCursor(`slack.channel:${selection.externalId}`, result.cursor);
    }
  },

  async incrementalSync({ tokens, selections, ctx }) {
    await this.backfill({ integration: {} as never, tokens, selections, ctx });
  },
};
