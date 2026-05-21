import { describe, expect, it, vi } from 'vitest';

import { type TeamScope } from '../team-scope.js';

import { buildAgentTools } from './tools.js';

/**
 * Team-isolation tests for the agent tools. These verify by construction
 * that no tool can reach across teams:
 *
 * 1. Tool input schemas do not accept `teamId`. Compile-time + runtime.
 * 2. Tools call exactly one `scope` method each. The scope is bound to a
 *    fixed (teamId, userId) at construction; the tool cannot rebind it.
 * 3. Hostile inputs (cross-team event_ids, alias collisions, non-UUID
 *    strings) are forwarded to scope methods, which the scope contract
 *    requires to return null/empty when the id isn't in the bound team.
 *    We assert here that tools never bypass scope and never return data
 *    when scope returns null.
 *
 * DB-layer team isolation (the SQL where-clauses inside `withTeam`) is
 * tested separately by the search/entity-page integration paths; here we
 * only prove the agent layer is structurally team-safe.
 */

interface FakeScope {
  searchEvents: ReturnType<typeof vi.fn>;
  getEntity: ReturnType<typeof vi.fn>;
  listEvents: ReturnType<typeof vi.fn>;
  getEventWithFacts: ReturnType<typeof vi.fn>;
}

function makeFakeScope(): FakeScope {
  return {
    searchEvents: vi.fn(),
    getEntity: vi.fn(),
    listEvents: vi.fn(),
    getEventWithFacts: vi.fn(),
  };
}

const TEAM_B_EVENT_ID = '11111111-2222-3333-4444-555555555555';
const TEAM_B_ENTITY_ID = '99999999-8888-7777-6666-555555555555';

describe('buildAgentTools — team isolation', () => {
  it('tool input schemas do not accept teamId or userId', () => {
    const scope = makeFakeScope();
    const tools = buildAgentTools(scope as unknown as TeamScope);
    // Each input schema explicitly rejects extra fields when used with
    // .parse(), but the structural guarantee is that the schemas don't
    // declare teamId in their shape. Verify by Zod's `.shape` introspection.
    const search = tools.search_timeline?.inputSchema as unknown as {
      shape: Record<string, unknown>;
    };
    const ent = tools.get_entity?.inputSchema as unknown as { shape: Record<string, unknown> };
    const list = tools.list_events?.inputSchema as unknown as { shape: Record<string, unknown> };
    const evt = tools.get_event?.inputSchema as unknown as { shape: Record<string, unknown> };
    expect(Object.keys(search.shape)).not.toContain('teamId');
    expect(Object.keys(search.shape)).not.toContain('userId');
    expect(Object.keys(ent.shape)).not.toContain('teamId');
    expect(Object.keys(list.shape)).not.toContain('teamId');
    expect(Object.keys(evt.shape)).not.toContain('teamId');
  });

  it('get_event with a cross-team event_id returns { found: false } (scope returns null)', async () => {
    const scope = makeFakeScope();
    scope.getEventWithFacts.mockResolvedValue(null);
    const tools = buildAgentTools(scope as unknown as TeamScope);
    // The agent passes a hostile UUID that belongs to team B; the bound
    // scope's SQL filter drops it and returns null. The tool must NOT
    // synthesize data — only relay the null as `{ found: false }`.
    const exec = tools.get_event?.execute as (
      input: { id: string },
      opts: unknown,
    ) => Promise<unknown>;
    const result = await exec({ id: TEAM_B_EVENT_ID }, {});
    expect(scope.getEventWithFacts).toHaveBeenCalledWith(TEAM_B_EVENT_ID);
    expect(result).toEqual({ found: false });
  });

  it('get_entity with a cross-team entity_id resolves via scope (returns { found: false })', async () => {
    const scope = makeFakeScope();
    scope.getEntity.mockResolvedValue(null);
    const tools = buildAgentTools(scope as unknown as TeamScope);
    const exec = tools.get_entity?.execute as (
      input: { idOrName: string },
      opts: unknown,
    ) => Promise<unknown>;
    const result = await exec({ idOrName: TEAM_B_ENTITY_ID }, {});
    expect(scope.getEntity).toHaveBeenCalledWith(TEAM_B_ENTITY_ID, expect.any(Object));
    // The tool passes a `{ factLimit, coOccurringLimit }` cap to bound
    // payload size — assert that's what's flowing through (not e.g. a
    // hostile teamId smuggled in via the options bag).
    const opts = scope.getEntity.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('teamId');
    expect(opts).not.toHaveProperty('userId');
    expect(result).toEqual({ found: false });
  });

  it('get_entity with an alias-collision name still routes through scope', async () => {
    // "Acme Corp" might exist on both team A and team B. The tool passes
    // the string straight to scope.getEntity, which case-insensitively
    // matches ONLY within the bound team. We assert the tool relays
    // whatever scope returns and never short-circuits.
    const scope = makeFakeScope();
    scope.getEntity.mockResolvedValue(null);
    const tools = buildAgentTools(scope as unknown as TeamScope);
    const exec = tools.get_entity?.execute as (
      input: { idOrName: string },
      opts: unknown,
    ) => Promise<unknown>;
    const result = await exec({ idOrName: 'Acme Corp' }, {});
    expect(scope.getEntity).toHaveBeenCalledWith('Acme Corp', expect.any(Object));
    expect(result).toEqual({ found: false });
  });

  it('search_timeline forwards entityIds verbatim — scope must drop cross-team ids', async () => {
    // Hostile input: agent passes a team-B entity_id as a filter. The
    // scope's searchEvents wrapper is responsible for filtering Qdrant
    // hits by team_id; here we only verify the tool does not silently
    // re-key or expand the filter.
    const scope = makeFakeScope();
    scope.searchEvents.mockResolvedValue([]);
    const tools = buildAgentTools(scope as unknown as TeamScope);
    const exec = tools.search_timeline?.execute as (
      input: unknown,
      opts: unknown,
    ) => Promise<unknown>;
    await exec({ query: 'leak attempt', entityIds: [TEAM_B_ENTITY_ID] }, {});
    expect(scope.searchEvents).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'leak attempt', entityIds: [TEAM_B_ENTITY_ID] }),
    );
    // No teamId / userId smuggled into the call.
    const passed = scope.searchEvents.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(passed).not.toHaveProperty('teamId');
    expect(passed).not.toHaveProperty('userId');
  });

  it('list_events forwards authorUserId verbatim — scope must enforce team', async () => {
    const scope = makeFakeScope();
    scope.listEvents.mockResolvedValue([]);
    const tools = buildAgentTools(scope as unknown as TeamScope);
    const exec = tools.list_events?.execute as (input: unknown, opts: unknown) => Promise<unknown>;
    await exec({ authorUserId: '00000000-0000-0000-0000-000000000001' }, {});
    expect(scope.listEvents).toHaveBeenCalledWith(
      expect.objectContaining({ authorUserId: '00000000-0000-0000-0000-000000000001' }),
    );
  });

  it('tool execute catches thrown errors and returns { error } — keeps stream alive', async () => {
    const scope = makeFakeScope();
    scope.getEventWithFacts.mockRejectedValue(new Error('db down'));
    const tools = buildAgentTools(scope as unknown as TeamScope);
    const exec = tools.get_event?.execute as (
      input: { id: string },
      opts: unknown,
    ) => Promise<unknown>;
    const result = await exec({ id: '00000000-0000-0000-0000-000000000000' }, {});
    expect(result).toEqual({ error: 'tool_failed' });
  });
});
