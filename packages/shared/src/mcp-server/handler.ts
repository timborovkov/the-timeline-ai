import { type Db } from '@timeline/db';
import { z } from 'zod';

import type * as boards from '#src/boards/index.js';

import { retrieveWorkspaceContext } from '#src/agent/retrieval.js';
import { artifactRefCitation } from '#src/citation.js';
import { childLogger } from '#src/logger.js';
import { resolveBearerKey } from '#src/mcp-server/keys.js';
import * as objects from '#src/objects/index.js';
import { withTeam } from '#src/team-scope.js';
import { resolveTimePhrase, workspaceTimeContext } from '#src/time/index.js';

const log = childLogger('mcp-server');

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: number | string | null;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

const PROTOCOL_VERSION = '2024-11-05';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';

const objectTypeSchema = z.enum(
  objects.OBJECT_TYPES as [objects.ObjectType, ...objects.ObjectType[]],
);

const retrieveWorkspaceContextInput = z.object({
  query: z.string().trim().min(1).max(500),
  recipe: z
    .enum([
      'auto',
      'object_profile',
      'timeline_evidence',
      'task_status',
      'calendar',
      'board_state',
      'document_knowledge',
      'product_guide',
    ])
    .optional(),
  objectId: z.string().regex(UUID_RE).optional(),
  limit: z.number().int().min(1).max(10).optional(),
  includeDocuments: z.boolean().optional(),
  includeCalendar: z.boolean().optional(),
});

