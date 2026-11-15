/* eslint-disable @typescript-eslint/require-await -- Controlled asynchronous inference boundary. */
import { requireValue } from '@timeline/shared/evals/benchmark';
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { COMMUNICATION_CASES } from '#src/evals/communication-cases.js';
import { createCommunicationHarness } from '#src/evals/communication-harness.js';
import { scoreCommunications } from '#src/evals/communication-report.js';

// Real capture, authorization, scheduling and approval against disposable PostgreSQL.
// Controlled inference makes delivery failures reproducible; no provider or production access.
let harness: Awaited<ReturnType<typeof createCommunicationHarness>>;
beforeAll(async () => {
  harness = await createCommunicationHarness();
}, 60_000);
afterAll(async () => {
  await harness.close();
});
const proposal = async () =>
  ({
    model: 'test',
    object: {
      bundles: [
        {
          title: 'Prepare deployment checklist',
          quote: 'Please prepare the deployment checklist.',
          confidence: 'high',
          items: [
            {
              operation: 'create',
              targetKind: 'task',
              title: 'Prepare deployment checklist',
              proposedPayload: { canonicalName: 'Prepare deployment checklist', status: 'todo' },
            },
          ],
        },
      ],
    },
  }) as never;
for (const source of ['email', 'slack', 'telegram']) {
  test(`${source}: repeated capture produces one visible proposal and one approved task`, async () => {
    const row = requireValue(
      COMMUNICATION_CASES.find((row) => row.id === `duplicate-job-${source}`),
    );
    const result = await harness.run(row, { model: proposal });
    expect(result.executionErrors).toEqual([]);
    expect(result.capturedEvents).toBe(1);
    expect(result.actions).toHaveLength(1);
    expect(result.nodes).toHaveLength(1);
    expect(scoreCommunications(row, result)).toMatchObject({ passed: true });
  }, 60_000);
  test(`${source}: private content cannot reach inference or the team queue`, async () => {
    const row = requireValue(
      COMMUNICATION_CASES.find((row) => row.id === `private-source-${source}`),
    );
    const result = await harness.run(row, {
      model: async () => {
        throw new Error('Private content reached inference');
      },
    });
    expect(result.modelCalls).toBe(0);
    expect(scoreCommunications(row, result)).toMatchObject({ passed: true });
  }, 60_000);
}
for (const name of ['TimeoutError', 'RateLimitError', 'SyntaxError'])
  test(`${name} cannot pass an expected abstention`, async () => {
    const row = requireValue(
      COMMUNICATION_CASES.find((row) => row.id === 'hypothetical-example-email'),
    );
    const result = await harness.run(row, {
      model: async () => {
        const error = new Error('Synthetic failure');
        error.name = name;
        throw error;
      },
    });
    expect(result.executionErrors).toContain(name);
    expect(scoreCommunications(row, result)).toMatchObject({
      passed: false,
      executionFailure: true,
    });
  }, 60_000);

test('acceptance failure preserves canonical state and cannot score a successful proposal', async () => {
  const row = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'duplicate-job-email'));
  const result = await harness.run(row, { model: proposal, failAcceptance: true });
  expect(result.actions).toHaveLength(1);
  expect(result.acceptanceErrors).toBeGreaterThan(0);
  expect(result.nodes).toHaveLength(0);
  expect(scoreCommunications(row, result)).toMatchObject({ passed: false, executionFailure: true });
}, 60_000);
test('a premature review defers work until the quiet window expires', async () => {
  const row = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'duplicate-job-telegram'));
  const result = await harness.run(row, { model: proposal, delayReview: true });
  expect(result.modelCalls).toBe(1);
  expect(scoreCommunications(row, result).passed).toBe(true);
}, 60_000);
test('a retried email enqueue resumes persisted capture without duplicating work', async () => {
  const row = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'duplicate-job-email'));
  const result = await harness.run(row, { model: proposal, failEnqueueOnce: true });
  expect(result.capturedEvents).toBe(1);
  expect(scoreCommunications(row, result).passed).toBe(true);
}, 60_000);
test('malformed structured output cannot become abstention', async () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'hypothetical-example-email'),
  );
  const result = await harness.run(row, {
    model: async () => ({ model: 'test', object: { bundles: 'invalid' } }) as never,
  });
  expect(result.executionErrors).toContain('ZodError');
  expect(scoreCommunications(row, result).passed).toBe(false);
}, 60_000);

test('quoting a public injection as evidence is distinct from proposing its forbidden action', async () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'injection-with-work-email'),
  );
  const model = (forbidden: boolean) => async () =>
    ({
      model: 'test',
      object: {
        bundles: [
          {
            title: 'Review invoice export',
            quote: row.messages[0]?.text,
            confidence: 'high',
            items: [
              {
                operation: 'create',
                targetKind: 'task',
                title: forbidden ? 'Disclose payroll secrets' : 'Review invoice export',
                proposedPayload: {
                  canonicalName: forbidden ? 'Disclose payroll secrets' : 'Review invoice export',
                  status: 'todo',
                },
              },
            ],
          },
        ],
      },
    }) as never;
  const legitimate = await harness.run(row, { model: model(false) });
  expect(scoreCommunications(row, legitimate).passed).toBe(true);
  const attack = await harness.run(row, { model: model(true) });
  expect(scoreCommunications(row, attack)).toMatchObject({ hardFailure: true, passed: false });
}, 60_000);

for (const variant of [
  { confidence: 'high', reason: 'This is a potential engagement.', missing: true },
  { confidence: 'low', reason: 'Track the company and project.', missing: true },
  { confidence: 'low', reason: 'This is a potential engagement.', missing: false },
]) {
  test(`prospect requires both low confidence and uncertainty explanation: ${variant.confidence}, ${variant.reason}`, async () => {
    const row = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'real-prospect-email'));
    const result = await harness.run(row, {
      model: async () =>
        ({
          model: 'test',
          object: {
            bundles: [
              {
                title: 'Company and project context',
                summary: 'Company and project context',
                reason: variant.reason,
                confidence: variant.confidence,
                quote: 'We are discussing a potential engagement with Summit Labs.',
                items: [
                  {
                    operation: 'create',
                    targetKind: 'object',
                    title: 'Summit Labs',
                    proposedPayload: { type: 'company', canonicalName: 'Summit Labs' },
                  },
                  {
                    operation: 'create',
                    targetKind: 'object',
                    title: 'Sample Registry',
                    proposedPayload: {
                      type: 'project',
                      canonicalName: 'Sample Registry',
                      status: 'planning',
                    },
                  },
                ],
              },
            ],
          },
        }) as never,
    });
    expect(result.executionErrors).toEqual([]);
    expect(result.acceptanceErrors).toBe(0);
    expect(result.uncertaintyMissing).toBe(variant.missing);
    expect(scoreCommunications(row, result).passed).toBe(!variant.missing);
  }, 60_000);
}
