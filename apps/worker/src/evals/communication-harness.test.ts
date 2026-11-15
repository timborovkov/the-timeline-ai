/* eslint-disable @typescript-eslint/require-await -- Controlled asynchronous inference boundary. */
import { requireValue } from '@timeline/shared/evals/benchmark';
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { COMMUNICATION_CASES } from '#src/evals/communication-cases.js';
import { createCommunicationHarness } from '#src/evals/communication-harness.js';
import { scoreCommunications } from '#src/evals/communication-report.js';
import { communicationId } from '#src/evals/communication-types.js';

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

for (const source of ['email', 'slack', 'telegram']) {
  test(`${source}: nullable optional inference fields do not block approval`, async () => {
    const row = requireValue(
      COMMUNICATION_CASES.find((row) => row.id === `duplicate-job-${source}`),
    );
    const result = await harness.run(row, {
      model: async () => {
        const output = (await proposal()) as unknown as {
          object: { bundles: { items: { proposedPayload: Record<string, unknown> }[] }[] };
        };
        Object.assign(
          requireValue(requireValue(output.object.bundles[0]).items[0]).proposedPayload,
          {
            status: null,
            type: null,
            createProjectName: null,
            projectName: null,
          },
        );
        return output as never;
      },
    });
    expect(result.acceptanceFailureReasons).toEqual([]);
    expect(scoreCommunications(row, result).passed).toBe(true);
  }, 60_000);
  test(`${source}: uniquely mentioned pending task receives project context from new evidence`, async () => {
    const row = requireValue(
      COMMUNICATION_CASES.find((row) => row.id === `pending-task-reuse-${source}`),
    );
    const result = await harness.run(row, {
      model: async () => ({ model: 'test', object: { bundles: [] } }) as never,
    });
    expect(result.acceptanceFailureReasons).toEqual([]);
    expect(scoreCommunications(row, result).passed).toBe(true);
  }, 60_000);
}

test('email replies are reviewed together before proposing a lifecycle change', async () => {
  const base = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'duplicate-job-email'));
  const row = {
    ...base,
    messages: [
      { text: 'Prepare deployment checklist is blocked on access.' },
      { text: 'Access restored; we resumed the deployment checklist.' },
    ],
    outcome: { nodes: [], edges: [] },
  };
  const packets: string[] = [];
  const result = await harness.run(row, {
    model: async (args) => {
      packets.push(JSON.stringify(args));
      return { model: 'test', object: { bundles: [] } } as never;
    },
  });
  expect(result.executionErrors).toEqual([]);
  expect(packets).toHaveLength(1);
  expect(packets[0]).toContain('blocked on access');
  expect(packets[0]).toContain('Access restored');
}, 60_000);

for (const source of ['email', 'slack', 'telegram']) {
  test(`${source}: automatic attachment preserves a human-edited pending task`, async () => {
    const row = requireValue(
      COMMUNICATION_CASES.find((row) => row.id === `human-edited-pending-${source}`),
    );
    const result = await harness.run(row, {
      model: async () => ({ model: 'test', object: { bundles: [] } }) as never,
    });
    expect(result.protectedPendingChanged).toBe(false);
    expect(scoreCommunications(row, result).passed).toBe(true);
  }, 60_000);
  test(`${source}: unrelated project mentions cannot attach a pending task`, async () => {
    const base = requireValue(
      COMMUNICATION_CASES.find((row) => row.id === `pending-task-reuse-${source}`),
    );
    const row = {
      ...base,
      messages: [{ text: 'Prepare migration checklist is unrelated to Patient Portal.' }],
      outcome: { ...base.outcome, edges: [] },
    };
    const result = await harness.run(row, {
      model: async () => ({ model: 'test', object: { bundles: [] } }) as never,
    });
    expect(result.edges).toEqual([]);
    expect(scoreCommunications(row, result).passed).toBe(true);
  }, 60_000);
}

