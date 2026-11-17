/* eslint-disable @typescript-eslint/require-await -- Controlled asynchronous inference boundary. */
import { requireValue } from '@timeline/shared/evals/benchmark';
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { COMMUNICATION_CASES } from '#src/evals/communication-cases.js';
import { createCommunicationHarness } from '#src/evals/communication-harness.js';
import { scoreCommunications } from '#src/evals/communication-report.js';
import { communicationId } from '#src/evals/communication-types.js';
import { controlledCommunicationAudit } from '#src/test/communication-audit.js';

// Real capture, authorization, scheduling and approval against disposable PostgreSQL.
// Controlled inference makes delivery failures reproducible; no provider or production access.
let harness: Awaited<ReturnType<typeof createCommunicationHarness>>;
beforeAll(async () => {
  harness = await createCommunicationHarness();
}, 60_000);
afterAll(async () => {
  await harness.close();
});
function supportFromPacket(
  prompt: string,
  quote: string,
  field: 'dueAt' | 'status' | 'customer' | 'project' | 'assignee',
  subject: string,
  value: string,
) {
  for (const match of prompt.matchAll(
    /<external_content[^>]*event_id="([^"]+)"[^>]*>([\s\S]*?)<\/external_content>/g,
  )) {
    if (match[2]?.includes(quote))
      return { field, subject, value, quote, rawEventId: requireValue(match[1]) };
  }
  throw new Error('Expected source quote missing from packet');
}
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
              grounding: [],
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
  expect(result.modelCalls).toBe(2);
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
                grounding: [],
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
                    grounding: [],
                    targetKind: 'object',
                    title: 'Summit Labs',
                    proposedPayload: { type: 'company', canonicalName: 'Summit Labs' },
                  },
                  {
                    operation: 'create',
                    grounding: [],
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
      model: async (input) => {
        expect(input.prompt).toContain('human_edited=true');
        return { model: 'test', object: { bundles: [] } } as never;
      },
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
                grounding: [],
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
      model: async (args) => {
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
                    grounding: [
                      supportFromPacket(
                        args.prompt,
                        requireValue(row.messages[Math.min(calls - 1, 1)]).text,
                        'dueAt',
                        'Prepare migration checklist',
                        dueAt,
                      ),
                    ],
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
    model: async (args) =>
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
                grounding: [
                  supportFromPacket(
                    args.prompt,
                    requireValue(row.messages[0]).text,
                    'project',
                    requireValue(name),
                    communicationId(row.familyId, requireValue(key)),
                  ),
                ],
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
    model: async (args) =>
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
                  grounding: [
                    supportFromPacket(
                      args.prompt,
                      requireValue(row.messages[0]).text,
                      'customer',
                      `Prepare onboarding checklist for ${name}`,
                      communicationId(row.familyId, requireValue(key)),
                    ),
                  ],
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
                  grounding: [
                    supportFromPacket(
                      args.prompt,
                      requireValue(row.messages[0]).text,
                      'customer',
                      `Prepare onboarding checklist for ${name}`,
                      communicationId(row.familyId, requireValue(key)),
                    ),
                  ],
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
    model: async (args) =>
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
                  grounding: [
                    supportFromPacket(
                      args.prompt,
                      'Access matrix review is finished.',
                      'status',
                      'Review access matrix',
                      'done',
                    ),
                  ],
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

test('omitted human extraction confidence is an execution failure, never medium success', async () => {
  const row = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'duplicate-job-email'));
  const result = await harness.run(row, {
    model: async () =>
      ({
        model: 'test',
        object: {
          bundles: [
            {
              title: 'Checklist',
              items: [
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: 'Prepare deployment checklist',
                  grounding: [],
                  proposedPayload: { canonicalName: 'Prepare deployment checklist' },
                },
              ],
            },
          ],
        },
      }) as never,
  });
  expect(result.executionErrors.length).toBeGreaterThan(0);
  expect(scoreCommunications(row, result).passed).toBe(false);
}, 60_000);

