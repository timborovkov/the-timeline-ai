type Metadata = Record<string, unknown>;

export interface RawEventForAiInput {
  source: string;
  contentText: string | null;
  sourceMetadata: unknown;
}

function metadataObject(value: unknown): Metadata {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Metadata) : {};
}

function metadataString(meta: Metadata, key: string, max = 120): string | null {
  const value = meta[key];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= max) return text;
  if (max <= 0) return '';
  if (max <= 3) return '.'.repeat(max);
  return `${text.slice(0, max - 3)}...`;
}

function renderTelegramContext(meta: Metadata): string | null {
  const parts = ['Telegram'];
  const chatType = metadataString(meta, 'tg_chat_type');
  if (chatType) parts.push(chatType === 'private' ? 'DM' : chatType);

  const senderName = metadataString(meta, 'tg_sender_name');
  const username = metadataString(meta, 'tg_username');
  const userId = metadataString(meta, 'tg_user_id');
  if (senderName) {
    parts.push(`sender ${senderName}`);
  } else if (username) {
    parts.push(`sender @${username.replace(/^@/, '')}`);
  } else if (userId) {
    parts.push(`sender Telegram user ${userId}`);
  }

  const chatTitle = metadataString(meta, 'tg_chat_title');
  const chatId = metadataString(meta, 'tg_chat_id');
  if (chatTitle) {
    parts.push(`chat ${chatTitle}`);
  } else if (chatId && chatType !== 'private') {
    parts.push(`chat ${chatId}`);
  }

  const caption = metadataString(meta, 'tg_caption', 240);
  if (caption) parts.push(`caption ${caption}`);

  return parts.length > 1 ? parts.join(' | ') : null;
}

function renderSlackContext(meta: Metadata): string | null {
  const parts = ['Slack'];
  const channelType = metadataString(meta, 'slack_channel_type');
  if (channelType) parts.push(channelType === 'im' ? 'DM' : channelType);

  const sender =
    metadataString(meta, 'slack_sender_name') ?? metadataString(meta, 'slack_sender_id');
  if (sender) parts.push(`sender ${sender}`);

  const channel =
    metadataString(meta, 'slack_channel_name') ?? metadataString(meta, 'slack_channel_id');
  if (channel && channelType !== 'im') parts.push(`conversation ${channel}`);

  const threadTs = metadataString(meta, 'slack_thread_ts');
  const messageTs = metadataString(meta, 'slack_message_ts');
  if (threadTs && threadTs !== messageTs) parts.push(`thread ${threadTs}`);

  const attachments = meta.attachments;
  if (Array.isArray(attachments) && attachments.length > 0) {
    const names = attachments
      .map((a) =>
        a && typeof a === 'object'
          ? (metadataString(a as Metadata, 'name') ?? metadataString(a as Metadata, 'id'))
          : null,
      )
      .filter((v): v is string => Boolean(v))
      .slice(0, 5);
    if (names.length > 0) parts.push(`attachments ${names.join(', ')}`);
  }

  return parts.length > 1 ? parts.join(' | ') : null;
}

/**
 * Render source metadata that changes the meaning of a raw event into the text
 * sent to extraction and embedding. `content_text` remains the exact captured
 * body; this helper only enriches the model-facing view.
 */
export function renderRawEventForAi(input: RawEventForAiInput): string | null {
  const body = input.contentText?.trim();
  if (!body) return null;

  const meta = metadataObject(input.sourceMetadata);
  const context =
    input.source === 'telegram'
      ? renderTelegramContext(meta)
      : input.source === 'slack'
        ? renderSlackContext(meta)
        : null;
  if (!context) return body;

  return `Source context: ${context}\n\nMessage:\n${body}`;
}