test('approval preserves two distinct deliverables under the same project', async () => {
  const row = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'two-deliverables-slack'));
  const result = await harness.run(row, {
    model: async () =>
      ({
        model: 'test',
        object: {
          bundles: [
            {
              title: 'Patient Portal deliverables',
              confidence: 'high',
              quote: row.messages[0]?.text,
              items: ['Prepare migration checklist', 'Review backup procedure'].map((name) => ({
                operation: 'create',
                targetKind: 'task',
                title: `${name} for Patient Portal`,
                description:
                  'Patient Portal needs a migration checklist and backup procedure review.',
                proposedPayload: {
                  canonicalName: `${name} for Patient Portal`,
                  status: 'todo',
                  projectName: 'Patient Portal',
                  parentName: 'Patient Portal',
                  parentObjectId: '85c4c0bf-4e72-467b-88d7-7fcbe27ea731',
                },
              })),
            },
          ],
        },
      }) as never,
  });
  expect(result.acceptanceFailureReasons).toEqual([]);
  expect(
    result.approvalOutcomes
      ?.sort((left, right) => left.title.localeCompare(right.title))
      .map((item) => ({
        title: item.title,
        status: item.status,
        reason: item.reason,
      })),
  ).toEqual([
    { title: 'Prepare migration checklist for Patient Portal', status: 'accepted', reason: null },
    { title: 'Review backup procedure for Patient Portal', status: 'accepted', reason: null },
  ]);
  expect(result.nodes.filter((node) => node.type === 'task')).toHaveLength(2);
  expect(scoreCommunications(row, result).passed).toBe(true);
}, 60_000);

for (const source of ['email', 'slack', 'telegram']) {
  test(`${source}: a corrected deadline leaves only the latest actionable approval`, async () => {
    const row = requireValue(
      COMMUNICATION_CASES.find((row) => row.id === `pending-deadline-correction-${source}`),
    );
    let calls = 0;
    const result = await harness.run(row, {
      model: async () => {
        const dueAt = ++calls === 1 ? '2026-06-10T15:00:00.000Z' : '2026-06-12T09:00:00.000Z';
        return {
          model: 'test',
          object: {
            bundles: [
              {
                title: 'Update checklist deadline',
                confidence: 'high',
                items: [
                  {
                    operation: 'update',
                    targetKind: 'task',
                    targetId: communicationId(row.familyId, 'task'),
                    title: 'Prepare migration checklist',
                    proposedPayload: { dueAt },
                  },
                ],
              },
            ],
          },
        } as never;
      },
    });
    expect(result.executionErrors).toEqual([]);
    expect(result.actions).toHaveLength(1);
    expect(scoreCommunications(row, result).passed).toBe(true);
  }, 60_000);
}

for (const source of ['email', 'slack', 'telegram']) {
  test(`${source}: neutral co-mentions do not attach unrelated pending work`, async () => {
    const base = requireValue(
      COMMUNICATION_CASES.find((row) => row.id === `pending-task-reuse-${source}`),
    );
    const row = {
      ...base,
      messages: [
        {
          text: 'Prepare migration checklist is waiting. Separately, Patient Portal launches tomorrow.',
        },
      ],
      outcome: { ...base.outcome, edges: [] },
    };
    const result = await harness.run(row, {
      model: async () => ({ model: 'test', object: { bundles: [] } }) as never,
    });
    expect(result.edges).toEqual([]);
    expect(scoreCommunications(row, result).passed).toBe(true);
  }, 60_000);
}

