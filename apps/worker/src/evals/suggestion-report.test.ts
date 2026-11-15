import { requireValue } from '@timeline/shared/evals/benchmark';
import { expect, test } from 'bun:test';

import {
  SUGGESTION_CASES,
  selectSuggestionCases,
  validateSuggestionCases,
} from '#src/evals/suggestion-cases.js';
import {
  scoreSuggestions,
  suggestionRunComplete,
  summarizeSuggestions,
  type SuggestionObservation,
} from '#src/evals/suggestion-report.js';

// Missed work and empty output must remain in denominators; failures cannot pass as abstention.
const observation: SuggestionObservation = {
  actions: [],
  executionErrors: [],
  modelCalls: 1,
  durationMs: 25,
  unauthorizedDisclosure: false,
  canonicalMutation: false,
  invalidEvidence: false,
  stages: [],
};
const positive = requireValue(SUGGESTION_CASES.find((row) => row.id === 'pricing-commitment'));
const negative = requireValue(SUGGESTION_CASES.find((row) => row.id === 'greeting-only'));
test(
  'corpus has isolated families, rationales and positive/negative coverage in both splits',
  validateSuggestionCases,
);
test('empty predictions count as missed expected work', () => {
  expect(scoreSuggestions(positive, observation)).toMatchObject({ missed: 1, passed: false });
  expect(scoreSuggestions(negative, observation).passed).toBe(true);
});
test('provider failure cannot pass a no-action case', () => {
  expect(
    scoreSuggestions(negative, { ...observation, executionErrors: ['TimeoutError'] }).passed,
  ).toBe(false);
});
test('one prediction cannot satisfy two required actions and extra proposals count as noise', () => {
  const action = {
    operation: 'create',
    targetKind: 'task',
    title: 'Send pricing packet',
    proposedPayload: { parentObjectId: '33333333-3333-4333-8333-333333333333' },
    evidenceIds: ['visible'],
  };
  expect(
    scoreSuggestions(
      { ...positive, expected: [...positive.expected, ...positive.expected] },
      { ...observation, actions: [action] },
    ),
  ).toMatchObject({ matched: 1, missed: 1 });
  expect(scoreSuggestions(positive, { ...observation, actions: [action, action] })).toMatchObject({
    matched: 1,
    noise: 1,
    passed: false,
  });
});
test('incorrect fields and unauthorized disclosures cannot earn success', () => {
  expect(
    scoreSuggestions(positive, {
      ...observation,
      actions: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send pricing packet',
          proposedPayload: { parentObjectId: 'wrong' },
          evidenceIds: ['visible'],
        },
      ],
    }).matched,
  ).toBe(0);
  for (const key of ['unauthorizedDisclosure', 'canonicalMutation', 'invalidEvidence'] as const) {
    expect(scoreSuggestions(negative, { ...observation, [key]: true })).toMatchObject({
      hardFailure: true,
      passed: false,
    });
  }
});
test('summary retains failures, negative cases and scenario denominators', () => {
  const rows = [positive, negative].map((row) => ({
    ...observation,
    id: row.id,
    tags: row.tags,
    score: scoreSuggestions(row, observation),
  }));
  expect(summarizeSuggestions(rows)).toMatchObject({
    cases: 2,
    expected: 1,
    missed: 1,
    recall: 0,
    noActionCases: 1,
    passed: 1,
  });
  expect(
    summarizeSuggestions(rows).scenarios.find((row) => row.scenario === 'recall'),
  ).toMatchObject({ cases: 1, correct: 0 });
});

test('permits one grounded deadline companion but rejects duplicates and wrong dates', () => {
  const row = requireValue(SUGGESTION_CASES.find((row) => row.id === 'fixed-deadline'));
  const task = {
    operation: 'create',
    targetKind: 'task',
    title: 'Send migration report',
    proposedPayload: { dueAt: '2026-06-10T15:00:00Z' },
    evidenceIds: ['visible'],
  };
  const calendar = {
    operation: 'create',
    targetKind: 'calendar_event',
    title: 'Migration report deadline',
    proposedPayload: { startAt: '2026-06-10T15:00:00Z' },
    evidenceIds: ['visible'],
  };
  expect(scoreSuggestions(row, { ...observation, actions: [task, calendar] })).toMatchObject({
    passed: true,
    allowed: 1,
    noise: 0,
  });
  expect(scoreSuggestions(row, { ...observation, actions: [task, calendar, calendar] }).noise).toBe(
    1,
  );
  expect(
    scoreSuggestions(row, {
      ...observation,
      actions: [task, { ...calendar, proposedPayload: { startAt: '2026-07-10T15:00:00Z' } }],
    }).noise,
  ).toBe(1);
});

test('cancellation updates lifecycle status rather than requiring archival', () => {
  const row = requireValue(SUGGESTION_CASES.find((row) => row.id === 'cancel-work'));
  const action = {
    operation: 'update',
    targetKind: 'task',
    targetId: '44444444-4444-4444-8444-444444444444',
    title: 'Prepare conference booth',
    proposedPayload: { status: 'cancelled' },
    evidenceIds: ['visible'],
  };
  expect(scoreSuggestions(row, { ...observation, actions: [action] }).passed).toBe(true);
  expect(
    scoreSuggestions(row, {
      ...observation,
      actions: [{ ...action, operation: 'archive_or_cancel', proposedPayload: {} }],
    }).passed,
  ).toBe(false);
});

test('partial, duplicate and missing-feedback runs cannot qualify as complete evidence', () => {
  expect(suggestionRunComplete(['a'], ['a', 'b'], true)).toBe(false);
  expect(suggestionRunComplete(['a', 'a'], ['a', 'b'], true)).toBe(false);
  expect(suggestionRunComplete(['a', 'b'], ['a', 'b'], false)).toBe(false);
  expect(suggestionRunComplete(['b', 'a'], ['a', 'b'], true)).toBe(true);
});

test('GitHub selection preserves full dataset provenance and cannot count as complete holdout evidence', () => {
  const selection = selectSuggestionCases({ tag: 'github-completion' });
  expect(selection.selected).toHaveLength(9);
  expect(selection.corpus).toHaveLength(29);
  expect(selection.complete).toBe(false);
  expect(selection.benchmark).toBe(false);
  expect(
    selectSuggestionCases({ tag: 'github-completion', limit: '2', repeats: '3' }).selected,
  ).toHaveLength(2);
  expect(() => selectSuggestionCases({ tag: 'not-a-scenario' })).toThrow();
  expect(() => selectSuggestionCases({ tag: 'github-completion', split: 'held-out' })).toThrow();
});
