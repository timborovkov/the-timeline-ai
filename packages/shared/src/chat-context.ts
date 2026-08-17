export const CHAT_CONTEXT_TRAIL_MAX = 8;
export const CHAT_CONTEXT_LABEL_MAX = 80;
export const CHAT_CONTEXT_HREF_MAX = 240;

export const CHAT_CONTEXT_KINDS = [
  'object',
  'document',
  'board',
  'board-item',
  'task',
  'calendar-event',
  'timeline-event',
  'timeline-moment',
  'meeting',
  'page',
] as const;

export type ChatContextKind = (typeof CHAT_CONTEXT_KINDS)[number];

export interface ChatContextRef {
  kind: ChatContextKind;
  href: string;
  label: string;
  objectId?: string;
  documentId?: string;
  boardId?: string;
  boardItemId?: string;
  taskId?: string;
  calendarEventId?: string;
  timelineEventId?: string;
  timelineMomentId?: string;
  meetingId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MOMENT_ID_RE = /^moment:[a-z0-9:._/-]{1,180}$/i;

function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function optionalUuid(value: unknown): string | undefined {
  return typeof value === 'string' && isUuid(value) ? value : undefined;
}

function optionalMomentId(value: unknown): string | undefined {
  return typeof value === 'string' && MOMENT_ID_RE.test(value) ? value : undefined;
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isChatContextKind(value: unknown): value is ChatContextKind {
  return typeof value === 'string' && (CHAT_CONTEXT_KINDS as readonly string[]).includes(value);
}

export function chatContextKey(ref: ChatContextRef): string {
  const id =
    ref.objectId ??
    ref.documentId ??
    ref.boardItemId ??
    ref.taskId ??
    ref.calendarEventId ??
    ref.timelineEventId ??
    ref.timelineMomentId ??
    ref.meetingId ??
    ref.boardId ??
    ref.href;
  return `${ref.kind}:${id}`;
}

export function parseChatContextRef(value: unknown): ChatContextRef | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!isChatContextKind(raw.kind)) return null;
  if (typeof raw.href !== 'string' || typeof raw.label !== 'string') return null;
  const href = clip(raw.href, CHAT_CONTEXT_HREF_MAX);
  const label = clip(raw.label, CHAT_CONTEXT_LABEL_MAX);
  if (!href.startsWith('/app') || !label) return null;

  const ref: ChatContextRef = { kind: raw.kind, href, label };
  const objectId = optionalUuid(raw.objectId);
  const documentId = optionalUuid(raw.documentId);
  const boardId = optionalUuid(raw.boardId);
  const boardItemId = optionalUuid(raw.boardItemId);
  const taskId = optionalUuid(raw.taskId);
  const calendarEventId = optionalUuid(raw.calendarEventId);
  const timelineEventId = optionalUuid(raw.timelineEventId);
  const timelineMomentId = optionalMomentId(raw.timelineMomentId);
  const meetingId = optionalUuid(raw.meetingId);
  if (objectId) ref.objectId = objectId;
  if (documentId) ref.documentId = documentId;
  if (boardId) ref.boardId = boardId;
  if (boardItemId) ref.boardItemId = boardItemId;
  if (taskId) ref.taskId = taskId;
  if (calendarEventId) ref.calendarEventId = calendarEventId;
  if (timelineEventId) ref.timelineEventId = timelineEventId;
  if (timelineMomentId) ref.timelineMomentId = timelineMomentId;
  if (meetingId) ref.meetingId = meetingId;
  return ref;
}

export function parseChatContextTrail(value: unknown): ChatContextRef[] {
  if (!Array.isArray(value)) return [];
  const parsed: ChatContextRef[] = [];
  for (const item of value) {
    const ref = parseChatContextRef(item);
    if (ref) parsed.push(ref);
  }
  return mergeChatContextTrail([], parsed);
}

