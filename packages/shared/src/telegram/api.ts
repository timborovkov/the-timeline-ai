/**
 * Minimal Telegram Bot API client. We only implement the handful of methods
 * the webhook flow needs. No SDK — `fetch` is enough and keeps the dependency
 * surface tiny.
 */
export interface TelegramAdminListEntry {
  user: { id: number; username?: string };
}

export interface TelegramApi {
  sendMessage(input: {
    chat_id: number;
    text: string;
    parse_mode?: 'HTML' | 'MarkdownV2';
    reply_to_message_id?: number;
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
}

export class HttpTelegramApi implements TelegramApi {
  constructor(private readonly token: string) {
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  private async call<T>(method: string, body: unknown): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
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
}
