import { contextIdsFromTrail, type ChatContextRef } from '@timeline/shared/chat-context';

import type { ToolSet } from 'ai';

/**
 * Dashboard chat sends a subset of native agent tools per turn. Every tool in
 * `buildAgentTools` must appear here except `propose_object_change`, which
 * stays on proposal-only MCP/Telegram agents. `list_team_members` stays in
 * `core` so the model can resolve teammate names even when the user message
 * is only "assign Mikael".
 */
const nativeToolGroups = {
  core: [
    'retrieve_workspace_context',
    'search_timeline_moments',
    'get_timeline_moment',
    'search_timeline',
    'search_object_notes',
    'get_entity',
    'get_event',
    'list_events',
    'list_team_members',
    'resolve_time_context',
  ],
  guide: ['search_app_guide', 'get_app_route'],
  objects: ['search_objects', 'get_object', 'list_objects', 'list_tasks', 'recent_changes'],
  objectMemory: ['list_pending_approvals', 'revise_suggestion', 'suggest_object_memory'],
  suggestions: [
    'list_pending_approvals',
    'revise_suggestion',
    'suggest_task',
    'suggest_object_memory',
    'suggest_calendar_event',
    'propose_calendar_update',
  ],
  boards: ['search_boards'],
  documents: [
    'search_documents_structured',
    'search_documents',
    'get_document',
    'get_document_chunk',
    'list_recent_document_changes',
  ],
  calendar: ['list_calendar_events', 'get_calendar_event'],
  approvals: ['list_pending_approvals', 'revise_suggestion'],
  actions: [
    'revise_suggestion',
    'execute_object_create',
    'execute_object_update',
    'execute_object_archive',
    'execute_object_merge',
    'execute_board_add_item',
    'execute_board_update_item',
    'execute_board_remove_item',
    'execute_calendar_create',
    'execute_calendar_update',
    'execute_calendar_cancel',
    'suggest_task',
    'suggest_object_memory',
    'suggest_calendar_event',
    'propose_calendar_update',
  ],
  integrations: ['list_integrations', 'search_integration_events', 'get_integration_resource'],
  pins: ['list_pins', 'pin_item', 'unpin_item', 'move_pin'],
} as const;

type NativeToolGroup = keyof typeof nativeToolGroups;

interface ChatToolDashboardContext {
  pathname?: string;
  routeKind?: string;
  objectId?: string;
  taskId?: string;
  boardId?: string;
  boardItemId?: string;
  documentId?: string;
  calendarEventId?: string;
  calendarDate?: string;
  meetingId?: string;
}

