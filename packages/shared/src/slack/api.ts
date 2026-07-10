import type { SlackFile } from '#src/slack/types.js';

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

function deterministicSlackApiResponse(method: string): SlackResponse | undefined {
  if (process.env.NODE_ENV === 'production' || process.env.E2E_DETERMINISTIC_SLACK_API !== '1') {
    return undefined;
  }
  if (method === 'conversations.list') {
    return {
      ok: true,
      channels: [
        { id: 'C_E2E_LAUNCH', name: 'launch', is_channel: true, is_member: true },
        { id: 'C_E2E_SUPPORT', name: 'support', is_channel: true, is_member: true },
        { id: 'C_E2E_PRIVATE', name: 'private-plans', is_group: true, is_member: false },
      ],
    } as SlackResponse;
  }
  if (method === 'conversations.info') {
    return {
      ok: true,
      channel: { id: 'C_E2E_SUPPORT', name: 'support', is_channel: true, is_member: true },
    } as SlackResponse;
  }
  return undefined;
}

async function responseBufferWithLimit(res: Response, maxBytes?: number): Promise<Buffer> {
  if (maxBytes !== undefined) {
    const len = res.headers.get('content-length');
    if (len) {
      const n = Number.parseInt(len, 10);
      if (Number.isFinite(n) && n > maxBytes) throw new Error('file_oversize');
    }
  }

  if (res.body === null) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (maxBytes !== undefined && buf.length > maxBytes) throw new Error('file_oversize');
    return buf;
  }

  const reader: ReadableStreamDefaultReader<Uint8Array> = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (maxBytes !== undefined && total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error('file_oversize');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export class SlackApi {
  constructor(private readonly token: string) {}

  private async call<T extends SlackResponse>(
    method: string,
    body: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const deterministic = deterministicSlackApiResponse(method);
    if (deterministic) return deterministic as T;

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
    blocks?: unknown[];
  }): Promise<void> {
    if (input.response_url) {
      await fetch(input.response_url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: input.text,
          mrkdwn: false,
          response_type: input.response_type ?? 'ephemeral',
          ...(input.blocks ? { blocks: input.blocks } : {}),
          ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}),
        }),
      });
      return;
    }
    await this.call('chat.postMessage', {
      channel: input.channel,
      text: input.text,
      mrkdwn: false,
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

  async downloadFile(file: SlackFile, maxBytes?: number): Promise<Buffer> {
    const url = file.url_private_download ?? file.url_private;
    if (!url) throw new Error('Slack file has no private download URL');
    const res = await fetch(url, { headers: { authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`Slack file download failed: ${res.status}`);
    return responseBufferWithLimit(res, maxBytes);
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
