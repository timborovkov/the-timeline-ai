import type { ChatHandoffContext } from '@/lib/chat-handoff';
import type { ChatContextRef } from '@timeline/shared/chat-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MOMENT_ID_RE = /^moment:[a-z0-9:._/-]{1,180}$/i;

export interface ChatViewOverlay {
  viewKey: string;
  kind: ChatContextRef['kind'];
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

const PAGE_LABELS: Record<string, string> = {
  timeline: 'Timeline',
  work: 'Work',
  objects: 'Objects',
  'objects/new': 'New object',
  'objects/merge': 'Merge objects',
  tasks: 'Tasks',
  boards: 'Boards',
  calendar: 'Calendar',
  documents: 'Documents',
  'documents/captured': 'Captured files',
  meetings: 'Meetings',
  inbox: 'Inbox',
  search: 'Search',
  sources: 'Connections',
  approvals: 'Approvals',
  team: 'Team',
  'team/integrations': 'Integrations',
  'team/slack': 'Slack',
  'team/telegram': 'Telegram',
  'team/mcp-servers': 'MCP servers',
  'team/mcp-share': 'MCP share',
  'team/audit': 'Audit',
  'team/jobs': 'Jobs',
  'team/reconciliation': 'Reconciliation',
  'me/connections': 'Provider accounts',
  'me/mcp-servers': 'Personal MCP',
};

function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function pageLabel(segments: string[]): string {
  const rest = segments.slice(1);
  if (rest.length === 0) return 'Home';
  const exact = PAGE_LABELS[rest.join('/')];
  if (exact) return exact;
  const section = rest[0];
  if (section) {
    const labeled = PAGE_LABELS[section];
    if (labeled) return labeled;
  }
  return rest[0] ?? 'Dashboard';
}

function routeKind(pathname: string, segments: string[]): string {
  if (pathname === '/app') return 'home';
  if (segments[0] !== 'app') return 'dashboard';
  if (segments[1] === 'me') return segments[2] ?? 'me';
  if (segments[1] === 'team') return segments[2] ?? 'team';
  return segments[1] ?? 'dashboard';
}

function hrefWithSearch(pathname: string, search: URLSearchParams, keys: string[]): string {
  const next = new URLSearchParams();
  for (const key of keys) {
    const value = search.get(key);
    if (value) next.set(key, value);
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function buildChatView(input: {
  pathname: string | null;
  searchParams: URLSearchParams;
  overlay?: ChatViewOverlay | null;
}): { current: ChatContextRef; dashboardContext: ChatHandoffContext } {
  const pathname = input.pathname ?? '/app';
  const segments = pathname.split('/').filter(Boolean);
  const search: Record<string, string> = {};
  for (const [key, value] of input.searchParams.entries()) {
    if (value) search[key] = value;
  }
  const dashboardContext: ChatHandoffContext = {
    pathname,
    routeKind: routeKind(pathname, segments),
  };
  if (Object.keys(search).length > 0) dashboardContext.search = search;

  const objectId =
    input.overlay?.objectId ??
    (segments[1] === 'objects' && isUuid(segments[2]) ? segments[2] : undefined);
  const documentId =
    input.overlay?.documentId ??
    (segments[1] === 'documents' && isUuid(segments[2]) ? segments[2] : undefined);
  const boardId =
    input.overlay?.boardId ??
    (segments[1] === 'boards' && isUuid(segments[2]) ? segments[2] : undefined);
  const boardItemId = input.overlay?.boardItemId ?? input.searchParams.get('item') ?? undefined;
  const taskId =
    input.overlay?.taskId ??
    input.searchParams.get('task') ??
    (segments[1] === 'tasks' ? input.searchParams.get('id') : null) ??
    undefined;
  const calendarEventId =
    input.overlay?.calendarEventId ?? input.searchParams.get('event') ?? undefined;
  const meetingId =
    input.overlay?.meetingId ??
    (segments[1] === 'meetings' && isUuid(segments[2]) ? segments[2] : undefined);
  const timelineEventId =
    input.overlay?.timelineEventId ??
    (segments[1] === 'timeline' ? (input.searchParams.get('event') ?? undefined) : undefined);
  const timelineMomentId =
    input.overlay?.timelineMomentId ??
    (segments[1] === 'timeline' ? (input.searchParams.get('moment') ?? undefined) : undefined);

  if (isUuid(objectId)) dashboardContext.objectId = objectId;
  if (isUuid(documentId)) dashboardContext.documentId = documentId;
  if (isUuid(boardId)) dashboardContext.boardId = boardId;
  if (isUuid(boardItemId)) dashboardContext.boardItemId = boardItemId;
  if (isUuid(taskId)) dashboardContext.taskId = taskId;
  if (segments[1] === 'calendar') {
    const date = input.searchParams.get('date');
    const view = input.searchParams.get('view');
    if (date) dashboardContext.calendarDate = date;
    if (view) dashboardContext.calendarView = view;
    if (isUuid(calendarEventId)) dashboardContext.calendarEventId = calendarEventId;
  }
  if (isUuid(meetingId)) dashboardContext.meetingId = meetingId;
  if (isUuid(timelineEventId)) dashboardContext.timelineEventId = timelineEventId;
  if (timelineMomentId && MOMENT_ID_RE.test(timelineMomentId)) {
    dashboardContext.timelineMomentId = timelineMomentId;
  }

  if (input.overlay) {
    return {
      current: {
        kind: input.overlay.kind,
        href: input.overlay.href,
        label: input.overlay.label,
        ...(isUuid(objectId) ? { objectId } : {}),
        ...(isUuid(documentId) ? { documentId } : {}),
        ...(isUuid(boardId) ? { boardId } : {}),
        ...(isUuid(boardItemId) ? { boardItemId } : {}),
        ...(isUuid(taskId) ? { taskId } : {}),
        ...(isUuid(calendarEventId) && segments[1] === 'calendar' ? { calendarEventId } : {}),
        ...(isUuid(timelineEventId) ? { timelineEventId } : {}),
        ...(timelineMomentId && MOMENT_ID_RE.test(timelineMomentId) ? { timelineMomentId } : {}),
        ...(isUuid(meetingId) ? { meetingId } : {}),
      },
      dashboardContext,
    };
  }

  if (isUuid(objectId) && isUuid(boardId) && isUuid(boardItemId)) {
    return {
      current: {
        kind: 'board-item',
        href: hrefWithSearch(pathname, input.searchParams, ['item']),
        label: 'Board card',
        objectId,
        boardId,
        boardItemId,
      },
      dashboardContext,
    };
  }
  if (isUuid(objectId)) {
    return {
      current: {
        kind: 'object',
        href: `/app/objects/${objectId}`,
        label: 'Object',
        objectId,
      },
      dashboardContext,
    };
  }
  if (isUuid(documentId)) {
    return {
      current: {
        kind: 'document',
        href: `/app/documents/${documentId}`,
        label: 'Document',
        documentId,
      },
      dashboardContext,
    };
  }
  if (isUuid(meetingId)) {
    return {
      current: {
        kind: 'meeting',
        href: `/app/meetings/${meetingId}`,
        label: 'Meeting',
        meetingId,
      },
      dashboardContext,
    };
  }
  if (isUuid(boardId)) {
    return {
      current: {
        kind: 'board',
        href: `/app/boards/${boardId}`,
        label: 'Board',
        boardId,
        ...(isUuid(boardItemId) ? { boardItemId } : {}),
      },
      dashboardContext,
    };
  }
  if (isUuid(taskId)) {
    return {
      current: {
        kind: 'task',
        href: hrefWithSearch(pathname, input.searchParams, ['task', 'id']),
        label: 'Task',
        taskId,
      },
      dashboardContext,
    };
  }
  if (isUuid(calendarEventId) && segments[1] === 'calendar') {
    return {
      current: {
        kind: 'calendar-event',
        href: hrefWithSearch(pathname, input.searchParams, ['event', 'date', 'view']),
        label: 'Calendar event',
        calendarEventId,
      },
      dashboardContext,
    };
  }
  if (isUuid(timelineEventId)) {
    return {
      current: {
        kind: 'timeline-event',
        href: hrefWithSearch(pathname, input.searchParams, ['event', 'moment']),
        label: 'Timeline event',
        timelineEventId,
        ...(timelineMomentId && MOMENT_ID_RE.test(timelineMomentId) ? { timelineMomentId } : {}),
      },
      dashboardContext,
    };
  }
  if (timelineMomentId && MOMENT_ID_RE.test(timelineMomentId)) {
    return {
      current: {
        kind: 'timeline-moment',
        href: hrefWithSearch(pathname, input.searchParams, ['moment', 'event']),
        label: 'Timeline moment',
        timelineMomentId,
      },
      dashboardContext,
    };
  }

  return {
    current: {
      kind: 'page',
      href: pathname,
      label: pageLabel(segments),
    },
    dashboardContext,
  };
}

export function chatShortcutLabel(): string {
  return '⌘J / Ctrl+J';
}
