import { getDb } from '@timeline/db';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

import { childLogger } from '../logger.js';
import * as objects from '../objects/index.js';
import { type TeamScope } from '../team-scope.js';

const log = childLogger('agent:tools');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const searchTimelineInput = z.object({
  query: z.string().trim().min(1).max(500),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  source: z.enum(['web', 'telegram', 'email', 'system']).optional(),
  entityIds: z.array(z.string().regex(UUID_RE)).max(20).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const getEntityInput = z.object({
  idOrName: z.string().trim().min(1).max(200),
});

const listEventsInput = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  authorUserId: z.string().regex(UUID_RE).optional(),
  source: z.enum(['web', 'telegram', 'email', 'system']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const getEventInput = z.object({
  id: z.string().regex(UUID_RE),
});

/**
 * Wrap an event's raw text in `<external_content>` tags so the model cannot
 * confuse it with system instructions. The tag name is referenced verbatim
 * by Rule 8 in the system prompt; do not rename without bumping
 * AGENT_PROMPT_VERSION.
 *
 * Strips any nested `<external_content>` / `</external_content>` markers
 * from the input — a malicious sender could otherwise inject a closing
 * tag and "escape" the fence. We replace the literal closing sequence
 * with a benign placeholder.
 */
function fenceAttr(value: string): string {
  // Escape every char that has structural meaning inside an XML/HTML-style
  // attribute: `&` (entity start), `"` (attr terminator), `<` (rejected by
  // strict XML attribute parsers), `>` (cosmetic — escaped for symmetry).
  // Today `source` is an enum and `eventId` is a UUID so none of these can
  // actually appear, but the fence is security-critical and these helpers
  // must stay safe regardless of upstream constraint drift.
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fenceExternalContent(
  text: string | null | undefined,
  attrs: { source: string; eventId: string },
): string | null {
  if (text === null || text === undefined) return null;
  const sanitized = text.replace(/<\/?external_content[^>]*>/gi, '[fence-removed]');
  const source = fenceAttr(attrs.source);
  const eventId = fenceAttr(attrs.eventId);
  return `<external_content source="${source}" event_id="${eventId}">${sanitized}</external_content>`;
}

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    log.error({ err, tool: label }, 'tool failed');
    return { error: 'tool_failed' };
  }
}

/**
 * Build the agent's tool set bound to a single `TeamScope`. The scope is
 * constructed from `(db, activeTeamId, sessionUserId)` server-side — the
 * LLM never sees a teamId, and tool input schemas have no teamId field.
 * Every tool is a thin wrapper over one `withTeam` method.
 *
 * Team isolation is enforced by construction: tools cannot reach a different
 * team because they don't accept one. Hostile inputs (cross-team event_ids,
 * entity_ids leaked from URLs, alias collisions) resolve to `null` or `[]`
 * at the SQL layer via the visibility filter baked into `withTeam`.
 *
 * Errors are caught and returned as `{ error }` rather than thrown — keeps
 * the stream alive so the agent can recover or report failure with a
 * citation-aware message.
 */
export function buildAgentTools(scope: TeamScope): ToolSet {
  return {
    search_timeline: tool({
      description:
        "Semantic search across the current team's timeline. Returns ranked events with event_id (use for [ev:<id>] citations), fact statements, and entity_ids. Use this for 'what was discussed about X' or 'find anything mentioning Y'.",
      inputSchema: searchTimelineInput,
      execute: async (raw) =>
        safe('search_timeline', async () => {
          const input = searchTimelineInput.parse(raw);
          const args: Parameters<typeof scope.searchEvents>[0] = { query: input.query };
          if (input.from) args.from = new Date(input.from);
          if (input.to) args.to = new Date(input.to);
          if (input.source) args.source = input.source;
          if (input.entityIds) args.entityIds = input.entityIds;
          if (input.limit) args.limit = input.limit;
          const results = await scope.searchEvents(args);
          // Fence the snippet so a malicious search hit cannot smuggle a
          // prompt-injection past the Rule 8 framing.
          const fenced = results.map((r) => ({
            ...r,
            snippet:
              fenceExternalContent(r.snippet, { source: r.source, eventId: r.eventId }) ?? '',
          }));
          return { count: fenced.length, results: fenced };
        }),
    }),

    get_entity: tool({
      description:
        "Look up one entity (person, company, project, topic) by exact UUID or canonical-name/alias match. Returns the entity, its 20 most recent facts (capped — call search_timeline if you need more depth on a specific topic), its visibility-filtered source events with event_ids, and the top 10 co-occurring entities. Use this for 'tell me about <name>' or to resolve a name into an entity id before searching.",
      inputSchema: getEntityInput,
      execute: async (raw) =>
        safe('get_entity', async () => {
          const { idOrName } = getEntityInput.parse(raw);
          // Cap the payload for agent calls so a chatty entity doesn't blow
          // the LLM context. 20 facts + 10 co-occurring is enough to anchor
          // an answer; the agent can call search_timeline for breadth.
          const profile = await scope.getEntity(idOrName, {
            factLimit: 20,
            coOccurringLimit: 10,
          });
          if (!profile) return { found: false };
          // Explicitly project event fields (allowlist) instead of spreading
          // `...e` — keeps the LLM-visible surface in sync with list_events /
          // get_event, and a future field added to EntityProfile.events can't
          // silently leak. content_text is fenced so prompt-injection in
          // entity source events can't bypass Rule 8.
          return {
            found: true,
            ...profile,
            events: profile.events.map((e) => ({
              event_id: e.id,
              occurred_at: e.occurredAt.toISOString(),
              source: e.source,
              author_user_id: e.authorUserId,
              content_text: fenceExternalContent(e.contentText, {
                source: e.source,
                eventId: e.id,
              }),
              has_audio: Boolean(e.contentAudioUrl),
            })),
          };
        }),
    }),

    list_events: tool({
      description:
        "List raw events in reverse-chronological order. Filterable by ISO datetime range (from inclusive, to exclusive), author UUID, and source. Use this for 'what happened on <date>' or 'what did <person> post'. Returns events with event_id, occurred_at, source, author_user_id, and content_text.",
      inputSchema: listEventsInput,
      execute: async (raw) =>
        safe('list_events', async () => {
          const input = listEventsInput.parse(raw);
          const filters: Parameters<typeof scope.listEvents>[0] = {};
          if (input.from) filters.from = new Date(input.from);
          if (input.to) filters.to = new Date(input.to);
          if (input.authorUserId) filters.authorUserId = input.authorUserId;
          if (input.limit) filters.limit = input.limit;
          // Note: `source` not yet supported by listEvents; filter post-hoc.
          const events = await scope.listEvents(filters);
          const filtered = input.source ? events.filter((e) => e.source === input.source) : events;
          return {
            count: filtered.length,
            events: filtered.map((e) => ({
              event_id: e.id,
              occurred_at: e.occurredAt.toISOString(),
              source: e.source,
              author_user_id: e.authorUserId,
              content_text: fenceExternalContent(e.contentText, {
                source: e.source,
                eventId: e.id,
              }),
              has_audio: Boolean(e.contentAudioUrl),
            })),
          };
        }),
    }),

    get_object: tool({
      description:
        "Look up a workspace object (task, deal, project, person, company, follow_up, etc.) by UUID or canonical name. Returns its status/stage/owner/due_at, the most recent suggested+applied changes, any notes, related objects, and open child tasks. Use this for 'what's the status of <X>' or before proposing a change to verify the current value.",
      inputSchema: z.object({ idOrName: z.string().trim().min(1).max(200) }),
      execute: async ({ idOrName }) =>
        safe('get_object', async () => {
          const result = await objects.getObject(getDb(), scope, idOrName);
          if (!result) return { found: false };
          return {
            found: true,
            id: result.id,
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
            notes: result.notes.slice(0, 10).map((n) => ({ id: n.id, body: n.body })),
            recent_changes: result.recentChanges.slice(0, 20).map((c) => ({
              id: c.id,
              field: c.field,
              status: c.status,
              actor_kind: c.actorKind,
              changed_at: c.changedAt.toISOString(),
            })),
            open_tasks: result.openTasks.slice(0, 20).map((t) => ({
              id: t.id,
              name: t.canonicalName,
              status: t.status,
            })),
          };
        }),
    }),

    list_objects: tool({
      description:
        "List workspace objects with optional filters. Use this for 'what deals are open' or 'show me suggested tasks'. Returns id, name, type, status, stage, owner, and due_at for each match. Capped at 50; narrow the filter if you need fewer.",
      inputSchema: z.object({
        type: z.string().max(40).optional(),
        status: z.string().max(40).optional(),
        stage: z.string().max(40).optional(),
        ownerUserId: z.string().regex(UUID_RE).optional(),
        archived: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async (raw) =>
        safe('list_objects', async () => {
          const input = raw as {
            type?: string;
            status?: string;
            stage?: string;
            ownerUserId?: string;
            archived?: boolean;
            limit?: number;
          };
          const filter: objects.ObjectListFilter = { limit: input.limit ?? 50 };
          if (input.type && (objects.OBJECT_TYPES as readonly string[]).includes(input.type)) {
            filter.type = input.type as objects.ObjectType;
          }
          if (input.status) filter.status = input.status;
          if (input.stage) filter.stage = input.stage;
          if (input.ownerUserId) filter.ownerUserId = input.ownerUserId;
          if (input.archived !== undefined) filter.archived = input.archived;
          const rows = await objects.listObjects(getDb(), scope, filter);
          return {
            count: rows.length,
            objects: rows.map((r) => ({
              id: r.id,
              name: r.canonicalName,
              type: r.type,
              status: r.status,
              stage: r.stage,
              owner_user_id: r.ownerUserId,
              due_at: r.dueAt?.toISOString() ?? null,
              agent_suggested: r.agentSuggested,
            })),
          };
        }),
    }),

    list_tasks: tool({
      description:
        "Convenience over list_objects for tasks. Filters by status (default: not 'done' and not 'cancelled') and optionally by ownerUserId. Use for 'what's on my plate' or 'what tasks are blocked'.",
      inputSchema: z.object({
        status: z.string().max(40).optional(),
        ownerUserId: z.string().regex(UUID_RE).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async (raw) =>
        safe('list_tasks', async () => {
          const input = raw as { status?: string; ownerUserId?: string; limit?: number };
          const filter: objects.ObjectListFilter = {
            type: 'task',
            archived: false,
            limit: input.limit ?? 50,
            // Push the default "active" status set into the DB filter as
            // a positive allow-list rather than post-filtering in memory.
            // Otherwise a workspace dominated by closed tasks would see
            // `limit=50` rows fetched, most of them done/cancelled, and
            // post-filter would leave the agent with a handful of active
            // ones — under-reporting actual workload.
            //
            // `open` is included because that's what `createObject`
            // defaults to when a user creates a task via /app/objects/new
            // (versus 'suggested' for agent-created or 'todo' once it
            // moves into the workflow). Excluding it would silently hide
            // freshly-created human tasks from the agent.
            status: input.status ?? ['suggested', 'open', 'todo', 'doing', 'blocked'],
          };
          if (input.ownerUserId) filter.ownerUserId = input.ownerUserId;
          const rows = await objects.listObjects(getDb(), scope, filter);
          return {
            count: rows.length,
            tasks: rows.map((r) => ({
              id: r.id,
              name: r.canonicalName,
              status: r.status,
              owner_user_id: r.ownerUserId,
              due_at: r.dueAt?.toISOString() ?? null,
            })),
          };
        }),
    }),

    recent_changes: tool({
      description:
        "Recent applied or suggested changes to workspace objects. Use this for 'what changed today' or to find suggestions awaiting review. Filter by entityId, status, or since (ISO datetime).",
      inputSchema: z.object({
        entityId: z.string().regex(UUID_RE).optional(),
        status: z.enum(['applied', 'suggested', 'rejected']).optional(),
        since: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async (raw) =>
        safe('recent_changes', async () => {
          const input = raw as {
            entityId?: string;
            status?: 'applied' | 'suggested' | 'rejected';
            since?: string;
            limit?: number;
          };
          const filter: Parameters<typeof objects.listObjectChanges>[2] = {
            limit: input.limit ?? 30,
          };
          if (input.entityId) filter.entityId = input.entityId;
          if (input.status) filter.status = input.status;
          if (input.since) filter.since = new Date(input.since);
          const rows = await objects.listObjectChanges(getDb(), scope, filter);
          return {
            count: rows.length,
            changes: rows.map((c) => ({
              id: c.id,
              entity_id: c.entityId,
              entity_name: c.entityName,
              field: c.field,
              status: c.status,
              actor_kind: c.actorKind,
              previous_value: c.previousValue,
              new_value: c.newValue,
              changed_at: c.changedAt.toISOString(),
            })),
          };
        }),
    }),

    suggest_task: tool({
      description:
        "Propose a new task. The task is created with status='suggested' and agent_suggested=true; a human reviews on the object page or inbox. Use sparingly — only when the conversation reveals a concrete next action that nobody has captured. Set parentObjectId to link the task to a relevant deal/project/person.",
      inputSchema: z.object({
        title: z.string().trim().min(1).max(200),
        dueAt: z.string().datetime().optional(),
        ownerUserId: z.string().regex(UUID_RE).optional(),
        note: z.string().trim().max(1000).optional(),
        parentObjectId: z.string().regex(UUID_RE).optional(),
        sourceEventId: z.string().regex(UUID_RE).optional(),
      }),
      execute: async (raw) =>
        safe('suggest_task', async () => {
          const input = raw as {
            title: string;
            dueAt?: string;
            ownerUserId?: string;
            note?: string;
            parentObjectId?: string;
            sourceEventId?: string;
          };
          const created = await objects.createObject(getDb(), scope, {
            type: 'task',
            canonicalName: input.title,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
            ownerUserId: input.ownerUserId ?? null,
            parentObjectId: input.parentObjectId ?? null,
            sourceEventId: input.sourceEventId ?? null,
            agentSuggested: true,
            metadata: input.note ? { agent_note: input.note } : {},
            actor: { kind: 'agent', userId: null },
          });
          return {
            ok: true,
            id: created.id,
            status: created.status,
            message: `Suggested task created. A teammate can accept it from /app/objects/${created.id}.`,
          };
        }),
    }),

    propose_object_change: tool({
      description:
        "Propose a change to an existing object's field (status, stage, priority, ownerUserId, assigneeUserId, dueAt). Writes a 'suggested' row to object_changes WITHOUT mutating the entity; a human accepts/rejects from the object page. Use after get_object verifies the current value.",
      inputSchema: z.object({
        entityId: z.string().regex(UUID_RE),
        field: z.enum(['status', 'stage', 'priority', 'ownerUserId', 'assigneeUserId', 'dueAt']),
        newValue: z.unknown(),
        note: z.string().trim().max(500).optional(),
      }),
      execute: async (raw) =>
        safe('propose_object_change', async () => {
          const input = raw as {
            entityId: string;
            field:
              | 'status'
              | 'stage'
              | 'priority'
              | 'ownerUserId'
              | 'assigneeUserId'
              | 'dueAt';
            newValue: unknown;
            note?: string;
          };
          const proposed = await objects.proposeObjectChange(getDb(), scope, {
            entityId: input.entityId,
            field: input.field,
            newValue: input.newValue,
            note: input.note ?? null,
          });
          return {
            ok: true,
            change_id: proposed.id,
            message: 'Suggestion recorded. A teammate will review on the object page.',
          };
        }),
    }),

    get_event: tool({
      description:
        "Fetch one raw event by id, including its linked facts and entities. Use this to verify a citation or drill into a specific event_id you've already received from another tool. Returns null if the id isn't in this team or isn't visible to you.",
      inputSchema: getEventInput,
      execute: async (raw) =>
        safe('get_event', async () => {
          const { id } = getEventInput.parse(raw);
          const result = await scope.getEventWithFacts(id);
          if (!result) return { found: false };
          return {
            found: true,
            event_id: result.event.id,
            occurred_at: result.event.occurredAt.toISOString(),
            source: result.event.source,
            author_user_id: result.event.authorUserId,
            content_text: fenceExternalContent(result.event.contentText, {
              source: result.event.source,
              eventId: result.event.id,
            }),
            has_audio: Boolean(result.event.contentAudioUrl),
            facts: result.facts.map((f) => ({
              fact_id: f.id,
              statement: f.statement,
              confidence: f.confidence,
            })),
            entities: result.entities.map((e) => ({
              entity_id: e.id,
              name: e.canonicalName,
              type: e.type,
            })),
          };
        }),
    }),
  };
}