for (const [name, items] of [
  ['empty proposed bundle', []],
  [
    'typeless object create',
    [
      {
        operation: 'create',
        targetKind: 'object',
        title: 'Portal',
        proposedPayload: { canonicalName: 'Portal' },
        grounding: [],
      },
    ],
  ],
  [
    'local reference passed as existing UUID',
    [
      {
        operation: 'create',
        targetKind: 'object_relationship',
        title: 'Customer link',
        proposedPayload: { fromEntityId: 'new-project', toEntityId: 'customer', kind: 'related' },
        grounding: [],
      },
    ],
  ],
] as const) {
  test(`${name} is an inference failure, not successful abstention`, async () => {
    const row = requireValue(
      COMMUNICATION_CASES.find((row) => row.id === 'hypothetical-example-email'),
    );
    const result = await harness.run(row, {
      model: async () =>
        ({
          model: 'test',
          object: { bundles: [{ title: 'Proposed work', confidence: 'high', items }] },
        }) as never,
    });
    expect(result.executionErrors.length).toBeGreaterThan(0);
    expect(scoreCommunications(row, result).passed).toBe(false);
  }, 60_000);
}

for (const source of ['email', 'slack', 'telegram']) {
  test(`${source}: completeness check restores a task omitted by extraction`, async () => {
    const row = requireValue(
      COMMUNICATION_CASES.find((row) => row.id === `duplicate-job-${source}`),
    );
    const result = await harness.run(row, {
      model: async () => ({ model: 'test', object: { bundles: [] } }) as never,
      auditModel: async (args) => {
        const evidence = supportFromPacket(
          args.prompt,
          requireValue(row.messages[0]).text,
          'status',
          'Prepare deployment checklist',
          'todo',
        );
        expect(args.prompt).toContain(
          'COVERAGE_QUOTE_OPTIONS\n<external_content source="communication-coverage-quotes"',
        );
        const quoteOptions = JSON.parse(
          requireValue(args.prompt.split('COVERAGE_QUOTE_OPTIONS\n')[1])
            .split('\nEND_COVERAGE_QUOTE_OPTIONS')[0]
            ?.replace(/^<external_content[^>]*>/u, '')
            .replace(/<\/external_content>$/u, '') ?? '{}',
        ) as Record<string, string>;
        const quoteRef = requireValue(
          Object.entries(quoteOptions).find(([, quote]) => quote === evidence.quote)?.[0],
        );
        return {
          model: 'checked',
          object: {
            bundles: [
              {
                title: 'Deployment checklist',
                confidence: 'high',
                items: [
                  {
                    coverage: {
                      kind: 'task',
                      evidence: [
                        {
                          rawEventId: evidence.rawEventId,
                          quote: quoteRef,
                        },
                      ],
                      reason: 'The explicit task request was missing from the draft.',
                    },
                    operation: 'create',
                    targetKind: 'task',
                    title: 'Prepare deployment checklist',
                    grounding: [],
                    proposedPayload: { canonicalName: 'Prepare deployment checklist' },
                  },
                ],
              },
            ],
            pendingAmendments: [],
            coverage: [],
          },
        } as never;
      },
    });
    expect(result.modelCalls).toBe(2);
    expect(result.executionErrors).toEqual([]);
    expect(scoreCommunications(row, result).passed).toBe(true);
  }, 60_000);
}

