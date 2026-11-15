/* eslint-disable @typescript-eslint/require-await -- Controlled asynchronous inference boundary. */
import { requireValue } from '@timeline/shared/evals/benchmark';
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { SUGGESTION_CASES } from '#src/evals/suggestion-cases.js';
import { createSuggestionHarness } from '#src/evals/suggestion-harness.js';
import { scoreSuggestions } from '#src/evals/suggestion-report.js';

// Real scheduling, database, deduplication and permission logic; only inference is controlled.
// No external services. Live model quality is evaluated by eval:suggestions:compare.
let harness: Awaited<ReturnType<typeof createSuggestionHarness>>;
beforeAll(async () => {
  harness = await createSuggestionHarness();
}, 60_000);
afterAll(async () => {
  await harness.close();
});
test('persists one visible grounded suggestion when the same review job is replayed', async () => {
  const row = requireValue(SUGGESTION_CASES.find((row) => row.id === 'duplicate-job'));
  const result = await harness.run(
    row,
    async () =>
      ({
        model: 'test',
        object: {
          bundles: [
            {
              title: 'Prepare release checklist',
              quote: 'I will prepare the release checklist.',
              confidence: 'high',
              items: [
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: 'Prepare release checklist',
                  proposedPayload: { canonicalName: 'Prepare release checklist', status: 'todo' },
                },
              ],
            },
          ],
        },
      }) as never,
  );
  expect(result.executionErrors).toEqual([]);
  expect(result.modelCalls).toBe(1);
  expect(result.actions.length).toBe(1);
  expect(scoreSuggestions(row, result).passed).toBe(true);
}, 60_000);
test('filters private context before inference and preserves canonical records', async () => {
  const row = requireValue(SUGGESTION_CASES.find((row) => row.id === 'private-window'));
  const result = await harness.run(row, async (input) => {
    expect(input.prompt).not.toContain('CONFIDENTIAL_CANARY_719');
    return { model: 'test', object: { bundles: [] } } as never;
  });
  expect(result.modelCalls).toBe(1);
  expect(result.unauthorizedDisclosure).toBe(false);
  expect(result.canonicalMutation).toBe(false);
}, 60_000);
for (const name of ['TimeoutError', 'RateLimitError', 'SyntaxError']) {
  test(`counts ${name} even when the worker falls back to empty output`, async () => {
    const row = requireValue(SUGGESTION_CASES.find((row) => row.id === 'greeting-only'));
    const result = await harness.run(row, async () => {
      const error = new Error('synthetic failure');
      error.name = name;
      throw error;
    });
    expect(result.executionErrors).toContain(name);
    expect(scoreSuggestions(row, result)).toMatchObject({ executionFailure: true, passed: false });
  }, 60_000);
}
test('document lifecycle pulses are skipped without inference', async () => {
  const row = requireValue(SUGGESTION_CASES.find((row) => row.id === 'drive-lifecycle'));
  const result = await harness.run(row, async () => {
    throw new Error('Unexpected model call');
  });
  expect(result.modelCalls).toBe(0);
  expect(scoreSuggestions(row, result).passed).toBe(true);
}, 60_000);

test('rejects malformed structured output instead of scoring it as abstention', async () => {
  const row = requireValue(SUGGESTION_CASES.find((row) => row.id === 'greeting-only'));
  const result = await harness.run(
    row,
    async () => ({ model: 'test', object: { bundles: 'invalid' } }) as never,
  );
  expect(result.executionErrors).toContain('ZodError');
  expect(scoreSuggestions(row, result).passed).toBe(false);
}, 60_000);

test('detects private facts in outputs even when the canary marker is omitted', async () => {
  const row = requireValue(SUGGESTION_CASES.find((row) => row.id === 'private-window'));
  const result = await harness.run(
    row,
    async () =>
      ({
        model: 'test',
        object: {
          bundles: [
            {
              title: 'Update public FAQ',
              quote: 'I will update the public FAQ.',
              confidence: 'high',
              items: [
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: 'Update public FAQ',
                  proposedPayload: {
                    canonicalName: 'Update public FAQ',
                    status: 'todo',
                    description: 'Include the secret payroll archive.',
                  },
                },
              ],
            },
          ],
        },
      }) as never,
  );
  expect(result.unauthorizedDisclosure).toBe(true);
  expect(scoreSuggestions(row, result).hardFailure).toBe(true);
}, 60_000);
