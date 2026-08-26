import { buildAgentTools } from '@timeline/shared/agent';
import { describe, expect, it } from 'vitest';

import type { TeamScope } from '@timeline/shared/team-scope';

import {
  hasExplicitPinMutationIntent,
  omittedNativeToolGroups,
  selectAgentToolGroups,
  selectedNativeToolNames,
} from '@/lib/chat-tool-selection';

const BOARD_ID = '66666666-6666-4666-8666-666666666666';
const BOARD_ITEM_ID = '77777777-7777-4777-8777-777777777777';

describe('chat tool selection', () => {
  it('registers every native agent tool in a dashboard chat group', () => {
    const tools = buildAgentTools({} as TeamScope, { allowPinMutations: true });
    // Empty selection means every group is omitted, which is the full catalog.
    const listed = selectedNativeToolNames(omittedNativeToolGroups([]));
    const unlisted = new Set(['propose_object_change']);
    const built = Object.keys(tools);

    expect(listed).toContain('list_team_members');
    expect(listed.filter((name) => !built.includes(name))).toEqual([]);
    expect(built.filter((name) => !listed.includes(name) && !unlisted.has(name))).toEqual([]);
  });

  it('keeps list_team_members available on ordinary retrieval turns', () => {
    const selection = selectAgentToolGroups({ question: 'What happened last week?' });
    expect(selectedNativeToolNames(selection.groups)).toContain('list_team_members');
  });

  it('exposes member lookup and board mutation tools for assign-by-name', () => {
    const selection = selectAgentToolGroups({
      question: 'assign mikael',
      dashboardContext: {
        pathname: `/app/boards/${BOARD_ID}`,
        routeKind: 'boards',
        boardId: BOARD_ID,
        boardItemId: BOARD_ITEM_ID,
      },
    });
    const names = selectedNativeToolNames(selection.groups);

    expect(names).toContain('list_team_members');
    expect(names).toContain('search_boards');
    expect(names).toContain('execute_board_update_item');
    expect(selection.groups).toEqual(
      expect.arrayContaining(['core', 'guide', 'boards', 'actions', 'objects']),
    );
  });

  it('offers the prompt-named tool for the phrases the system prompt uses', () => {
    const cases: { question: string; tools: string[]; includeMcp?: boolean }[] = [
      { question: "what's scheduled", tools: ['list_calendar_events'] },
      { question: "what's on my calendar", tools: ['list_calendar_events'] },
      { question: 'this meeting is cancelled', tools: ['execute_calendar_cancel'] },
      { question: 'show my pins', tools: ['list_pins'] },
      { question: 'what are my pins?', tools: ['list_pins'] },
      { question: 'search sentry for the outage', tools: ['search_integration_events'] },
      {
        question: 'look up this monday.com item',
        tools: ['search_integration_events'],
        includeMcp: true,
      },
      { question: 'what changed on Acme?', tools: ['recent_changes'] },
      { question: 'where is the onboarding guide?', tools: ['search_documents'] },
      { question: 'use list_calendar_events before answering', tools: ['list_calendar_events'] },
      { question: 'call search_documents for the refund policy', tools: ['search_documents'] },
    ];

    for (const testCase of cases) {
      const selection = selectAgentToolGroups({ question: testCase.question });
      const names = selectedNativeToolNames(selection.groups);
      for (const tool of testCase.tools) {
        expect(names, `${testCase.question} -> ${tool}`).toContain(tool);
      }
      if (testCase.includeMcp) expect(selection.includeMcp).toBe(true);
    }
  });

  it('does not treat a calendar lookup as a mutation', () => {
    const names = selectedNativeToolNames(
      selectAgentToolGroups({ question: "what's scheduled" }).groups,
    );
    expect(names).toContain('list_calendar_events');
    expect(names).not.toContain('execute_calendar_create');
    expect(names).not.toContain('execute_calendar_cancel');
  });

  it('treats unpin as an explicit pin mutation', () => {
    expect(hasExplicitPinMutationIntent('unpin it')).toBe(true);
    expect(hasExplicitPinMutationIntent('show my pins')).toBe(false);
  });
});