for (const privateRoot of [false, true]) {
  test(`delayed email reply reserves only an authorized thread root: private=${privateRoot}`, async () => {
    const base = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'duplicate-job-email'));
    const row = {
      ...base,
      messages: [
        { text: 'ORIGINAL-REQUEST-917: prepare deployment checklist.', private: privateRoot },
        { text: 'Please go ahead with that request.', offsetMinutes: 7 * 24 * 60 },
      ],
      outcome: { nodes: [], edges: [] },
    };
    const packets: string[] = [];
    const result = await harness.run(row, {
      model: async (args) => {
        packets.push(args.prompt);
        return { model: 'test', object: { bundles: [] } } as never;
      },
    });
    expect(result.executionErrors).toEqual([]);
    expect(packets).toHaveLength(1);
    expect(packets[0]?.includes('ORIGINAL-REQUEST-917')).toBe(!privateRoot);
    expect(result.unauthorizedDisclosure).toBe(false);
  }, 60_000);
}

for (const text of [
  'Is Prepare migration checklist for Patient Portal?',
  'If Prepare migration checklist is for Patient Portal, ask Alice first.',
]) {
  test(`unconfirmed association cannot amend a pending task: ${text}`, async () => {
    const base = requireValue(
      COMMUNICATION_CASES.find((row) => row.id === 'pending-task-reuse-email'),
    );
    const row = { ...base, messages: [{ text }], outcome: { ...base.outcome, edges: [] } };
    const result = await harness.run(row, {
      model: async () => ({ model: 'test', object: { bundles: [] } }) as never,
    });
    expect(result.edges).toEqual([]);
  }, 60_000);
}

test('explicit per-task project routing survives a multi-project message', async () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'two-project-routing-email'),
  );
  const result = await harness.run(row, {
    model: async () =>
      ({
        model: 'test',
        object: {
          bundles: [
            {
              title: 'Two project deliverables',
              confidence: 'high',
              items: [
                ['Write schema migration', 'Records Gateway', 'project'],
                ['Test password recovery', 'Staff Console', 'second-project'],
              ].map(([name, projectName, key]) => ({
                operation: 'create',
                targetKind: 'task',
                title: name,
                proposedPayload: {
                  canonicalName: name,
                  status: 'todo',
                  projectName,
                  parentObjectId: communicationId(row.familyId, requireValue(key)),
                },
              })),
            },
          ],
        },
      }) as never,
  });
  expect(scoreCommunications(row, result).passed).toBe(true);
}, 60_000);

test('similar deliverables for different customers remain distinct approvals', async () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'distinct-client-same-deliverable-email'),
  );
  const result = await harness.run(row, {
    model: async () =>
      ({
        model: 'test',
        object: {
          bundles: [
            {
              title: 'Customer checklists',
              confidence: 'high',
              items: [
                ['River Clinic', 'river', 'company'],
                ['Mountain Clinic', 'mountain', 'second-company'],
              ].flatMap(([name, ref, key]) => [
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: `Prepare onboarding checklist for ${name}`,
                  proposedPayload: {
                    canonicalName: `Prepare onboarding checklist for ${name}`,
                    status: 'todo',
                    localRef: ref,
                  },
                },
                {
                  operation: 'create',
                  targetKind: 'object_relationship',
                  title: `Link checklist to ${name}`,
                  proposedPayload: {
                    kind: 'related',
                    fromRef: ref,
                    toEntityId: communicationId(row.familyId, requireValue(key)),
                  },
                },
              ]),
            },
          ],
        },
      }) as never,
  });
  expect(scoreCommunications(row, result).passed).toBe(true);
}, 60_000);

test('explicit completion of one named task is not suppressed by another open task', async () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'partial-completion-separated-email'),
  );
  const result = await harness.run(row, {
    model: async () =>
      ({
        model: 'test',
        object: {
          bundles: [
            {
              title: 'Access review completed',
              confidence: 'high',
              items: [
                {
                  operation: 'update',
                  targetKind: 'task',
                  targetId: communicationId(row.familyId, 'task'),
                  title: 'Review access matrix',
                  proposedPayload: { status: 'done' },
                },
              ],
            },
          ],
        },
      }) as never,
  });
  expect(scoreCommunications(row, result).passed).toBe(true);
}, 60_000);