for (const failure of [
  'timeout',
  'malformed',
  'missing-item-coverage',
  'removed-grounding',
  'unknown-source',
  'fabricated-quote',
  'empty-existing',
]) {
  test(`completeness ${failure} cannot publish a partial result`, async () => {
    const row = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'duplicate-job-email'));
    const result = await harness.run(row, {
      model: proposal,
      auditModel: async (args) => {
        if (failure === 'timeout') throw new Error('Synthetic audit timeout');
        if (failure === 'malformed') return { model: 'test', object: { bundles: [] } } as never;
        const evidence = supportFromPacket(
          args.prompt,
          requireValue(row.messages[0]).text,
          'status',
          'Prepare deployment checklist',
          'done',
        );
        return {
          model: 'test',
          object: {
            bundles: [
              {
                title: 'Checklist',
                confidence: 'high',
                items: [
                  {
                    ...(failure === 'missing-item-coverage'
                      ? {}
                      : {
                          coverage: {
                            kind: 'task',
                            evidence: [
                              {
                                rawEventId:
                                  failure === 'unknown-source'
                                    ? '99999999-9999-4999-8999-999999999999'
                                    : evidence.rawEventId,
                                quote:
                                  failure === 'fabricated-quote'
                                    ? 'A fabricated statement never present in the source.'
                                    : evidence.quote,
                              },
                            ],
                            reason: 'Controlled invalid check.',
                          },
                        }),
                    operation: 'create',
                    targetKind: 'task',
                    title: 'Prepare deployment checklist',
                    grounding: [],
                    proposedPayload: {
                      canonicalName: 'Prepare deployment checklist',
                      ...(failure === 'removed-grounding' ? { status: 'done' } : {}),
                    },
                  },
                ],
              },
            ],
            pendingAmendments: [],
            coverage:
              failure === 'empty-existing'
                ? [
                    {
                      kind: 'task',
                      disposition: 'existing',
                      existingIds: [],
                      evidence: [{ rawEventId: evidence.rawEventId, quote: evidence.quote }],
                      reason: 'Invalid empty existing disposition.',
                    },
                  ]
                : [],
          },
        } as never;
      },
    });
    expect(result.executionErrors.length).toBeGreaterThan(0);
    expect(result.actions).toEqual([]);
    expect(result.nodes).toEqual([]);
    expect(scoreCommunications(row, result).passed).toBe(false);
  }, 60_000);
}

test('failed checks exhaust the bounded attempts without proposals', async () => {
  const base = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'duplicate-job-email'));
  const row = {
    ...base,
    messages: base.messages.map((message) => ({ ...message, replay: false })),
  };
  let checks = 0;
  const result = await harness.run(row, {
    model: proposal,
    jobAttempts: 3,
    auditModel: async () => {
      checks++;
      throw new Error('Synthetic check unavailable');
    },
  });
  expect(checks).toBe(3);
  expect(result.actions).toEqual([]);
  expect(result.nodes).toEqual([]);
  expect(scoreCommunications(row, result).passed).toBe(false);
}, 60_000);

test('checked no-action cannot be overridden by commitment fallback', async () => {
  const base = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'duplicate-job-email'));
  const row = {
    ...base,
    messages: [{ text: 'We decided to use a weekly check-in.' }],
    outcome: { nodes: [], edges: [] },
  };
  const result = await harness.run(row, {
    model: async () => ({ model: 'test', object: { bundles: [] } }) as never,
  });
  expect(result.executionErrors).toEqual([]);
  expect(result.actions).toEqual([]);
}, 60_000);

test('normalization cannot silently remove an audited item and publish the rest', async () => {
  const row = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'duplicate-job-email'));
  const result = await harness.run(row, {
    model: async () =>
      ({
        model: 'test',
        object: {
          bundles: [
            {
              title: 'Checklist and incidental tool',
              confidence: 'high',
              items: [
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: 'Prepare deployment checklist',
                  proposedPayload: { canonicalName: 'Prepare deployment checklist' },
                  grounding: [],
                },
                {
                  operation: 'create',
                  targetKind: 'object',
                  title: 'GitHub',
                  proposedPayload: { type: 'company', canonicalName: 'GitHub' },
                  grounding: [],
                },
              ],
            },
          ],
        },
      }) as never,
  });
  expect(result.executionErrors.length).toBeGreaterThan(0);
  expect(result.actions).toEqual([]);
}, 60_000);

test('checked no-action can decline a prepared pending-task amendment', async () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'pending-task-reuse-email'),
  );
  let candidatesSeen = false;
  const result = await harness.run(row, {
    model: async () => ({ model: 'test', object: { bundles: [] } }) as never,
    auditModel: async (input) => {
      const checked = await controlledCommunicationAudit(input);
      const object = checked.object as {
        bundles: unknown[];
        pendingAmendments: {
          id: string;
          coverage: {
            kind: string;
            evidence: { rawEventId: string; quote: string }[];
            reason: string;
          };
        }[];
        coverage: unknown[];
      };
      candidatesSeen ||= object.pendingAmendments.length > 0;
      object.coverage = object.pendingAmendments.map((candidate) => ({
        ...candidate.coverage,
        disposition: 'no_action',
        existingIds: [],
        reason: 'Controlled rejection of a pending amendment.',
      }));
      object.pendingAmendments = [];
      return checked;
    },
  });
  expect(candidatesSeen).toBe(true);
  expect(result.executionErrors).toEqual([]);
  expect(result.edges).toEqual([]);
}, 60_000);