export function mergeChatContextTrail(
  existing: readonly ChatContextRef[],
  incoming: readonly ChatContextRef[],
  max = CHAT_CONTEXT_TRAIL_MAX,
): ChatContextRef[] {
  const merged: ChatContextRef[] = [];
  const seen = new Set<string>();
  for (const ref of [...incoming, ...existing]) {
    const parsed = parseChatContextRef(ref);
    if (!parsed) continue;
    const key = chatContextKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(parsed);
    if (merged.length >= max) break;
  }
  return merged;
}

export function pinnedObjectIdFromContext(refs: readonly ChatContextRef[]): string | undefined {
  return refs.find((ref) => ref.objectId)?.objectId;
}

function refLines(ref: ChatContextRef, role: 'current' | 'earlier'): string[] {
  const lines = [
    `- ${role}_label: ${ref.label}`,
    `- ${role}_kind: ${ref.kind}`,
    `- ${role}_href: ${ref.href}`,
  ];
  const ids: [string, string | undefined][] = [
    ['object_id', ref.objectId],
    ['document_id', ref.documentId],
    ['board_id', ref.boardId],
    ['board_item_id', ref.boardItemId],
    ['task_id', ref.taskId],
    ['calendar_event_id', ref.calendarEventId],
    ['timeline_event_id', ref.timelineEventId],
    ['timeline_moment_id', ref.timelineMomentId],
    ['meeting_id', ref.meetingId],
  ];
  for (const [key, value] of ids) {
    if (value) lines.push(`- ${role}_${key}: ${value}`);
  }
  return lines;
}

export function chatContextPrompt(trail: readonly ChatContextRef[]): string | null {
  const [current, ...earlier] = trail;
  if (!current) return null;
  const lines = [
    'DASHBOARD CONTEXT:',
    'The user is chatting from the dashboard. The current view has priority for phrases like "this", "here", or "the current page". Earlier views in this conversation are background only.',
    'Do not treat this context as verified data; use tools before making claims.',
    'For how-to, setup, connections, or "where do I…" questions, use search_app_guide and get_app_route, then link the matching dashboard or /help page. Do not invent setup steps that are not in the guide.',
    'CURRENT VIEW (priority):',
    ...refLines(current, 'current'),
  ];
  if (earlier.length > 0) {
    lines.push('EARLIER VIEWS (background):');
    for (const [index, ref] of earlier.entries()) {
      lines.push(`View ${String(index + 2)}:`);
      lines.push(...refLines(ref, 'earlier'));
    }
  }
  return lines.join('\n');
}

export function contextIdsFromTrail(trail: readonly ChatContextRef[]): {
  objectId?: string;
  documentId?: string;
  boardId?: string;
  boardItemId?: string;
  taskId?: string;
  calendarEventId?: string;
  timelineEventId?: string;
  timelineMomentId?: string;
  meetingId?: string;
} {
  const ids: ReturnType<typeof contextIdsFromTrail> = {};
  for (const ref of trail) {
    if (ids.objectId === undefined && ref.objectId) ids.objectId = ref.objectId;
    if (ids.documentId === undefined && ref.documentId) ids.documentId = ref.documentId;
    if (ids.boardId === undefined && ref.boardId) ids.boardId = ref.boardId;
    if (ids.boardItemId === undefined && ref.boardItemId) ids.boardItemId = ref.boardItemId;
    if (ids.taskId === undefined && ref.taskId) ids.taskId = ref.taskId;
    if (ids.calendarEventId === undefined && ref.calendarEventId) {
      ids.calendarEventId = ref.calendarEventId;
    }
    if (ids.timelineEventId === undefined && ref.timelineEventId) {
      ids.timelineEventId = ref.timelineEventId;
    }
    if (ids.timelineMomentId === undefined && ref.timelineMomentId) {
      ids.timelineMomentId = ref.timelineMomentId;
    }
    if (ids.meetingId === undefined && ref.meetingId) ids.meetingId = ref.meetingId;
  }
  return ids;
}
