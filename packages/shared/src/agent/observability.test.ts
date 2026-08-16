import { describe, expect, it } from 'vitest';

import type { ToolSet } from 'ai';

import { instrumentAgentTools, summarizeAgentToolObservations } from '#src/agent/observability.js';

const EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DOCUMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CHUNK_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

type TestToolExecute = (input: unknown, options: unknown) => Promise<unknown>;

describe('agent tool observability', () => {
  it('records result counts, retrieval recipes, artifact refs, and warning codes', async () => {
    const observations: unknown[] = [];
    const tools = instrumentAgentTools(
      {
        search_timeline: {
          description: 'Search timeline',
          execute: () =>
            Promise.resolve({
              results: [
                {
                  citation: `[ev:${EVENT_ID}]`,
                  related: `[doc:${DOCUMENT_ID}#v2:chunk:${CHUNK_ID}]`,
                  warning: 'partial_index',
                },
              ],
            }),
        },
      } as unknown as ToolSet,
      (observation) => observations.push(observation),
    );

    const execute = tools.search_timeline?.execute as TestToolExecute;
    await execute(
      { query: 'Northstar risk', source: 'email' },
      { toolCallId: 'call-1', messages: [] },
    );

    expect(observations).toEqual([
      expect.objectContaining({
        tool: 'search_timeline',
        group: 'timeline',
        ok: true,
        inputKeys: ['query', 'source'],
        retrievalRecipe: {
          hasQuery: true,
          filters: ['source'],
          limit: null,
          lookupKind: null,
        },
        resultCount: 1,
        topArtifactRefs: [
          { kind: 'timeline_event', id: EVENT_ID },
          {
            kind: 'document_chunk',
            id: CHUNK_ID,
            documentId: DOCUMENT_ID,
            version: 2,
            chunkId: CHUNK_ID,
          },
        ],
        warningCodes: ['warning:partial_index'],
      }),
    ]);

    expect(
      summarizeAgentToolObservations({
        observations: observations as never,
        selection: {
          selectedToolGroups: ['core'],
          omittedToolGroups: ['documents'],
          selectedNativeToolCount: 1,
          omittedNativeToolCount: 2,
          mcpToolCount: 0,
          mcpDiscoverySkipped: true,
        },
      }),
    ).toEqual({
      toolObservations: observations,
      selection: {
        selectedToolGroups: ['core'],
        omittedToolGroups: ['documents'],
        selectedNativeToolCount: 1,
        omittedNativeToolCount: 2,
        mcpToolCount: 0,
        mcpDiscoverySkipped: true,
      },
      totalResultCount: 1,
      topArtifactRefs: [
        { kind: 'timeline_event', id: EVENT_ID },
        {
          kind: 'document_chunk',
          id: CHUNK_ID,
          documentId: DOCUMENT_ID,
          version: 2,
          chunkId: CHUNK_ID,
        },
      ],
      proposalIds: [],
      warningCodes: ['warning:partial_index'],
    });
  });

  it('reports proposal ids created by proposal tools', async () => {
    const observations: Parameters<typeof summarizeAgentToolObservations>[0]['observations'] = [];
    const tools = instrumentAgentTools(
      {
        suggest_task: {
          execute: () => Promise.resolve({ ok: true, id: 'proposal-1' }),
        },
      } as unknown as ToolSet,
      (observation) => observations.push(observation),
    );

    const execute = tools.suggest_task?.execute as TestToolExecute;
    await execute({ title: 'Follow up' }, { toolCallId: 'call-1', messages: [] });

    expect(summarizeAgentToolObservations({ observations }).proposalIds).toEqual(['proposal-1']);
  });

  it('marks failed tool results without throwing away the original output', async () => {
    const observations: unknown[] = [];
    const tools = instrumentAgentTools(
      {
        mcp__server__get_health: {
          description: 'Custom tool',
          execute: () => Promise.resolve({ ok: false, error: 'needs_reauth' }),
        },
      } as unknown as ToolSet,
      (observation) => observations.push(observation),
    );

    const execute = tools.mcp__server__get_health?.execute as TestToolExecute;
    await expect(execute({}, { toolCallId: 'call-1', messages: [] })).resolves.toEqual({
      ok: false,
      error: 'needs_reauth',
    });
    expect(observations).toEqual([
      expect.objectContaining({
        tool: 'mcp__server__get_health',
        group: 'mcp',
        ok: false,
        resultCount: null,
        warningCodes: ['error:needs_reauth'],
      }),
    ]);
  });
});