interface ToolSelection {
  groups: NativeToolGroup[];
  includeMcp: boolean;
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function selectAgentToolGroups(input: {
  question: string;
  dashboardContext?: ChatToolDashboardContext | undefined;
  contextTrail?: ChatContextRef[];
}): ToolSelection {
  const trailIds = contextIdsFromTrail(input.contextTrail ?? []);
  const objectId = input.dashboardContext?.objectId ?? trailIds.objectId;
  const taskId = input.dashboardContext?.taskId ?? trailIds.taskId;
  const boardId = input.dashboardContext?.boardId ?? trailIds.boardId;
  const boardItemId = input.dashboardContext?.boardItemId ?? trailIds.boardItemId;
  const documentId = input.dashboardContext?.documentId ?? trailIds.documentId;
  const calendarEventId = input.dashboardContext?.calendarEventId ?? trailIds.calendarEventId;
  const meetingId = input.dashboardContext?.meetingId ?? trailIds.meetingId;
  const text = `${input.question} ${input.dashboardContext?.routeKind ?? ''} ${
    input.dashboardContext?.pathname ?? ''
  }`.toLowerCase();
  const groups = new Set<NativeToolGroup>(['core', 'guide']);
  const hasObjectContext = Boolean(objectId ?? taskId ?? boardItemId);
  const onSetupSurface = matchesAny(text, [
    /\b(team|sources|connections|integrations|slack|telegram|mcp|settings)\b/,
  ]);
  const hasObjectMemoryIntent = matchesAny(text, [
    /\b(remember|memory|note|alias|aka|also known as|typo|rename|relationship|related|owner|owns|assignee|assign|assigned|reassign|reassigned|responsible|status|stage|priority|due)\b/,
    /\b(calls? this|known as|same as|belongs to|works? with|reports? to)\b/,
    /\b(promises?|promised|commits?|committed|commitment|responsibility)\b/,
  ]);
  const hasContrastiveCorrection = hasObjectMemoryIntent && /\bnot\b/.test(text);

  if (
    objectId ||
    taskId ||
    matchesAny(text, [
      /\b(object|person|company|project|topic|deal|vendor|incident|decision|hiring|task|todo|follow[- ]?up|status|stage|archive|merge)\b/,
    ])
  ) {
    groups.add('objects');
  }

  if (hasObjectContext || hasObjectMemoryIntent) {
    groups.add('objects');
    groups.add('objectMemory');
  }

  if (boardId || boardItemId || matchesAny(text, [/\b(board|kanban|lane|card|pipeline)\b/])) {
    groups.add('boards');
  }

  if (documentId || matchesAny(text, [/\b(document|doc|file|pdf|contract|policy|drive|chunk)\b/])) {
    groups.add('documents');
  }

  if (
    calendarEventId ||
    meetingId ||
    input.dashboardContext?.calendarDate ||
    matchesAny(text, [
      /\b(calendar|schedule|meeting|today|tomorrow|yesterday|week|month|date|time)\b/,
    ])
  ) {
    groups.add('calendar');
  }

  if (
    hasContrastiveCorrection ||
    matchesAny(text, [
      /\b(approval|pending|proposal|suggestion|queued|review)\b/,
      /\b(wrong|incorrect|correct this|fix this|actually|instead)\b/,
      /\bit(?:'s| is)\s+not\b/,
    ])
  ) {
    groups.add('approvals');
  }

  if (
    hasContrastiveCorrection ||
    matchesAny(text, [
      /\b(create|add|update|change|edit|set|move|cancel|delete|remove|archive|merge|schedule|reschedule|approve|correct|fix|wrong|incorrect|actually|instead|do it|mark|done|complete|finish|close|assign|assigned|reassign|reassigned)\b/,
      /\bit(?:'s| is)\s+not\b/,
    ])
  ) {
    groups.add('actions');
    groups.add('objects');
    if (hasObjectMemoryIntent) groups.add('objectMemory');
    if (boardId || boardItemId || matchesAny(text, [/\b(board|kanban|lane|card|pipeline)\b/])) {
      groups.add('boards');
    }
  }

  if (
    hasObjectMemoryIntent ||
    matchesAny(text, [/\b(remember|suggest|propose|proposal|queue|track|follow[- ]?up)\b/])
  ) {
    groups.add('suggestions');
  }

  if (hasObjectContext && matchesAny(text, [/\b(mark|done|complete|close|finish)\b/])) {
    groups.add('actions');
    groups.add('objects');
  }

  if (
    onSetupSurface ||
    matchesAny(text, [
      /\b(integration|source|slack|telegram|tg|github|linear|drive|email|connected|external|mcp|invite|setup)\b/,
    ])
  ) {
    groups.add('integrations');
  }

  if (matchesAny(text, [/\b(pin|pinned|unpin|pinned work)\b/])) groups.add('pins');

  const includeMcp = matchesAny(text, [
    /\b(external tool|connected tool|mcp|github|linear|drive|jira|notion|slack|telegram|source)\b/,
  ]);

  return { groups: [...groups], includeMcp };
}

export function hasExplicitPinMutationIntent(question: string): boolean {
  return matchesAny(question.toLowerCase(), [
    /\b(pin|unpin)\s+(this|that|the|my|an?\s+)?\b/,
    /\b(add|save)\b.{0,40}\b(to|as)\s+(my\s+)?pins?\b/,
    /\b(remove|delete)\b.{0,40}\bfrom\s+(my\s+)?pins?\b/,
    /\b(move|reorder)\b.{0,40}\bpins?\b/,
  ]);
}

export function filterToolSet(tools: ToolSet, names: readonly string[]): ToolSet {
  const selected: ToolSet = {};
  for (const name of names) {
    const tool = tools[name];
    if (tool) selected[name] = tool;
  }
  return selected;
}

export function selectedNativeToolNames(groups: NativeToolGroup[]): string[] {
  return [...new Set(groups.flatMap((group) => nativeToolGroups[group]))];
}

export function omittedNativeToolGroups(groups: NativeToolGroup[]): NativeToolGroup[] {
  const selected = new Set(groups);
  return (Object.keys(nativeToolGroups) as NativeToolGroup[]).filter(
    (group) => !selected.has(group),
  );
}