test('overlapping pending amendment cannot overwrite a checked correction', async () => {
  const base = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'pending-task-reuse-email'),
  );
  const row = {
    ...base,
    messages: [
      {
        text: 'Prepare migration checklist is for Patient Portal. Prepare migration checklist is due June 12, 2026 at 09:00 UTC.',
      },
    ],
  };
  const result = await harness.run(row, {
    model: async (input) =>
      ({
        model: 'test',
        object: {
          bundles: [
            {
              title: 'Prepare migration checklist',
              confidence: 'high',
              items: [
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: 'Prepare migration checklist',
                  proposedPayload: {
                    canonicalName: 'Prepare migration checklist',
                    dueAt: '2026-06-12T09:00:00Z',
                  },
                  grounding: [
                    supportFromPacket(
                      input.prompt,
                      'Prepare migration checklist is due June 12, 2026 at 09:00 UTC.',
                      'dueAt',
                      'Prepare migration checklist',
                      '2026-06-12T09:00:00Z',
                    ),
                  ],
                },
              ],
            },
          ],
        },
      }) as never,
  });
  expect(result.executionErrors.length).toBeGreaterThan(0);
  expect(result.edges).toEqual([]);
  expect(
    result.nodes.find((node) => node.name === 'Prepare migration checklist')?.dueAt,
  ).toBeNull();
}, 60_000);

test('task cancellation survives approval as a cancelled record', async () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'correction-after-delay-slack'),
  );
  const quote = requireValue(row.messages[1]).text;
  const result = await harness.run(row, {
    model: async (input) =>
      ({
        model: 'test',
        object: {
          bundles: [
            {
              title: 'Cancel launch announcement',
              confidence: 'high',
              quote,
              items: [
                {
                  operation: 'archive_or_cancel',
                  targetKind: 'task',
                  targetId: communicationId(row.familyId, 'task'),
                  title: 'Cancel Prepare launch announcement',
                  proposedPayload: { status: 'cancelled' },
                  grounding: [
                    supportFromPacket(
                      input.prompt,
                      quote,
                      'status',
                      'Prepare launch announcement',
                      'cancelled',
                    ),
                  ],
                },
              ],
            },
          ],
        },
      }) as never,
  });
  expect(result.executionErrors).toEqual([]);
  expect(result.acceptanceErrors).toBe(0);
  expect(scoreCommunications(row, result).passed).toBe(true);
}, 60_000);

test('known customer UUID in a reference field survives normalization and real approval', async () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'account-alias-link-email'),
  );
  const quote = requireValue(row.messages[0]).text;
  const result = await harness.run(row, {
    model: async (input) =>
      ({
        model: 'test',
        object: {
          bundles: [
            {
              title: 'Compliance checklist',
              confidence: 'high',
              quote,
              items: [
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: 'Prepare Northwind Medical compliance checklist',
                  proposedPayload: {
                    localRef: 'checklist',
                    canonicalName: 'Prepare Northwind Medical compliance checklist',
                  },
                  grounding: [],
                },
                {
                  operation: 'create',
                  targetKind: 'object_relationship',
                  title: 'Link checklist to customer',
                  proposedPayload: {
                    fromRef: 'checklist',
                    toRef: communicationId(row.familyId, 'company'),
                    kind: 'related',
                  },
                  grounding: [
                    supportFromPacket(
                      input.prompt,
                      quote,
                      'customer',
                      'Prepare Northwind Medical compliance checklist',
                      'Northwind Medical',
                    ),
                  ],
                },
              ],
            },
          ],
        },
      }) as never,
  });
  expect(result.executionErrors).toEqual([]);
  expect(scoreCommunications(row, result).passed).toBe(true);
}, 60_000);

