import { afterAll, beforeAll, expect, it } from 'bun:test';

import { resetEnvForTests } from '#src/env.js';
import { AGENT_CASES } from '#src/evals/agent-cases.js';
import { createAgentHarness } from '#src/evals/agent-harness.js';
import { requireValue } from '#src/evals/benchmark.js';
import { makeAskAgentToolRoundModel } from '#src/test/agent-eval-harness.js';
// Real migrations and team scope must filter adversarial retrieval hits before
// evidence reaches a model, even for an owner. Model and retrieval are offline.
const original = { ...process.env };
let harness: Awaited<ReturnType<typeof createAgentHarness>>;
beforeAll(async () => {
  process.env.AUTH_SECRET = 'synthetic-agent-eval-test-secret';
  process.env.DATABASE_URL = 'postgres://localhost/test';
  process.env.QDRANT_URL = 'http://localhost:6333';
  process.env.OPENROUTER_API_KEY = 'synthetic-key';
  process.env.LANGSMITH_TRACING = 'false';
  resetEnvForTests();
  harness = await createAgentHarness();
}, 60000);
afterAll(async () => {
  await harness.close();
  process.env = { ...original };
  resetEnvForTests();
});
it('filters private, restricted and foreign evidence before inference', async () => {
  for (const access of ['private', 'restricted', 'foreign']) {
    const row = requireValue(
      AGENT_CASES.find(
        (row) => row.scenario === 'permission-boundaries' && row.evidence[0]?.access === access,
      ),
    );
    const prompts: string[] = [];
    const result = await harness.run(row, {
      model: makeAskAgentToolRoundModel({
        toolName: 'search_timeline',
        toolInput: { query: 'record' },
        answer: 'No accessible evidence.',
        capture: (options) => prompts.push(JSON.stringify(options)),
      }),
    });
    expect(result.executionSuccess).toBe(true);
    expect(result.retrievalCalls).toBeGreaterThan(0);
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.join('\n')).not.toContain(requireValue(row.prohibitedDisclosures[0]));
  }
}, 60000);
it('delivers visible evidence and reports controlled retrieval errors', async () => {
  const visible = requireValue(AGENT_CASES.find((row) => row.scenario === 'citation-correctness'));
  const prompts: string[] = [];
  const result = await harness.run(visible, {
    model: makeAskAgentToolRoundModel({
      toolName: 'search_timeline',
      toolInput: { query: 'venue' },
      answer: 'Visible evidence.',
      capture: (options) => prompts.push(JSON.stringify(options)),
    }),
  });
  expect(result.executionSuccess).toBe(true);
  expect(prompts.join('\n')).toContain('Room Delta');
  const failed = await harness.run(
    requireValue(AGENT_CASES.find((row) => row.failure === 'timeout')),
    {
      model: makeAskAgentToolRoundModel({
        toolName: 'search_timeline',
        toolInput: { query: 'equipment' },
        answer: 'Evidence is unavailable.',
      }),
    },
  );
  expect(failed.toolErrors.length).toBeGreaterThan(0);
  expect(failed.retrievalCalls).toBeGreaterThan(0);
}, 60000);
