import { type ChatContextRef, parseChatContextTrail } from '@timeline/shared/chat-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MOMENT_ID_RE = /^moment:[a-z0-9:._/-]{1,180}$/i;

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
  meetingId?: string;
  timelineEventId?: string;
  timelineMomentId?: string;
}

export interface ChatHandoff {
  prompt?: string;
  createdAt: number;
  context?: ChatHandoffContext;
  pinnedEntityId?: string;
  pinnedEntityName?: string;
  contextTrail?: ChatContextRef[];
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
    const contextTrail = parseChatContextTrail(parsed.contextTrail);
    const context = parseHandoffContext(parsed.context);
    const pinnedEntityId =
      typeof parsed.pinnedEntityId === 'string' && UUID_RE.test(parsed.pinnedEntityId)
        ? parsed.pinnedEntityId
        : undefined;
    const pinnedEntityName =
      typeof parsed.pinnedEntityName === 'string'
        ? parsed.pinnedEntityName.trim().slice(0, 80)
        : '';
    if (parsed.prompt === undefined && !context && !pinnedEntityId && contextTrail.length === 0) {
      return null;
    }
    return {
      createdAt: parsed.createdAt,
      ...(parsed.prompt === undefined ? {} : { prompt: parsed.prompt.trim() }),
      ...(context ? { context } : {}),
      ...(pinnedEntityId ? { pinnedEntityId } : {}),
      ...(pinnedEntityName ? { pinnedEntityName } : {}),
      ...(contextTrail.length > 0 ? { contextTrail } : {}),
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

function optionalUuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_RE.test(value) ? value : undefined;
}

function parseHandoffContext(value: unknown): ChatHandoffContext | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.pathname !== 'string' || typeof raw.routeKind !== 'string') return undefined;
  const pathname = raw.pathname.trim().slice(0, 240);
  const routeKind = raw.routeKind.trim().slice(0, 80);
  if (!pathname || !routeKind) return undefined;
  const context: ChatHandoffContext = { pathname, routeKind };
  if (raw.search && typeof raw.search === 'object' && !Array.isArray(raw.search)) {
    const search: Record<string, string> = {};
    for (const [key, entry] of Object.entries(raw.search as Record<string, unknown>)) {
      if (typeof entry === 'string' && key.length <= 80 && entry.length <= 240) {
        search[key] = entry;
      }
    }
    if (Object.keys(search).length > 0) context.search = search;
  }
  const objectId = optionalUuid(raw.objectId);
  const boardId = optionalUuid(raw.boardId);
  const boardItemId = optionalUuid(raw.boardItemId);
  const documentId = optionalUuid(raw.documentId);
  const taskId = optionalUuid(raw.taskId);
  const meetingId = optionalUuid(raw.meetingId);
  const calendarEventId = optionalUuid(raw.calendarEventId);
  const timelineEventId = optionalUuid(raw.timelineEventId);
  if (objectId) context.objectId = objectId;
  if (boardId) context.boardId = boardId;
  if (boardItemId) context.boardItemId = boardItemId;
  if (documentId) context.documentId = documentId;
  if (taskId) context.taskId = taskId;
  if (meetingId) context.meetingId = meetingId;
  if (calendarEventId) context.calendarEventId = calendarEventId;
  if (timelineEventId) context.timelineEventId = timelineEventId;
  if (typeof raw.calendarDate === 'string' && raw.calendarDate.trim()) {
    context.calendarDate = raw.calendarDate.trim().slice(0, 40);
  }
  if (typeof raw.calendarView === 'string' && raw.calendarView.trim()) {
    context.calendarView = raw.calendarView.trim().slice(0, 40);
  }
  if (typeof raw.timelineMomentId === 'string' && MOMENT_ID_RE.test(raw.timelineMomentId)) {
    context.timelineMomentId = raw.timelineMomentId;
  }
  return context;
}
