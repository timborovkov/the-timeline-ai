export const CHAT_HANDOFF_MAX_AGE_MS = 5 * 60 * 1000;
export const CHAT_HANDOFF_MAX_PROMPT_LENGTH = 4_000;

export interface ChatHandoffContext {
  pathname: string;
  routeKind: string;
  search?: Record<string, string>;
  objectId?: string;
  boardId?: string;
  boardItemId?: string;
  calendarDate?: string;
  calendarView?: string;
  calendarEventId?: string;
  documentId?: string;
  taskId?: string;
}

export interface ChatHandoff {
  prompt?: string;
  createdAt: number;
  context?: ChatHandoffContext;
  pinnedEntityId?: string;
  pinnedEntityName?: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export function chatHandoffKey(teamId: string): string {
  return `timeline:chat-handoff:${teamId}`;
}

export function validateChatHandoffPrompt(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) return 'Enter a question before opening Ask.';
  if (trimmed.length > CHAT_HANDOFF_MAX_PROMPT_LENGTH) {
    return `Keep your question under ${CHAT_HANDOFF_MAX_PROMPT_LENGTH.toLocaleString()} characters.`;
  }
  return null;
}

export function storeChatHandoff(
  storage: StorageLike,
  teamId: string,
  prompt: string,
  now = Date.now(),
): ChatHandoff {
  const error = validateChatHandoffPrompt(prompt);
  if (error) throw new Error(error);
  const handoff = { prompt: prompt.trim(), createdAt: now } satisfies ChatHandoff;
  storage.setItem(chatHandoffKey(teamId), JSON.stringify(handoff));
  return handoff;
}

export function storeChatContextHandoff(
  storage: StorageLike,
  teamId: string,
  input: Omit<ChatHandoff, 'createdAt' | 'prompt'>,
  now = Date.now(),
): ChatHandoff {
  const handoff = { ...input, createdAt: now } satisfies ChatHandoff;
  storage.setItem(chatHandoffKey(teamId), JSON.stringify(handoff));
  return handoff;
}

export function consumeChatHandoffEntry(
  storage: StorageLike,
  teamId: string,
  now = Date.now(),
): ChatHandoff | null {
  const key = chatHandoffKey(teamId);
  const serialized = storage.getItem(key);
  storage.removeItem(key);
  if (!serialized) return null;

  try {
    const parsed = JSON.parse(serialized) as Partial<ChatHandoff>;
    if (typeof parsed.createdAt !== 'number') return null;
    if (now - parsed.createdAt > CHAT_HANDOFF_MAX_AGE_MS || parsed.createdAt > now + 60_000) {
      return null;
    }
    if (parsed.prompt !== undefined && validateChatHandoffPrompt(parsed.prompt)) return null;
    if (parsed.prompt === undefined && !parsed.context && !parsed.pinnedEntityId) return null;
    return {
      createdAt: parsed.createdAt,
      ...(parsed.prompt === undefined ? {} : { prompt: parsed.prompt.trim() }),
      ...(parsed.context ? { context: parsed.context } : {}),
      ...(parsed.pinnedEntityId ? { pinnedEntityId: parsed.pinnedEntityId } : {}),
      ...(parsed.pinnedEntityName ? { pinnedEntityName: parsed.pinnedEntityName } : {}),
    };
  } catch {
    return null;
  }
}

export function consumeChatHandoff(
  storage: StorageLike,
  teamId: string,
  now = Date.now(),
): string | null {
  return consumeChatHandoffEntry(storage, teamId, now)?.prompt ?? null;
}
