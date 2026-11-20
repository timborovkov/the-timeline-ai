// A cited answer cannot be shared when the tool payload includes other restricted context.
import { expect } from '@timeline/test-support';
import type { UIMessage } from 'ai';
import { it } from 'bun:test';

import { handoffProvenance } from '@/lib/handoff-provenance';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const citation = `[ev:${id}]`;

function answer(output: unknown): UIMessage {
  return {
    id: 'assistant',
    role: 'assistant',
    parts: [
      {
        type: 'tool-search_timeline',
        state: 'output-available',
        toolCallId: 'search',
        input: {},
        output,
      },
      { type: 'text', text: `Project status. ${citation}` },
    ],
  };
}

it('allows a fresh answer backed by individually authorized event references', () => {
  expect(handoffProvenance(answer({ results: [{ citation }] }), true)).toEqual([
    { kind: 'timeline_event', id },
  ]);
  expect(handoffProvenance(answer({ results: [{ citation }] }), false)).toBeNull();
});

it('rejects private board context that has no access reference', () => {
  expect(
    handoffProvenance(
      answer({
        results: [
          { citation, evidenceContext: { currentBoardItems: [{ notes: 'Restricted details' }] } },
        ],
      }),
      true,
    ),
  ).toBeNull();
});

it('rejects proposal details nested in a timeline result without individual references', () => {
  expect(
    handoffProvenance(
      answer({
        results: [
          { citation, context: { objects: [{ pending: [{ title: 'Restricted proposal' }] }] } },
        ],
      }),
      true,
    ),
  ).toBeNull();
});
