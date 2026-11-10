import {
  deferChatDelivery,
  getChatDeliveryPrincipal,
} from '#src/conversation-surfaces/deferred-delivery.js';
import { getEnv } from '#src/env.js';
import { requestBudgetIdentity } from '#src/integrations/request-budget.js';
import { providerRetryAt, withExternalRequest } from '#src/integrations/request.js';
import { childLogger } from '#src/logger.js';
import { getRedisConnection } from '#src/redis/connection.js';
import {
  applyTelegramChatMigration,
  assertTelegramChatRedirectOwnership,
  isTelegramChatMigrationConflictError,
  parseTelegramMigratedChatId,
  replaceTelegramChatId,
  rethrowTelegramChatMigrationWriteError,
  TELEGRAM_CHAT_MIGRATION_CONFLICT_CODE,
  telegramChatIdFromBody,
  telegramMigratedChatId,
  telegramMigratedDigestRedirectDisposition,
  verifyTelegramChatMigrationOwnership,
  type TelegramChatMigrationWriteResult,
} from '#src/telegram/chat-migration.js';

const log = childLogger('telegram');

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

export interface HttpTelegramApiOptions {
  /** Persist a Telegram group→supergroup chat id rewrite. Defaults to the app db. */
  onChatMigrated?: (
    fromChatId: number,
    toChatId: number,
  ) => Promise<TelegramChatMigrationWriteResult | undefined>;
  /**
   * Workspace that originated this send. Redirected migrate retries are
   * authorized only when this principal owns the destination chat. Falls back
   * to {@link getChatDeliveryPrincipal} when omitted.
   */
  sendingTeamId?: string;
  /**
   * In-flight workspace digest ledger key. When a migrated send would collide
   * with an already-delivered new-chat key, the redirect is suppressed.
   * Falls back to {@link getChatDeliveryPrincipal} when omitted.
   */
  dedupeKey?: string;
}

export class HttpTelegramApi implements TelegramApi {
  private readonly token: string;
  private readonly requestTimeoutMs: number;
  private readonly deferRateLimits: boolean;
  private readonly options: HttpTelegramApiOptions;
  constructor(
    token: string,
    requestTimeoutMs = 10_000,
    deferRateLimits = true,
    options: HttpTelegramApiOptions = {},
  ) {
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
    this.token = token;
    this.requestTimeoutMs = requestTimeoutMs;
    this.deferRateLimits = deferRateLimits;
    this.options = options;
  }

  private sendingWorkspaceTeamId(): string | undefined {
    return this.options.sendingTeamId ?? getChatDeliveryPrincipal()?.teamId;
  }

  private inFlightDedupeKey(): string | undefined {
    return this.options.dedupeKey ?? getChatDeliveryPrincipal()?.dedupeKey;
  }

  private digestRedirectDisposition(
    fromChatId: number,
    toChatId: number,
    writeResult: TelegramChatMigrationWriteResult | undefined,
  ): { alreadyDelivered: boolean; skipRedirect: boolean } {
    return telegramMigratedDigestRedirectDisposition({
      inFlightDedupeKey: this.inFlightDedupeKey(),
      teamId: this.sendingWorkspaceTeamId(),
      fromChatId,
      toChatId,
      alreadySentDedupeKeys: writeResult?.alreadySentDedupeKeys ?? [],
      pendingDedupeKeys: writeResult?.pendingDedupeKeys ?? [],
    });
  }

  /**
   * Authorize, then persist, a group→supergroup chat id rewrite.
   *
   * The sending workspace principal must own the destination before the
   * in-flight send is retried against the new id. Discovering another
   * workspace's binding is not authorization. A unique constraint on the
   * binding write is a cross-team conflict. Any other failed write also
   * skips the retry. A workspace digest whose migrated key is already
   * `sent` is reported as already delivered instead of posting twice.
   */
  private async persistChatMigration(
    fromChatId: number,
    toChatId: number,
  ): Promise<{ alreadyDelivered: boolean; skipRedirect: boolean }> {
    const sendingTeamId = this.sendingWorkspaceTeamId();
    if (!sendingTeamId) {
      throw new Error('telegram chat migration skipped: sending workspace is missing');
    }
    try {
      if (this.options.onChatMigrated) {
        const writeResult = await this.options.onChatMigrated(fromChatId, toChatId);
        return this.digestRedirectDisposition(fromChatId, toChatId, writeResult);
      }
      const { getDb } = await import('@timeline/db');
      const db = getDb();
      const ownership = await verifyTelegramChatMigrationOwnership(db, fromChatId, toChatId, {
        sendingTeamId,
      });
      if (!ownership) {
        throw new Error(
          'telegram chat migration skipped: sending workspace ownership could not be established',
        );
      }
      const writeResult = await applyTelegramChatMigration(db, fromChatId, toChatId, {
        sendingTeamId,
      });
      await assertTelegramChatRedirectOwnership(db, toChatId, sendingTeamId);
      return this.digestRedirectDisposition(fromChatId, toChatId, writeResult);
    } catch (err) {
      rethrowTelegramChatMigrationWriteError(err);
    }
  }

