import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

import { childLogger } from '../logger.js';
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
  // Escape `"` and `>` so a future, more permissive `source` / `eventId`
  // value can't break out of the attribute. Today both are constrained
  // (enum + UUID), but the fence is security-critical — keep it safe
  // regardless of upstream constraint drift.
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/>/g, '&gt;');
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
