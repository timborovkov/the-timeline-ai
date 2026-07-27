import { type ConversationDeliveryAdapter } from '#src/conversation-surfaces/types.js';
import { HttpTelegramApi, type TelegramApi } from '#src/telegram/api.js';

function telegramConversationParts(
  externalConversationKey: string,
  externalMessageId: string,
): { chatId: number; messageId: number } {
  const match = /^dm:(-?\d+)$/.exec(externalConversationKey);
  const chatId = match ? Number(match[1]) : Number.NaN;
  const messageId = Number(externalMessageId);
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(messageId)) {
    throw new Error('Invalid Telegram direct-conversation delivery key');
  }
  return { chatId, messageId };
}

export function createTelegramConversationDeliveryAdapter(input: {
  api: TelegramApi;
  externalConversationKey: string;
  externalMessageId: string;
}): ConversationDeliveryAdapter {
  const { chatId, messageId } = telegramConversationParts(
    input.externalConversationKey,
    input.externalMessageId,
  );
  const react = (emoji: string): Promise<void> =>
    input.api
      .setMessageReaction({ chat_id: chatId, message_id: messageId, emoji })
      .catch(() => undefined);
  const send = (text: string): Promise<void> =>
    input.api.sendMessage({
      chat_id: chatId,
      reply_to_message_id: messageId,
      text,
    });
  return {
    acknowledgeAgentRequest: () => react('🤔'),
    acknowledgeCapture: () => react('👀'),
    async startProgress() {
      let stopped = false;
      await input.api.sendChatAction({ chat_id: chatId, action: 'typing' }).catch(() => undefined);
      const sendTyping = (): void => {
        if (stopped) return;
        void input.api.sendChatAction({ chat_id: chatId, action: 'typing' }).catch(() => undefined);
      };
      const timer = setInterval(sendTyping, 4_000);
      timer.unref();
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },
    deliverAnswer: send,
    deliverFailure: send,
  };
}

export function createTelegramWorkerDeliveryAdapter(input: {
  token: string;
  externalConversationKey: string;
  externalMessageId: string;
}): ConversationDeliveryAdapter {
  return createTelegramConversationDeliveryAdapter({
    api: new HttpTelegramApi(input.token),
    externalConversationKey: input.externalConversationKey,
    externalMessageId: input.externalMessageId,
  });
}
