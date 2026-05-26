import { type Db } from '@timeline/db';

import { childLogger } from '../logger.js';
import { withTeam } from '../team-scope.js';

import { resolveBearerKey } from './keys.js';

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
          enum: ['web', 'telegram', 'email', 'system', 'document', 'meeting', 'integration'],
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

async function jsonRpcSuccess(
  id: number | string | null,
  result: unknown,
): Promise<JsonRpcSuccess> {
  return Promise.resolve({ jsonrpc: '2.0', id, result });
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
  // The bearer key represents the team, not a specific user; pass a
  // null-UUID as the actor so visibility checks treat the request as a
  // non-author. Private events are NEVER returned (the `private`
  // visibility predicate requires authorUserId == userId, which the
  // null UUID can't satisfy). This is intentional — outbound MCP keys
  // are team-scoped, not per-user, so private events stay private.
  // Bearer-key auth is the trust boundary; skipMembershipCheck tells
  // withTeam not to query team_members for the zero-UUID actor. The
  // visibility filter still excludes `private` and `specific_users`
  // events since the zero-UUID isn't author/target on any of them.
  const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';
  const scope = withTeam(db, teamId, PSEUDO_USER, { skipMembershipCheck: true });
  switch (toolName) {
    case 'timeline.search_events': {
      const query = typeof args.query === 'string' ? args.query : '';
      const limit = typeof args.limit === 'number' ? args.limit : 10;
      const hits = await scope.searchEvents({ query, limit });
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
      const ev = await scope.getEvent(id);
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
      const filters: Parameters<typeof scope.listEvents>[0] = {};
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
      ];
      if (typeof args.source === 'string' && ALLOWED_SOURCES.includes(args.source)) {
        filters.source = args.source;
      }
      const rows = await scope.listEvents(filters);
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
      const profile = await scope.getEntity(idOrName);
      return profile ?? { found: false };
    }
    case 'timeline.search_documents': {
      const query = typeof args.query === 'string' ? args.query : '';
      const limit = typeof args.limit === 'number' ? args.limit : 10;
      const hits = await scope.searchDocumentChunks({ query, limit });
      return { count: hits.length, results: hits };
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
    return await jsonRpcSuccess(id, {
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
        return await jsonRpcSuccess(id, { tools: TOOLS });
      case 'tools/call': {
        const params = (req.params ?? {}) as { name?: unknown; arguments?: unknown };
        const name = typeof params.name === 'string' ? params.name : '';
        const args = (params.arguments ?? {}) as CallToolArgs;
        const out = await callTool(ctx.db, resolved.teamId, name, args);
        return await jsonRpcSuccess(id, {
          content: [{ type: 'text', text: JSON.stringify(out) }],
          isError: false,
        });
      }
      case 'resources/list':
        return await jsonRpcSuccess(id, { resources: RESOURCES });
      case 'resources/read': {
        const params = (req.params ?? {}) as { uri?: unknown };
        const uri = typeof params.uri === 'string' ? params.uri : '';
        const out = await readResource(ctx.db, resolved.teamId, uri);
        return await jsonRpcSuccess(id, {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(out) }],
        });
      }
      case 'prompts/list':
        return await jsonRpcSuccess(id, { prompts: PROMPTS });
      case 'prompts/get': {
        const params = (req.params ?? {}) as { name?: unknown; arguments?: unknown };
        const name = typeof params.name === 'string' ? params.name : '';
        const out = buildPrompt(name, (params.arguments ?? {}) as Record<string, unknown>);
        if (!out) return jsonRpcError(id, -32602, `Unknown prompt: ${name}`);
        return await jsonRpcSuccess(id, out);
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
    const rows = await scope.listEvents({ limit: 50 });
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
