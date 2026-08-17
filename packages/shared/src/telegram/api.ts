/**
 * Minimal Telegram Bot API client. We only implement the handful of methods
 * the webhook flow needs, plus `setMyCommands` for startup `/` menu
 * registration. No SDK — `fetch` is enough and keeps the dependency
 * surface tiny.
 */
export interface TelegramAdminListEntry {
  user: { id: number; username?: string };
}

export interface TelegramFileInfo {
  file_id: string;
  file_path: string;
  file_size?: number;
}

export interface TelegramApi {
  sendMessage(input: {
    chat_id: number;
    text: string;
    parse_mode?: 'HTML' | 'MarkdownV2';
    reply_to_message_id?: number;
    reply_parameters?: {
      message_id: number;
      allow_sending_without_reply?: boolean;
    };
    reply_markup?: unknown;
  }): Promise<void>;
  getChatAdministrators(input: { chat_id: number }): Promise<TelegramAdminListEntry[]>;
  answerCallbackQuery(input: { callback_query_id: string; text?: string }): Promise<void>;
  editMessageText(input: {
    chat_id: number;
    message_id: number;
    text: string;
    reply_markup?: unknown;
  }): Promise<void>;
  /** Resolve a Telegram file_id to its CDN path. */
  getFile(input: { file_id: string }): Promise<TelegramFileInfo>;
  /** Download the bytes of a file resolved via {@link getFile}. */
  downloadFile(filePath: string, maxBytes?: number): Promise<Buffer>;
  /**
   * React to a message with a single emoji. Best-effort: callers should swallow
   * errors so a failed reaction never breaks the surrounding flow (ingest, ack).
   */
  setMessageReaction(input: { chat_id: number; message_id: number; emoji: string }): Promise<void>;
  /**
   * Show a typing indicator in the chat. Auto-expires after ~5s on Telegram's
   * side. Used to acknowledge expensive commands like `/ask` while the agent
   * runs.
   */
  sendChatAction(input: {
    chat_id: number;
    action: 'typing' | 'upload_photo' | 'record_voice' | 'upload_voice';
  }): Promise<void>;
}

export class HttpTelegramApi implements TelegramApi {
  constructor(
    private readonly token: string,
    private readonly requestTimeoutMs = 10_000,
  ) {
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  private async call<T>(method: string, body: unknown): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Telegram ${method} failed: ${res.status} ${text}`);
    }
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) {
      throw new Error(`Telegram ${method} failed: ${json.description ?? 'unknown'}`);
    }
    return json.result as T;
  }

  async sendMessage(input: Parameters<TelegramApi['sendMessage']>[0]): Promise<void> {
    await this.call('sendMessage', input);
  }

  async getChatAdministrators(
    input: Parameters<TelegramApi['getChatAdministrators']>[0],
  ): Promise<TelegramAdminListEntry[]> {
    return this.call('getChatAdministrators', input);
  }

  async answerCallbackQuery(
    input: Parameters<TelegramApi['answerCallbackQuery']>[0],
  ): Promise<void> {
    await this.call('answerCallbackQuery', input);
  }

  async editMessageText(input: Parameters<TelegramApi['editMessageText']>[0]): Promise<void> {
    await this.call('editMessageText', input);
  }

  async getFile(input: Parameters<TelegramApi['getFile']>[0]): Promise<TelegramFileInfo> {
    return this.call<TelegramFileInfo>('getFile', input);
  }

  async setMessageReaction(input: Parameters<TelegramApi['setMessageReaction']>[0]): Promise<void> {
    await this.call('setMessageReaction', {
      chat_id: input.chat_id,
      message_id: input.message_id,
      reaction: [{ type: 'emoji', emoji: input.emoji }],
    });
  }

  async sendChatAction(input: Parameters<TelegramApi['sendChatAction']>[0]): Promise<void> {
    await this.call('sendChatAction', input);
  }

  /**
   * Replace the `/` menu for one Bot API command scope. The web startup path
   * posts `setMyCommands` through the command catalog; this method is the
   * shared client equivalent for tests and other callers.
   */
  async setMyCommands(input: {
    commands: { command: string; description: string }[];
    scope?: { type: string };
  }): Promise<void> {
    await this.call('setMyCommands', input);
  }

  async downloadFile(filePath: string, maxBytes?: number): Promise<Buffer> {
    const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${filePath}`, {
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Telegram file download failed: ${res.status}`);
    }
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
}

/**
 * No-op API used when TELEGRAM_BOT_TOKEN is unset. The dispatcher still runs
 * (so unit tests can exercise it), but reply attempts become silent.
 */
export class NoopTelegramApi implements TelegramApi {
  sendMessage(): Promise<void> {
    return Promise.resolve();
  }
  getChatAdministrators(): Promise<TelegramAdminListEntry[]> {
    return Promise.resolve([]);
  }
  answerCallbackQuery(): Promise<void> {
    return Promise.resolve();
  }
  editMessageText(): Promise<void> {
    return Promise.resolve();
  }
  getFile(): Promise<TelegramFileInfo> {
    return Promise.reject(new Error('TELEGRAM_BOT_TOKEN unset — cannot fetch files'));
  }
  setMessageReaction(): Promise<void> {
    return Promise.resolve();
  }
  sendChatAction(): Promise<void> {
    return Promise.resolve();
  }
  setMyCommands(): Promise<void> {
    return Promise.resolve();
  }
  downloadFile(_filePath?: string, _maxBytes?: number): Promise<Buffer> {
    return Promise.reject(new Error('TELEGRAM_BOT_TOKEN unset — cannot download files'));
  }
}

export async function sendTelegramBotMessage(input: {
  chatId: number;
  text: string;
  token: string;
  api?: TelegramApi;
}): Promise<void> {
  const api = input.api ?? new HttpTelegramApi(input.token);
  await api.sendMessage({ chat_id: input.chatId, text: input.text });
}