  private migrationConflictSendError(error: unknown): Error {
    const detail = error instanceof Error ? error.message : 'Telegram request failed';
    return Object.assign(
      new Error(`${detail} (cross-team chat migration conflict; skipped retry)`, {
        cause: error,
      }),
      { code: TELEGRAM_CHAT_MIGRATION_CONFLICT_CODE },
    );
  }

  private async call<T>(method: string, body: unknown, retried = false): Promise<T> {
    try {
      return await withExternalRequest(
        { provider: 'telegram', identity: this.token, operation: method },
        () => this.request<T>(method, body),
      );
    } catch (error) {
      const fromChatId = telegramChatIdFromBody(body);
      const toChatId = telegramMigratedChatId(error);
      if (!retried && fromChatId !== null && toChatId !== null && fromChatId !== toChatId) {
        try {
          const persistResult = await this.persistChatMigration(fromChatId, toChatId);
          if (persistResult.alreadyDelivered) {
            log.info(
              { fromChatId, toChatId },
              'telegram chat migration skipped redirect: already delivered',
            );
            return undefined as T;
          }
          if (persistResult.skipRedirect) {
            log.info(
              { fromChatId, toChatId },
              'telegram chat migration skipped redirect: destination delivery is in flight',
            );
            throw error;
          }
        } catch (persistErr) {
          if (persistErr === error) throw error;
          if (isTelegramChatMigrationConflictError(persistErr)) {
            log.error(
              { err: persistErr, fromChatId, toChatId },
              'telegram chat migration conflict; not retrying send',
            );
            throw this.migrationConflictSendError(error);
          }
          log.error(
            { err: persistErr, fromChatId, toChatId },
            'telegram chat migration persist failed; not retrying send',
          );
          throw error;
        }
        replaceTelegramChatId(body, toChatId);
        return this.call(method, body, true);
      }
      throw error;
    }
  }

  private telegramMethodError(method: string, detail: string, payload?: unknown): Error {
    const migrated = parseTelegramMigratedChatId(payload ?? detail);
    return Object.assign(new Error(`Telegram ${method} failed: ${detail}`), {
      ...(migrated !== null ? { migrateToChatId: migrated } : {}),
    });
  }

  private async request<T>(method: string, body: unknown): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    }).catch((error: unknown) => {
      if (method === 'sendMessage')
        throw Object.assign(new Error('Telegram delivery outcome unknown'), {
          code: 'delivery_outcome_unknown',
          cause: error,
        });
      throw error;
    });
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as {
        parameters?: { retry_after?: number };
      };
      const headers = new Headers(res.headers);
      if (typeof body.parameters?.retry_after === 'number')
        headers.set('retry-after', String(body.parameters.retry_after));
      throw Object.assign(new Error('Telegram rate limited'), {
        retryAt: providerRetryAt(headers),
      });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw this.telegramMethodError(method, `${res.status} ${text}`, text);
    }
    const json = (await res.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
      parameters?: { migrate_to_chat_id?: number };
    };
    if (!json.ok) {
      throw this.telegramMethodError(method, json.description ?? 'unknown', json);
    }
    return json.result as T;
  }

  async sendMessage(input: Parameters<TelegramApi['sendMessage']>[0]): Promise<void> {
    try {
      await this.call('sendMessage', input);
    } catch (error) {
      if (
        this.deferRateLimits &&
        (await deferChatDelivery(
          { provider: 'telegram', token: this.token, method: 'send', body: input },
          error,
        ))
      )
        return;
      throw error;
    }
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
    try {
      await this.call('editMessageText', input);
    } catch (error) {
      if (
        this.deferRateLimits &&
        (await deferChatDelivery(
          { provider: 'telegram', token: this.token, method: 'edit', body: input },
          error,
        ))
      )
        return;
      throw error;
    }
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
    if (getEnv().REDIS_URL) {
      const key = `${requestBudgetIdentity('telegram', this.token)}:typing:${input.chat_id}`;
      if (!(await getRedisConnection().set(key, '1', 'PX', 4000, 'NX'))) return;
    }
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
    return withExternalRequest(
      { provider: 'telegram', identity: this.token, operation: 'downloadFile' },
      () => this.readFile(filePath, maxBytes),
    );
  }

  private async readFile(filePath: string, maxBytes?: number): Promise<Buffer> {
    const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${filePath}`, {
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!res.ok) {
      if (res.status === 429)
        throw Object.assign(new Error('Telegram rate limited'), {
          retryAt: providerRetryAt(res.headers),
        });
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

    const reader: Pick<
      ReadableStreamDefaultReader<Uint8Array>,
      'read' | 'cancel' | 'releaseLock'
    > = res.body.getReader();
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
  teamId?: string;
}): Promise<void> {
  const api =
    input.api ??
    new HttpTelegramApi(input.token, 10_000, true, {
      ...(input.teamId ? { sendingTeamId: input.teamId } : {}),
    });
  await api.sendMessage({ chat_id: input.chatId, text: input.text });
}
