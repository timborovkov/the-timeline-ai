export type ConversationSurface = 'telegram' | 'slack' | (string & {});

export interface DirectConversationIdentity {
  surface: ConversationSurface;
  externalConversationKey: string;
  externalUserKey: string;
  teamId: string;
  userId: string;
  userName: string;
}

export interface DirectAgentTurnRequest extends DirectConversationIdentity {
  externalEventId: string;
  externalMessageId: string;
  question: string;
}

export interface ConversationDeliveryAdapter {
  acknowledgeAgentRequest(): Promise<void>;
  acknowledgeCapture(): Promise<void>;
  startProgress(): Promise<() => void>;
  deliverAnswer(text: string): Promise<void>;
  deliverFailure(text: string): Promise<void>;
}

export const CONVERSATION_AGENT_TIMEOUT_MESSAGE =
  'I couldn’t finish that within 90 seconds. Please try again, or start a new conversation.';
export const CONVERSATION_AGENT_FAILURE_MESSAGE =
  'I hit an error before I could answer. Please try again.';
export const CONVERSATION_AGENT_BUSY_MESSAGE =
  'I’m still answering your previous message. Please wait for that reply, then try again.';

export const DIRECT_CONVERSATION_HISTORY_MESSAGE_LIMIT = 20;
export const DIRECT_CONVERSATION_HISTORY_CHARACTER_LIMIT = 30_000;
export const DIRECT_CONVERSATION_RATE_LIMIT_PER_MINUTE = 10;
export const DIRECT_CONVERSATION_TIMEOUT_MS = 90_000;