test('verified named owner survives approval when the checker omits its payload field', async () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'explicit-assignment-telegram'),
  );
  const quote = requireValue(row.messages[0]).text;
  const result = await harness.run(row, {
    model: async (input) =>
      ({
        model: 'test',
        object: {
          bundles: [
            {
              title: 'Vendor checklist',
              confidence: 'high',
              quote,
              items: [
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: 'Prepare vendor checklist',
                  proposedPayload: { canonicalName: 'Prepare vendor checklist' },
                  grounding: [
                    supportFromPacket(
                      input.prompt,
                      quote,
                      'assignee',
                      'Prepare vendor checklist',
                      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                    ),
                  ],
                },
              ],
            },
          ],
        },
      }) as never,
  });
  expect(result.executionErrors).toEqual([]);
  expect(scoreCommunications(row, result).passed).toBe(true);
}, 60_000);

test('per-task project grounding can name its known endpoint without losing separate routing', async () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'two-project-routing-telegram'),
  );
  const quotes = [
    'For Records Gateway, please write the schema migration.',
    'Separately, for Staff Console, please test password recovery.',
  ];
  const result = await harness.run(row, {
    model: async (input) =>
      ({
        model: 'test',
        object: {
          bundles: [
            {
              title: 'Routing',
              confidence: 'high',
              quote: requireValue(row.messages[0]).text,
              items: [
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: 'Write schema migration',
                  proposedPayload: {
                    canonicalName: 'Write schema migration',
                    parentObjectId: communicationId(row.familyId, 'project'),
                  },
                  grounding: [
                    supportFromPacket(
                      input.prompt,
                      requireValue(quotes[0]),
                      'project',
                      'Records Gateway',
                      communicationId(row.familyId, 'project'),
                    ),
                  ],
                },
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: 'Test password recovery',
                  proposedPayload: {
                    canonicalName: 'Test password recovery',
                    parentObjectId: communicationId(row.familyId, 'second-project'),
                  },
                  grounding: [
                    supportFromPacket(
                      input.prompt,
                      requireValue(quotes[1]),
                      'project',
                      'Staff Console',
                      communicationId(row.familyId, 'second-project'),
                    ),
                  ],
                },
              ],
            },
          ],
        },
      }) as never,
  });
  expect(result.executionErrors).toEqual([]);
  expect(scoreCommunications(row, result).passed).toBe(true);
}, 60_000);

test('pending approval IDs cannot become canonical task update targets', async () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'human-edited-pending-telegram'),
  );
  const result = await harness.run(row, {
    model: async (input) => {
      const pendingSection =
        input.prompt
          .split('# Pending task approvals')[1]
          ?.split('# Pending calendar approvals')[0] ?? '';
      const targetId = requireValue(/- ([a-f0-9-]{36}):/.exec(pendingSection)?.[1]);
      return {
        model: 'test',
        object: {
          bundles: [
            {
              title: 'Invalid pending target',
              confidence: 'high',
              items: [
                {
                  operation: 'update',
                  targetKind: 'task',
                  targetId,
                  title: 'Prepare migration checklist',
                  proposedPayload: { parentObjectId: communicationId(row.familyId, 'project') },
                  grounding: [],
                },
              ],
            },
          ],
        },
      } as never;
    },
  });
  expect(result.executionErrors.length).toBeGreaterThan(0);
  expect(result.executionFailureDetails).toContain(
    'Communication audit cannot target a pending task approval as a canonical record',
  );
  expect(result.protectedPendingChanged).toBe(false);
  expect(result.acceptanceErrors).toBe(0);
  expect(scoreCommunications(row, result).passed).toBe(false);
}, 60_000);

test('long forwarded evidence remains admitted with compact coverage references', async () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((item) => item.id === 'long-forward-middle-email'),
  );
  const observed = await harness.run(row, {
    model: async () => ({ model: 'test', object: { bundles: [] } }) as never,
  });
  expect(observed.executionErrors).toEqual([]);
  expect(observed.packetLoss).toEqual([]);
});
