import type { SlackFile } from './types.js';

export interface SlackConversation {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_member?: boolean;
}

export interface SlackUserProfile {
  id: string;
  name?: string;
  real_name?: string;
  profile?: {
    email?: string;
    image_72?: string;
    real_name?: string;
    display_name?: string;
  };
}

interface SlackResponse {
  ok: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
}

export class SlackApi {
  constructor(private readonly token: string) {}

  private async call<T extends SlackResponse>(
    method: string,
    body: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(
        Object.entries(body).flatMap(([k, v]) =>
          v === undefined ? [] : ([[k, String(v)]] as [string, string][]),
        ),
      ),
    });
    const json = (await res.json()) as T;
    if (!res.ok || !json.ok) {
      throw new Error(`Slack ${method} failed: ${json.error ?? res.statusText}`);
    }
    return json;
  }

  async oauthV2Access(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<SlackOAuthAccessResponse> {
    return this.call<SlackOAuthAccessResponse>('oauth.v2.access', {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    });
  }

  async authTest(): Promise<{
    ok: true;
    team_id: string;
    user_id: string;
    bot_id?: string;
    url?: string;
  }> {
    return this.call('auth.test', {});
  }

  async usersInfo(user: string): Promise<SlackUserProfile | null> {
    const res = await this.call<SlackResponse & { user?: SlackUserProfile }>('users.info', {
      user,
    });
    return res.user ?? null;
  }

  async conversationsInfo(channel: string): Promise<SlackConversation | null> {
    const res = await this.call<SlackResponse & { channel?: SlackConversation }>(
      'conversations.info',
      { channel },
    );
    return res.channel ?? null;
  }

  async conversationsList(types = 'public_channel,private_channel'): Promise<SlackConversation[]> {
    const out: SlackConversation[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const res = await this.call<SlackResponse & { channels?: SlackConversation[] }>(
        'conversations.list',
        { types, limit: 200, exclude_archived: true, cursor },
      );
      out.push(...(res.channels ?? []));
      cursor = res.response_metadata?.next_cursor ?? undefined;
      if (!cursor) break;
    }
    return out;
  }

  async postMessage(input: {
    channel: string;
    text: string;
    thread_ts?: string;
    response_url?: string;
    response_type?: 'ephemeral' | 'in_channel';
  }): Promise<void> {
    if (input.response_url) {
      await fetch(input.response_url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: input.text,
          response_type: input.response_type ?? 'ephemeral',
          ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}),
        }),
      });
      return;
    }
    await this.call('chat.postMessage', {
      channel: input.channel,
      text: input.text,
      thread_ts: input.thread_ts,
    });
  }

  async addReaction(input: { channel: string; timestamp: string; name: string }): Promise<void> {
    await this.call('reactions.add', {
      channel: input.channel,
      timestamp: input.timestamp,
      name: input.name,
    });
  }

  async downloadFile(file: SlackFile): Promise<Buffer> {
    const url = file.url_private_download ?? file.url_private;
    if (!url) throw new Error('Slack file has no private download URL');
    const res = await fetch(url, { headers: { authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`Slack file download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

export interface SlackOAuthAccessResponse extends SlackResponse {
  ok: true;
  access_token?: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: { id: string; name?: string };
  enterprise?: { id: string; name?: string };
  authed_user?: { id: string; access_token?: string; scope?: string };
}