const searchObjectsInput = z.object({
  query: z.string().trim().min(1).max(300),
  type: z.union([objectTypeSchema, z.array(objectTypeSchema).max(10)]).optional(),
  status: z
    .union([z.string().trim().max(40), z.array(z.string().trim().max(40)).max(20)])
    .optional(),
  stage: z
    .union([z.string().trim().max(40), z.array(z.string().trim().max(40)).max(20)])
    .optional(),
  ownerUserId: z.string().regex(UUID_RE).nullable().optional(),
  assigneeUserId: z.string().regex(UUID_RE).nullable().optional(),
  dueAfter: z.iso.datetime().optional(),
  dueBefore: z.iso.datetime().optional(),
  archived: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const searchBoardsInput = z.object({
  query: z.string().trim().max(300).optional(),
  boardId: z.string().regex(UUID_RE).optional(),
  templateKind: z.enum(['pipeline', 'task_board', 'catalog', 'custom']).optional(),
  pinned: z.boolean().optional(),
  objectId: z.string().regex(UUID_RE).optional(),
  laneId: z.string().regex(UUID_RE).optional(),
  responsibleUserId: z.string().regex(UUID_RE).nullable().optional(),
  dueAfter: z.iso.datetime().optional(),
  dueBefore: z.iso.datetime().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  itemText: z.string().trim().min(1).max(300).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const searchDocumentsStructuredInput = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  folderId: z.string().regex(UUID_RE).nullable().optional(),
  fileKind: z.enum(['document', 'captured']).optional(),
  includeDeleted: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const listDocumentChangesInput = z.object({
  since: z.iso.datetime().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const listCalendarEventsInput = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const searchIntegrationEventsInput = z.object({
  query: z.string().trim().min(1).max(500),
  provider: z.enum(['google_drive', 'linear', 'github', 'monday', 'slack', 'sentry']).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

function withMcpScope(db: Db, teamId: string) {
  // The bearer key represents the team, not a specific user; pass a
  // null-UUID as the actor so visibility checks treat the request as a
  // non-author. Private and specific-user data stays invisible because
  // the pseudo-user cannot match an author or visibility target.
  return withTeam(db, teamId, PSEUDO_USER, { skipMembershipCheck: true });
}

function textMatches(value: string | null | undefined, query: string | undefined): boolean {
  if (!query) return true;
  return (value ?? '').toLowerCase().includes(query.toLowerCase());
}

function dateInRange(value: Date | null | undefined, from?: string, to?: string): boolean {
  if (!value) return !from && !to;
  if (from && value < new Date(from)) return false;
  if (to && value >= new Date(to)) return false;
  return true;
}

function serializeObjectRow(row: objects.ObjectRow): Record<string, unknown> {
  return {
    id: row.id,
    citation: artifactRefCitation({
      kind: row.type === 'task' || row.type === 'follow_up' ? 'task' : 'object',
      id: row.id,
    }),
    name: row.canonicalName,
    type: row.type,
    status: row.status,
    stage: row.stage,
    priority: row.priority,
    owner_user_id: row.ownerUserId,
    assignee_user_id: row.assigneeUserId,
    due_at: row.dueAt?.toISOString() ?? null,
    updated_at: row.updatedAt.toISOString(),
    archived: row.archivedAt !== null,
    aliases: row.aliases.slice(0, 20),
  };
}

function serializeBoardRow(row: boards.BoardRow): Record<string, unknown> {
  return {
    id: row.id,
    citation: artifactRefCitation({ kind: 'board', id: row.id }),
    name: row.name,
    purpose: row.purpose,
    template_kind: row.templateKind,
    recommended_object_types: row.recommendedObjectTypes,
    item_count: row.itemCount,
    due_soon_count: row.dueSoonCount,
    overdue_count: row.overdueCount,
    pinned: row.pinned,
    updated_at: row.updatedAt.toISOString(),
  };
}

function serializeBoardItemRow(row: boards.BoardItemRow): Record<string, unknown> {
  return {
    id: row.id,
    citation: artifactRefCitation({ kind: 'board_item', id: row.id }),
    board_id: row.boardId,
    object_id: row.entityId,
    object_citation: artifactRefCitation({
      kind: row.object.type === 'task' || row.object.type === 'follow_up' ? 'task' : 'object',
      id: row.object.id,
    }),
    object_name: row.object.canonicalName,
    object_type: row.object.type,
    lane_id: row.laneId,
    responsible_user_id: row.responsibleUserId,
    due_at: row.dueAt?.toISOString() ?? null,
    priority: row.priority,
    next_step: row.nextStep,
    notes: row.notes,
    updated_at: row.updatedAt.toISOString(),
  };
}

// Tool descriptors served by tools/list. We re-use the same shape the
// agent-internal tools use, but with `timeline.` prefixes so external
// agents can recognise them without colliding with their host's tools.
// Schemas are deliberately permissive (passthrough) to keep this
// handler small — every tool re-validates its own arguments below.
const TOOLS = [
  {
    name: 'timeline.search_events',
    description:
      'Semantic search across the team timeline. Returns ranked events with event_id (cite as [ev:<id>]).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 500 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'timeline.get_event',
    description: 'Fetch one event by id (returns content, source, occurred_at, source_metadata).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'timeline.list_events',
    description: 'Recent events for the team, optionally filtered by source and time range.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
        source: {
          type: 'string',
          // Mirrors the `event_source` pg enum and the runtime allow-list
          // in callTool below. Strict MCP clients that validate args
          // against this schema couldn't request integration / document
          // / meeting rows otherwise.
          enum: [
            'web',
            'telegram',
            'email',
            'system',
            'document',
            'meeting',
            'integration',
            'calendar',
            'slack',
          ],
        },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'timeline.get_entity',
    description:
      'Look up an entity (person, company, project, topic) by exact id or canonical name.',
    inputSchema: {
      type: 'object',
      properties: { idOrName: { type: 'string', minLength: 1, maxLength: 200 } },
      required: ['idOrName'],
    },
  },
  {
    name: 'timeline.search_documents',
    description:
      'Semantic search across the team document drive (Phase 9). Returns document chunks with citations.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 500 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'timeline.retrieve_workspace_context',
    description:
      'Broad read-only retrieval across objects, notes, timeline events, tasks, boards, calendar, documents, and route guides. Use first for open-ended workspace questions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 500 },
        recipe: {
          type: 'string',
          enum: [
            'auto',
            'object_profile',
            'timeline_evidence',
            'task_status',
            'calendar',
            'board_state',
            'document_knowledge',
            'product_guide',
          ],
        },
        objectId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
        includeDocuments: { type: 'boolean' },
        includeCalendar: { type: 'boolean' },
      },
      required: ['query'],
    },
  },
  {
    name: 'timeline.get_object',
    description:
      'Look up one workspace object or task by UUID or canonical name. Returns status, owner, due date, notes, changes, and open child tasks.',
    inputSchema: {
      type: 'object',
      properties: { idOrName: { type: 'string', minLength: 1, maxLength: 200 } },
      required: ['idOrName'],
    },
  },
  {
    name: 'timeline.search_objects',
    description:
      'Structured search over workspace objects/tasks by name, type, status, stage, owner, assignee, due range, archived state, and limit.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 300 },
        type: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        status: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        stage: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        ownerUserId: { type: ['string', 'null'] },
        assigneeUserId: { type: ['string', 'null'] },
        dueAfter: { type: 'string', format: 'date-time' },
        dueBefore: { type: 'string', format: 'date-time' },
        archived: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['query'],
    },
  },
  {
    name: 'timeline.list_objects',
    description: 'List workspace objects with optional type/status/stage/owner/archive filters.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        status: { type: 'string' },
        stage: { type: 'string' },
        ownerUserId: { type: 'string' },
        archived: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'timeline.list_tasks',
    description:
      'Convenience over list_objects for active tasks. Defaults to suggested/open/todo/doing/blocked unless status is provided.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        ownerUserId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'timeline.search_boards',
    description:
      'Structured search over boards and board items by board, text, template, pinned state, object membership, lane, responsible user, due range, priority, and item text.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 300 },
        boardId: { type: 'string' },
        templateKind: { type: 'string', enum: ['pipeline', 'task_board', 'catalog', 'custom'] },
        pinned: { type: 'boolean' },
        objectId: { type: 'string' },
        laneId: { type: 'string' },
        responsibleUserId: { type: ['string', 'null'] },
        dueAfter: { type: 'string', format: 'date-time' },
        dueBefore: { type: 'string', format: 'date-time' },
        priority: { type: 'integer', minimum: 0, maximum: 100 },
        itemText: { type: 'string', minLength: 1, maxLength: 300 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
    },
  },
  {
    name: 'timeline.search_documents_structured',
    description:
      'Structured document search/list by name substring, folder id, file kind, deleted state, and limit. Use for finding document records by metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 300 },
        folderId: { type: ['string', 'null'] },
        fileKind: { type: 'string', enum: ['document', 'captured'] },
        includeDeleted: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'timeline.get_document',
    description:
      'Fetch document metadata, owner, visibility, folder path, current version, and version history by document id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'timeline.get_document_chunk',
    description: 'Fetch full text and metadata for one document chunk by chunk id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'timeline.list_recent_document_changes',
    description:
      'List recent document-drive activity such as uploads, versions, renames, moves, deletes, restores, and visibility changes.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', format: 'date-time' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'timeline.list_calendar_events',
    description:
      'List team-visible calendar events in a date range. Defaults from now when no range is supplied.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'timeline.get_calendar_event',
    description: 'Fetch one team-visible calendar event by UUID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'timeline.resolve_time_context',
    description:
      'Resolve workspace-relative time phrases such as today, yesterday, last week, or next Tuesday into exact UTC ranges.',
    inputSchema: {
      type: 'object',
      properties: {
        phrase: { type: 'string', minLength: 1, maxLength: 100 },
        referenceDate: { type: 'string', format: 'date-time' },
      },
    },
  },
  {
    name: 'timeline.list_integrations',
    description:
      'List connected team integrations and custom MCP servers, including provider, display name, enabled state, sync status, and cached tools.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'timeline.search_integration_events',
    description:
      'Semantic search restricted to events synced from connected integrations such as Google Drive, Linear, GitHub, Monday.com, Slack, and Sentry.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 500 },
        provider: {
          type: 'string',
          enum: ['google_drive', 'linear', 'github', 'monday', 'slack', 'sentry'],
        },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'timeline.get_integration_resource',
    description:
      'Look up current state and recent history for a synced external resource by provider and external object id.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['google_drive', 'linear', 'github', 'monday', 'slack', 'sentry'],
        },
        externalObjectId: { type: 'string', minLength: 1, maxLength: 512 },
        historyLimit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['provider', 'externalObjectId'],
    },
  },
];

// Resources surface a discovery view of stable URIs the client can read
// with resources/read — for v1 we expose two collection URIs and a
// pattern URI for individual events.
const RESOURCES = [
  {
    uri: 'timeline://events/recent',
    name: 'Recent events',
    description: '50 most recent raw events visible to this key.',
    mimeType: 'application/json',
  },
  {
    uri: 'timeline://entities',
    name: 'Entities',
    description: 'All entities visible to this key.',
    mimeType: 'application/json',
  },
];

const PROMPTS = [
  {
    name: 'summarize_recent',
    description: 'Summarize what the team has been working on this week.',
  },
  {
    name: 'what_changed',
    description: 'Summarize what changed about a specific entity recently. Args: { name: string }.',
  },
];

interface HandleContext {
  db: Db;
  bearer: string | null;
}

function jsonRpcSuccess(id: number | string | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

interface CallToolArgs {
  query?: unknown;
  limit?: unknown;
  id?: unknown;
  idOrName?: unknown;
  from?: unknown;
  to?: unknown;
  source?: unknown;
}

async function callTool(
  db: Db,
  teamId: string,
  toolName: string,
  args: CallToolArgs,
): Promise<unknown> {
  const scope = withMcpScope(db, teamId);
  switch (toolName) {
    case 'timeline.search_events': {
      const query = typeof args.query === 'string' ? args.query : '';
      const limit = typeof args.limit === 'number' ? args.limit : 10;
      const hits = await scope.timeline.searchEvents({ query, limit });
      return {
        count: hits.length,
        results: hits.map((r) => ({
          event_id: r.eventId,
          occurred_at: r.occurredAt,
          score: r.score,
          source: r.source,
          snippet: r.snippet,
        })),
      };
    }
    case 'timeline.get_event': {
      const id = typeof args.id === 'string' ? args.id : '';
      const ev = await scope.timeline.getEvent(id);
      if (!ev) return { found: false };
      return {
        found: true,
        event: {
          id: ev.id,
          source: ev.source,
          occurred_at: ev.occurredAt,
          content_text: ev.contentText,
          source_metadata: ev.sourceMetadata,
        },
      };
    }
    case 'timeline.list_events': {
      const filters: Parameters<typeof scope.timeline.listEvents>[0] = {};
      if (typeof args.from === 'string') filters.from = new Date(args.from);
      if (typeof args.to === 'string') filters.to = new Date(args.to);
      if (typeof args.limit === 'number') filters.limit = args.limit;
      // Push the source predicate into SQL so `limit` bounds matching
      // rows (not the pre-filter window). Mirrors the runtime
      // allow-list + the `event_source` pg enum.
      const ALLOWED_SOURCES = [
        'web',
        'telegram',
        'email',
        'system',
        'document',
        'meeting',
        'integration',
        'calendar',
        'slack',
      ];
      if (typeof args.source === 'string' && ALLOWED_SOURCES.includes(args.source)) {
        filters.source = args.source;
      }
      const rows = await scope.timeline.listEvents(filters);
      return {
        count: rows.length,
        events: rows.map((r) => ({
          id: r.id,
          source: r.source,
          occurred_at: r.occurredAt,
          content_text: r.contentText,
        })),
      };
    }
    case 'timeline.get_entity': {
      const idOrName = typeof args.idOrName === 'string' ? args.idOrName : '';
      const profile = await scope.timeline.getEntity(idOrName);
      return profile ?? { found: false };
    }
    case 'timeline.search_documents': {
      const query = typeof args.query === 'string' ? args.query : '';
      const limit = typeof args.limit === 'number' ? args.limit : 10;
      const hits = await scope.documents.searchDocumentChunks({ query, limit });
      return { count: hits.length, results: hits };
    }
    case 'timeline.retrieve_workspace_context': {
      const input = retrieveWorkspaceContextInput.parse(args);
      return retrieveWorkspaceContext(scope, {
        query: input.query,
        ...(input.recipe === undefined ? {} : { recipe: input.recipe }),
        ...(input.objectId === undefined ? {} : { objectId: input.objectId }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.includeDocuments === undefined
          ? {}
          : { includeDocuments: input.includeDocuments }),
        ...(input.includeCalendar === undefined ? {} : { includeCalendar: input.includeCalendar }),
      });
    }
    case 'timeline.get_object': {
      const input = z.object({ idOrName: z.string().trim().min(1).max(200) }).parse(args);
      const result = await scope.objects.getObject(input.idOrName);
      if (!result) return { found: false };
      return {
        found: true,
        id: result.id,
        citation: artifactRefCitation({
          kind: result.type === 'task' || result.type === 'follow_up' ? 'task' : 'object',
          id: result.id,
        }),
        type: result.type,
        name: result.canonicalName,
        status: result.status,
        stage: result.stage,
        priority: result.priority,
        owner_user_id: result.ownerUserId,
        assignee_user_id: result.assigneeUserId,
        due_at: result.dueAt?.toISOString() ?? null,
        agent_suggested: result.agentSuggested,
        archived: result.archivedAt !== null,
        notes: result.notes.slice(0, 10).map((n) => ({
          id: n.id,
          citation: artifactRefCitation({ kind: 'object_note', id: n.id }),
          body: n.body,
        })),
        recent_changes: result.recentChanges.slice(0, 20).map((c) => ({
          id: c.id,
          field: c.field,
          status: c.status,
          actor_kind: c.actorKind,
          changed_at: c.changedAt.toISOString(),
        })),
        open_tasks: result.openTasks.slice(0, 20).map((t) => ({
          id: t.id,
          citation: artifactRefCitation({ kind: 'task', id: t.id }),
          name: t.canonicalName,
          status: t.status,
        })),
      };
    }
    case 'timeline.search_objects': {
      const input = searchObjectsInput.parse(args);
      const filter: objects.ObjectSearchFilter = {
        query: input.query,
        limit: input.limit ?? 20,
      };
      if (input.type) filter.type = input.type;
      if (input.status) filter.status = input.status;
      if (input.stage) filter.stage = input.stage;
      if (input.ownerUserId !== undefined) filter.ownerUserId = input.ownerUserId;
      if (input.assigneeUserId !== undefined) filter.assigneeUserId = input.assigneeUserId;
      if (input.dueAfter) filter.dueAfter = new Date(input.dueAfter);
      if (input.dueBefore) filter.dueBefore = new Date(input.dueBefore);
      if (input.archived !== undefined) filter.archived = input.archived;
      const rows = await scope.objects.searchObjects(filter);
      return { count: rows.length, mode: 'structured', objects: rows.map(serializeObjectRow) };
    }
    case 'timeline.list_objects': {
      const input = z
        .object({
          type: z.string().max(40).optional(),
          status: z.string().max(40).optional(),
          stage: z.string().max(40).optional(),
          ownerUserId: z.string().regex(UUID_RE).optional(),
          archived: z.boolean().optional(),
          limit: z.number().int().min(1).max(50).optional(),
        })
        .parse(args);
      const filter: objects.ObjectListFilter = { limit: input.limit ?? 50 };
      if (input.type && (objects.OBJECT_TYPES as readonly string[]).includes(input.type)) {
        filter.type = input.type as objects.ObjectType;
      }
      if (input.status) filter.status = input.status;
      if (input.stage) filter.stage = input.stage;
      if (input.ownerUserId) filter.ownerUserId = input.ownerUserId;
      if (input.archived !== undefined) filter.archived = input.archived;
      const rows = await scope.objects.listObjects(filter);
      return { count: rows.length, objects: rows.map(serializeObjectRow) };
    }
    case 'timeline.list_tasks': {
      const input = z
        .object({
          status: z.string().max(40).optional(),
          ownerUserId: z.string().regex(UUID_RE).optional(),
          limit: z.number().int().min(1).max(50).optional(),
        })
        .parse(args);
      const filter: objects.ObjectListFilter = {
        type: 'task',
        archived: false,
        limit: input.limit ?? 50,
        status: input.status ?? ['suggested', 'open', 'todo', 'doing', 'blocked'],
      };
      if (input.ownerUserId) filter.ownerUserId = input.ownerUserId;
      const rows = await scope.objects.listObjects(filter);
      return {
        count: rows.length,
        tasks: rows.map((r) => ({
          id: r.id,
          citation: artifactRefCitation({ kind: 'task', id: r.id }),
          name: r.canonicalName,
          status: r.status,
          owner_user_id: r.ownerUserId,
          assignee_user_id: r.assigneeUserId,
          due_at: r.dueAt?.toISOString() ?? null,
        })),
      };
    }
    case 'timeline.search_boards': {
      const input = searchBoardsInput.parse(args);
      const limit = input.limit ?? 10;
      let boardRows: boards.BoardRow[];
      if (input.boardId) {
        const board = await scope.boards.getBoard(input.boardId, { itemLimit: 50 });
        boardRows = board ? [board] : [];
      } else if (input.objectId) {
        const contexts = await scope.boards.listObjectBoardContext(input.objectId);
        const boardIds = Array.from(new Set(contexts.map((context) => context.boardId)));
        const details = await Promise.all(
          boardIds.map((boardId) => scope.boards.getBoard(boardId, { itemLimit: 50 })),
        );
        boardRows = details.filter((board): board is boards.BoardDetail => board !== null);
      } else {
        boardRows = await scope.boards.listBoards();
      }
      const needsItems =
        Boolean(input.objectId) ||
        Boolean(input.laneId) ||
        input.responsibleUserId !== undefined ||
        Boolean(input.dueAfter) ||
        Boolean(input.dueBefore) ||
        input.priority !== undefined ||
        Boolean(input.itemText);
      const hydrated = await Promise.all(
        boardRows.map(async (board) => {
          if ('items' in board) return board;
          if (!needsItems) return board;
          return scope.boards.getBoard(board.id, { itemLimit: 50 });
        }),
      );
      const results = hydrated
        .filter((board): board is boards.BoardRow | boards.BoardDetail => board !== null)
        .filter((board) => {
          if (input.templateKind && board.templateKind !== input.templateKind) return false;
          if (input.pinned !== undefined && board.pinned !== input.pinned) return false;
          if (
            input.query &&
            !(
              textMatches(board.name, input.query) ||
              textMatches(board.purpose, input.query) ||
              textMatches(board.templateKind, input.query)
            )
          ) {
            return false;
          }
          return true;
        })
        .map((board) => {
          const items =
            'items' in board
              ? board.items.filter((item) => {
                  if (input.objectId && item.entityId !== input.objectId) return false;
                  if (input.laneId && item.laneId !== input.laneId) return false;
                  if (
                    input.responsibleUserId !== undefined &&
                    item.responsibleUserId !== input.responsibleUserId
                  ) {
                    return false;
                  }
                  if (!dateInRange(item.dueAt, input.dueAfter, input.dueBefore)) return false;
                  if (input.priority !== undefined && item.priority !== input.priority) {
                    return false;
                  }
                  if (
                    input.itemText &&
                    !(
                      textMatches(item.nextStep, input.itemText) ||
                      textMatches(item.notes, input.itemText) ||
                      textMatches(item.object.canonicalName, input.itemText)
                    )
                  ) {
                    return false;
                  }
                  return true;
                })
              : [];
          return { board, items };
        })
        .filter((result) => !needsItems || result.items.length > 0)
        .slice(0, limit);
      return {
        count: results.length,
        mode: 'structured',
        results: results.map(({ board, items }) => ({
          board: serializeBoardRow(board),
          matching_items: items.slice(0, 10).map(serializeBoardItemRow),
        })),
      };
    }
    case 'timeline.search_documents_structured': {
      const input = searchDocumentsStructuredInput.parse(args);
      const listArgs = {
        fileKind: input.fileKind ?? 'document',
        includeDeleted: input.includeDeleted ?? false,
        limit: Math.max(input.limit ?? 20, input.name ? 100 : (input.limit ?? 20)),
      };
      const docs = await scope.documents.listDocuments(
        input.folderId === undefined ? listArgs : { ...listArgs, folderId: input.folderId },
      );
      const filtered = docs
        .filter((document) => textMatches(document.name, input.name))
        .slice(0, input.limit ?? 20);
      return {
        count: filtered.length,
        mode: 'structured',
        documents: filtered.map((document) => ({
          document_id: document.id,
          href: `/app/documents/${document.id}`,
          name: document.name,
          file_kind: document.fileKind,
          folder_id: document.folderId,
          current_version_id: document.currentVersionId,
          visibility: document.visibility,
          owner_user_id: document.ownerUserId,
          created_at: document.createdAt.toISOString(),
          updated_at: document.updatedAt.toISOString(),
          deleted: document.deletedAt !== null,
        })),
      };
    }
    case 'timeline.get_document': {
      const input = z.object({ id: z.string().trim().min(1) }).parse(args);
      const document = await scope.documents.getDocument(input.id);
      if (!document) return { found: false };
      const versions = await scope.documents.listDocumentVersions(document.id);
      const folderPath = await scope.documents.folderPath(document.folderId);
      return {
        found: true,
        document_id: document.id,
        name: document.name,
        folder_id: document.folderId,
        folder_path: folderPath,
        owner_user_id: document.ownerUserId,
        visibility: document.visibility,
        current_version_id: document.currentVersionId,
        created_at: document.createdAt.toISOString(),
        updated_at: document.updatedAt.toISOString(),
        versions: versions.map((v) => ({
          version_id: v.id,
          version: v.version,
          byte_size: v.byteSize,
          content_type: v.contentType,
          uploaded_by_user_id: v.uploadedByUserId,
          processing_status: v.processingStatus,
          created_at: v.createdAt.toISOString(),
        })),
      };
    }
    case 'timeline.get_document_chunk': {
      const input = z.object({ id: z.string().trim().min(1) }).parse(args);
      const chunk = await scope.documents.getDocumentChunk(input.id);
      if (!chunk) return { found: false };
      return {
        found: true,
        document_chunk_id: chunk.id,
        document_id: chunk.documentId,
        document_version_id: chunk.documentVersionId,
        chunk_index: chunk.chunkIndex,
        representation_kind: chunk.representationKind,
        page_number: chunk.pageNumber,
        token_count: chunk.tokenCount,
        text: chunk.text,
      };
    }
    case 'timeline.list_recent_document_changes': {
      const input = listDocumentChangesInput.parse(args);
      const listArgs: Parameters<typeof scope.documents.listRecentDocumentChanges>[0] = {};
      if (input.since) listArgs.since = new Date(input.since);
      if (input.limit) listArgs.limit = input.limit;
      const changes = await scope.documents.listRecentDocumentChanges(listArgs);
      return {
        count: changes.length,
        changes: changes.map((c) => ({
          event_id: c.id,
          occurred_at: c.occurredAt.toISOString(),
          author_user_id: c.authorUserId,
          action: c.action,
          document_id: c.documentId,
          document_version_id: c.documentVersionId,
          folder_id: c.folderId,
          summary: c.summary,
        })),
      };
    }
    case 'timeline.list_calendar_events': {
      const input = listCalendarEventsInput.parse(args);
      const opts: Parameters<typeof scope.calendar.listCalendarEvents>[0] = {};
      if (input.from) opts.from = new Date(input.from);
      if (input.to) opts.to = new Date(input.to);
      if (!input.from && !input.to) opts.from = new Date();
      if (input.limit) opts.limit = input.limit;
      const events = await scope.calendar.listCalendarEvents(opts);
      return {
        count: events.length,
        events: events.map((e) => ({
          id: e.id,
          citation: artifactRefCitation({ kind: 'calendar_event', id: e.id }),
          title: e.title,
          start_at: e.startAt.toISOString(),
          end_at: e.endAt.toISOString(),
          timezone: e.timezone,
          all_day: e.allDay,
          location: e.redacted ? null : e.location,
          show_as: e.showAs,
          rrule: e.rrule,
          recurring_parent_id: e.recurringParentId,
          original_start_at: e.originalStartAt?.toISOString() ?? null,
          is_exception: e.isException,
          visibility: e.visibility,
          metadata: e.redacted ? {} : e.metadata,
          redacted: e.redacted,
          agent_suggested: e.agentSuggested,
        })),
      };
    }
    case 'timeline.get_calendar_event': {
      const input = z.object({ id: z.string().trim().min(1) }).parse(args);
      const event = await scope.calendar.getCalendarEvent(input.id);
      if (!event) return { found: false };
      return {
        found: true,
        id: event.id,
        citation: artifactRefCitation({ kind: 'calendar_event', id: event.id }),
        title: event.title,
        description: event.redacted ? null : event.description,
        start_at: event.startAt.toISOString(),
        end_at: event.endAt.toISOString(),
        timezone: event.timezone,
        all_day: event.allDay,
        location: event.redacted ? null : event.location,
        show_as: event.showAs,
        rrule: event.rrule,
        recurring_parent_id: event.recurringParentId,
        original_start_at: event.originalStartAt?.toISOString() ?? null,
        is_exception: event.isException,
        visibility: event.visibility,
        metadata: event.redacted ? {} : event.metadata,
        redacted: event.redacted,
        agent_suggested: event.agentSuggested,
        created_by_user_id: event.createdByUserId,
      };
    }
    case 'timeline.resolve_time_context': {
      const input = z
        .object({
          phrase: z.string().trim().min(1).max(100).optional(),
          referenceDate: z.iso.datetime().optional(),
        })
        .parse(args);
      const settings = await scope.calendar.getCalendarSettings();
      const referenceDate = input.referenceDate ? new Date(input.referenceDate) : new Date();
      const context = workspaceTimeContext(settings.defaultTimezone, referenceDate);
      const resolved = input.phrase
        ? resolveTimePhrase(input.phrase, {
            timezone: settings.defaultTimezone,
            referenceDate,
          })
        : null;
      return {
        context,
        resolved: resolved
          ? {
              phrase: resolved.phrase,
              timezone: resolved.timezone,
              local_start_date: resolved.localStartDate,
              local_end_date: resolved.localEndDate,
              from: resolved.from.toISOString(),
              to: resolved.to.toISOString(),
              explanation: resolved.explanation,
            }
          : null,
      };
    }
    case 'timeline.list_integrations': {
      const [rows, mcpServers] = await Promise.all([
        scope.integrations.listIntegrations(),
        scope.mcp.listServers(),
      ]);
      return {
        integrations: rows.map((r) => ({
          id: r.id,
          provider: r.provider,
          display_name: r.displayName,
          enabled: r.enabled,
          last_synced_at: r.lastSyncedAt ? r.lastSyncedAt.toISOString() : null,
          last_error: r.lastError,
        })),
        mcp_servers: mcpServers.map((s) => ({
          id: s.id,
          name: s.name,
          enabled: s.enabled,
          tools: Array.isArray(s.cachedTools)
            ? (s.cachedTools as { name: string }[]).map((t) => t.name)
            : [],
        })),
      };
    }
    case 'timeline.search_integration_events': {
      const input = searchIntegrationEventsInput.parse(args);
      const opts: Parameters<typeof scope.timeline.searchEvents>[0] = {
        query: input.query,
        source: 'integration',
        ...(input.limit ? { limit: input.limit } : {}),
      };
      const hits = await scope.timeline.searchEvents(opts);
      let filtered = hits.filter((h) => h.source === 'integration');
      if (input.provider && filtered.length > 0) {
        const rows = await scope.timeline.getEventsByIds(filtered.map((r) => r.eventId));
        const providerById = new Map<string, string | undefined>();
        for (const row of rows) {
          const md = row.sourceMetadata as Record<string, unknown> | null;
          const provider = md && typeof md.provider === 'string' ? md.provider : undefined;
          providerById.set(row.id, provider);
        }
        filtered = filtered.filter((r) => providerById.get(r.eventId) === input.provider);
      }
      return {
        count: filtered.length,
        results: filtered.slice(0, input.limit ?? 10).map((r) => ({
          event_id: r.eventId,
          occurred_at: r.occurredAt,
          score: r.score,
          snippet: r.snippet,
        })),
      };
    }
    case 'timeline.get_integration_resource': {
      const input = z
        .object({
          provider: z.enum(['google_drive', 'linear', 'github', 'monday', 'slack', 'sentry']),
          externalObjectId: z.string().min(1).max(512),
          historyLimit: z.number().int().min(1).max(50).optional(),
        })
        .parse(args);
      const resourceArgs: Parameters<typeof scope.integrations.getIntegrationResource>[0] = {
        provider: input.provider,
        externalObjectId: input.externalObjectId,
      };
      if (input.historyLimit !== undefined) resourceArgs.historyLimit = input.historyLimit;
      const result = await scope.integrations.getIntegrationResource(resourceArgs);
      if (!result) return { found: false };
      return {
        found: true,
        entity: result.entity
          ? {
              id: result.entity.id,
              type: result.entity.type,
              canonical_name: result.entity.canonicalName,
              status: result.entity.status,
              priority: result.entity.priority,
              metadata: result.entity.metadata,
            }
          : null,
        history: result.history.map((h) => ({
          event_id: h.id,
          occurred_at: h.occurredAt.toISOString(),
          event_type: h.eventType,
          snippet: h.contentText ?? '',
        })),
      };
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * Handle one JSON-RPC request from an external MCP client. Returns the
 * full response object the route should serialize back. Notifications
 * (`id == null`) return null and the route should respond 204.
 */
export async function handleMcpRequest(
  ctx: HandleContext,
  raw: unknown,
): Promise<JsonRpcResponse | null> {
  if (!raw || typeof raw !== 'object') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid_request' } };
  }
  const req = raw as JsonRpcRequest;
  const id = req.id ?? null;
  // initialize is the one method that doesn't require auth — the
  // protocol handshake happens before the client necessarily knows
  // what scopes it has.
  if (req.method === 'initialize') {
    return jsonRpcSuccess(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {}, prompts: {} },
      serverInfo: { name: 'the-timeline', version: '0.1.0' },
    });
  }
  if (req.method === 'notifications/initialized') {
    return null;
  }
  // All other methods require a valid bearer.
  if (!ctx.bearer) {
    return jsonRpcError(id, -32001, 'Unauthorized: missing bearer token');
  }
  const resolved = await resolveBearerKey(ctx.db, ctx.bearer);
  if (!resolved) {
    return jsonRpcError(id, -32001, 'Unauthorized: invalid or revoked bearer token');
  }
  try {
    switch (req.method) {
      case 'tools/list':
        return jsonRpcSuccess(id, { tools: TOOLS });
      case 'tools/call': {
        const params = (req.params ?? {}) as { name?: unknown; arguments?: unknown };
        const name = typeof params.name === 'string' ? params.name : '';
        const args = (params.arguments ?? {}) as CallToolArgs;
        const out = await callTool(ctx.db, resolved.teamId, name, args);
        return jsonRpcSuccess(id, {
          content: [{ type: 'text', text: JSON.stringify(out) }],
          isError: false,
        });
      }
      case 'resources/list':
        return jsonRpcSuccess(id, { resources: RESOURCES });
      case 'resources/read': {
        const params = (req.params ?? {}) as { uri?: unknown };
        const uri = typeof params.uri === 'string' ? params.uri : '';
        const out = await readResource(ctx.db, resolved.teamId, uri);
        return jsonRpcSuccess(id, {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(out) }],
        });
      }
      case 'prompts/list':
        return jsonRpcSuccess(id, { prompts: PROMPTS });
      case 'prompts/get': {
        const params = (req.params ?? {}) as { name?: unknown; arguments?: unknown };
        const name = typeof params.name === 'string' ? params.name : '';
        const out = buildPrompt(name, (params.arguments ?? {}) as Record<string, unknown>);
        if (!out) return jsonRpcError(id, -32602, `Unknown prompt: ${name}`);
        return jsonRpcSuccess(id, out);
      }
      default:
        return jsonRpcError(id, -32601, `Method not found: ${req.method}`);
    }
  } catch (err) {
    log.warn({ err, method: req.method }, 'mcp server method failed');
    const message = err instanceof Error ? err.message : 'internal_error';
    return jsonRpcError(id, -32000, message);
  }
}

async function readResource(db: Db, teamId: string, uri: string): Promise<unknown> {
  // Bearer-key auth is the trust boundary; skipMembershipCheck tells
  // withTeam not to query team_members for the zero-UUID actor. The
  // visibility filter still excludes `private` and `specific_users`
  // events since the zero-UUID isn't author/target on any of them.
  const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';
  const scope = withTeam(db, teamId, PSEUDO_USER, { skipMembershipCheck: true });
  if (uri === 'timeline://events/recent') {
    const rows = await scope.timeline.listEvents({ limit: 50 });
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      occurred_at: r.occurredAt,
      content_text: r.contentText,
    }));
  }
  if (uri === 'timeline://entities') {
    // Re-use the existing entity surface — getEntity for a wildcard is
    // not supported, so for now just return a stub indicating clients
    // should call timeline.get_entity by name. Future work: dedicated
    // listEntities scope method.
    return { hint: 'Call tools/call timeline.get_entity with idOrName to look up an entity.' };
  }
  throw new Error(`Unknown resource: ${uri}`);
}

function buildPrompt(
  name: string,
  args: Record<string, unknown>,
): { messages: { role: string; content: { type: string; text: string } }[] } | null {
  if (name === 'summarize_recent') {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Use timeline.list_events with a 7-day window, then timeline.search_events for any standout themes. Summarize what the team has been working on this week.',
          },
        },
      ],
    };
  }
  if (name === 'what_changed') {
    const target = typeof args.name === 'string' ? args.name : '<entity>';
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Look up ${target} with timeline.get_entity, then call timeline.search_events with the entity's name as the query. Summarize recent changes and decisions.`,
          },
        },
      ],
    };
  }
  return null;
}
