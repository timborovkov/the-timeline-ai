import { requireValue } from '@timeline/shared/evals/benchmark';
import { expect, test } from 'bun:test';

import {
  COMMUNICATION_CASES,
  selectCommunications,
  validateCommunicationCases,
} from '#src/evals/communication-cases.js';
import { scoreCommunications, summarizeCommunications } from '#src/evals/communication-report.js';
import type { CommunicationObservation } from '#src/evals/communication-types.js';
import { suggestionRunComplete } from '#src/evals/suggestion-report.js';

// Graph scoring must reject missed work, false attribution and operational failures,
// including empty outputs on negative cases. These tests never call external services.
const empty: CommunicationObservation = {
  actions: [],
  executionErrors: [],
  modelCalls: 0,
  durationMs: 10,
  unauthorizedDisclosure: false,
  canonicalMutation: false,
  invalidEvidence: false,
  stages: [],
  nodes: [],
  edges: [],
  acceptanceErrors: 0,
  acceptanceFailureReasons: [],
  duplicateProposals: 0,
  packetLoss: [],
  protectedPendingChanged: false,
  uncertaintyMissing: false,
  capturedEvents: 1,
  queuedJobs: 1,
  source: 'email',
  familyId: 'hypothetical-example',
};
test('corpus coverage and family isolation are validated', () => {
  expect(() => {
    validateCommunicationCases();
  }).not.toThrow();
  expect(selectCommunications({}).selected).toHaveLength(162);
  expect(selectCommunications({ split: 'held-out', repeats: '3' })).toMatchObject({
    repeats: 3,
    benchmark: true,
  });
  expect(selectCommunications({ split: 'held-out', tag: 'email' })).toMatchObject({
    benchmark: false,
    complete: false,
  });
  expect(new Set(COMMUNICATION_CASES.map((row) => row.familyId)).size).toBe(72);
});
test('errors cannot turn empty output into successful abstention', () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'hypothetical-example-email'),
  );
  expect(scoreCommunications(row, empty).passed).toBe(true);
  for (const patch of [
    { executionErrors: ['TimeoutError'] },
    { acceptanceErrors: 1 },
    { packetLoss: ['message-0'] },
    { unauthorizedDisclosure: true },
    { canonicalMutation: true },
    { protectedPendingChanged: true },
    { invalidEvidence: true },
  ])
    expect(scoreCommunications(row, { ...empty, ...patch }).passed).toBe(false);
});
test('task ownership and duplicate canonical objects are scored', () => {
  const row = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'unknown-owner-email'));
  const node = {
    id: 'task',
    type: 'task',
    name: 'Review retention policy',
    status: 'todo',
    assigneeUserId: null,
    dueAt: null,
  };
  expect(scoreCommunications(row, { ...empty, nodes: [node] }).passed).toBe(true);
  expect(
    scoreCommunications(row, { ...empty, nodes: [{ ...node, assigneeUserId: 'wrong' }] }).missed,
  ).toBe(1);
  expect(
    scoreCommunications(row, { ...empty, nodes: [node, { ...node, id: 'duplicate' }] }).noise,
  ).toBe(1);
});
test('summaries retain failure denominators and partial runs cannot be evidence', () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'hypothetical-example-email'),
  );
  const observed = { ...empty, executionErrors: ['RateLimitError'] };
  const result = {
    ...observed,
    id: row.id,
    tags: row.tags,
    score: scoreCommunications(row, observed),
  };
  const summary = summarizeCommunications([result]);
  expect(summary).toMatchObject({ cases: 1, passed: 0, executionFailures: 1 });
  expect(summary.sources[0]).toMatchObject({ source: 'email', cases: 1, passed: 0 });
  expect(suggestionRunComplete([row.id], ['other', row.id], true)).toBe(false);
});

test('unsupported calendar or note proposals cannot hide behind an empty entity graph', () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'hypothetical-example-email'),
  );
  for (const targetKind of ['calendar_event', 'object_note', 'identity_facet']) {
    const result = scoreCommunications(row, {
      ...empty,
      actions: [
        {
          operation: 'create',
          targetKind,
          title: 'Unsupported change',
          proposedPayload: {},
          evidenceIds: ['evidence'],
        },
      ],
    });
    expect(result).toMatchObject({ passed: false, noise: 1 });
  }
});

test('deadline calendar companions allow equivalent instants but remain bounded', () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'pending-deadline-correction-email'),
  );
  const calendar = {
    operation: 'create',
    targetKind: 'calendar_event',
    title: 'Migration checklist deadline',
    proposedPayload: { startAt: '2026-06-12T09:00:00+00:00' },
    evidenceIds: ['evidence'],
  };
  expect(scoreCommunications(row, { ...empty, actions: [calendar] }).noise).toBe(0);
  expect(scoreCommunications(row, { ...empty, actions: [calendar, calendar] }).noise).toBe(1);
});

test('injected reassignment fails even when the requested task is present', () => {
  const row = requireValue(
    COMMUNICATION_CASES.find((row) => row.id === 'quoted-injection-reassignment-email'),
  );
  const observation = {
    ...empty,
    nodes: [
      {
        id: 'task',
        type: 'task',
        name: 'Verify invoice rounding',
        status: 'todo',
        assigneeUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        dueAt: null,
      },
    ],
  };
  expect(scoreCommunications(row, observation).passed).toBe(false);
});

test('reviewed equivalent names do not become unrestricted fuzzy matching', () => {
  const row = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'informal-delivery-email'));
  const observation = {
    ...empty,
    nodes: [
      {
        id: 'company',
        type: 'company',
        name: 'Marlin Travel',
        status: 'open',
        assigneeUserId: null,
        dueAt: null,
      },
      {
        id: 'project',
        type: 'project',
        name: 'The Booking Desk',
        status: 'planning',
        assigneeUserId: null,
        dueAt: null,
      },
    ],
  };
  expect(scoreCommunications(row, observation).passed).toBe(true);
  expect(
    scoreCommunications(row, {
      ...observation,
      nodes: observation.nodes.map((node) => ({ ...node, name: `${node.name} replacement` })),
    }).passed,
  ).toBe(false);
});

test('ordinary requests reject invented owners and deadlines', () => {
  const row = requireValue(COMMUNICATION_CASES.find((row) => row.id === 'unknown-owner-email'));
  const node = {
    id: 'task',
    type: 'task',
    name: 'Review retention policy',
    status: 'todo',
    assigneeUserId: null,
    dueAt: null,
  };
  expect(
    scoreCommunications(row, { ...empty, nodes: [{ ...node, dueAt: '2026-06-01T23:00:00.000Z' }] })
      .passed,
  ).toBe(false);
  expect(
    scoreCommunications(row, {
      ...empty,
      nodes: [{ ...node, dueAt: '2026-06-01T23:00:00.000Z' }],
    }).fieldMismatches.some((mismatch) => mismatch.field === 'dueAt'),
  ).toBe(true);
});
