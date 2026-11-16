import { requireValue } from '@timeline/shared/evals/benchmark';
import { expect, test } from 'bun:test';

import {
  validateCommunicationCoverage,
  assertCommunicationClaimsRetained,
  type CommunicationCoverage,
} from '#src/workers/communication-audit.js';
const event = '11111111-1111-4111-8111-111111111111';
const quote = 'Please prepare the release checklist.';
const coverage: CommunicationCoverage = [
  {
    kind: 'task',
    disposition: 'proposed',
    evidence: [{ rawEventId: event, quote }],
    proposalIds: ['task'],
    existingIds: [],
    reason: 'Explicit request.',
  },
];
const bundles = [{ items: [{ auditId: 'task', proposedPayload: {} }] }];
const args = {
  coverage,
  bundles,
  packet: quote,
  sources: [{ id: event, text: quote }],
  existingIds: [],
};
test('coverage requires actual visible source evidence and matching proposals', () => {
  expect(() => {
    validateCommunicationCoverage(args);
  }).not.toThrow();
  for (const patch of [
    { packet: '' },
    { sources: [] },
    { bundles: [] },
    { bundles: [...bundles, ...bundles] },
  ])
    expect(() => {
      validateCommunicationCoverage({ ...args, ...patch });
    }).toThrow();
});
test('no action must explain itself without referring to proposals', () => {
  expect(() => {
    validateCommunicationCoverage({
      ...args,
      bundles: [],
      coverage: [
        {
          ...requireValue(coverage[0]),
          disposition: 'no_action',
          proposalIds: [],
          reason: 'Hypothetical request only.',
        },
      ],
    });
  }).not.toThrow();
  expect(() => {
    validateCommunicationCoverage({
      ...args,
      coverage: [{ ...requireValue(coverage[0]), disposition: 'no_action' }],
    });
  }).toThrow();
});
test('existing disposition cannot reference an unavailable record', () => {
  expect(() => {
    validateCommunicationCoverage({
      ...args,
      bundles: [],
      coverage: [
        {
          ...requireValue(coverage[0]),
          disposition: 'existing',
          proposalIds: [],
          existingIds: [event],
        },
      ],
    });
  }).toThrow();
});
test('checked field or item removal fails the whole attempt', () => {
  const original = [
    { items: [{ auditId: 'task', proposedPayload: { status: 'done', assigneeUserId: null } }] },
  ];
  expect(() => {
    assertCommunicationClaimsRetained(original, original);
  }).not.toThrow();
  expect(() => {
    assertCommunicationClaimsRetained(original, bundles);
  }).toThrow();
  expect(() => {
    assertCommunicationClaimsRetained(original, []);
  }).toThrow();
});

test('no-action may preserve a known object but cannot invent one', () => {
  const preserved = {
    ...args,
    bundles: [],
    existingIds: [event],
    coverage: [
      {
        ...requireValue(coverage[0]),
        disposition: 'no_action' as const,
        proposalIds: [],
        existingIds: [event],
      },
    ],
  };
  expect(() => {
    validateCommunicationCoverage(preserved);
  }).not.toThrow();
  expect(() => {
    validateCommunicationCoverage({ ...preserved, existingIds: [] });
  }).toThrow();
});
