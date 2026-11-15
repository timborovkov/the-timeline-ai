import { scenarioScores } from '@timeline/shared/evals/benchmark';

import type { SuggestionCase, ExpectedAction } from '#src/evals/suggestion-cases.js';

export interface ObservedAction {
  bundleId?: string;
  operation: string;
  targetKind: string;
  targetId?: string | null;
  title: string;
  proposedPayload: Record<string, unknown>;
  evidenceIds: string[];
}
export interface SuggestionObservation {
  actions: ObservedAction[];
  executionErrors: string[];
  modelCalls: number;
  durationMs: number;
  unauthorizedDisclosure: boolean;
  canonicalMutation: boolean;
  invalidEvidence: boolean;
  stages: string[];
}
function matches(expected: ExpectedAction, actual: ObservedAction, actions: ObservedAction[]) {
  if (expected.relatedNames) {
    const names = ['from', 'to'].map((side) => {
      const named = actual.proposedPayload[`${side}Name`];
      if (typeof named === 'string') return named.trim().toLowerCase();
      const ref = actual.proposedPayload[`${side}Ref`];
      if (typeof ref !== 'string') return null;
      const targets = actions.filter(
        (action) =>
          action.bundleId === actual.bundleId &&
          action.operation === 'create' &&
          action.targetKind === 'object' &&
          action.proposedPayload.localRef === ref,
      );
      const name = targets.length === 1 ? targets[0]?.proposedPayload.canonicalName : null;
      return typeof name === 'string' ? name.trim().toLowerCase() : null;
    });
    if (
      names.some((name) => !name) ||
      JSON.stringify(names.sort()) !==
        JSON.stringify(expected.relatedNames.map((name) => name.trim().toLowerCase()).sort())
    )
      return false;
  }
  const text =
    `${actual.title} ${typeof actual.proposedPayload.canonicalName === 'string' ? actual.proposedPayload.canonicalName : ''} ${typeof actual.proposedPayload.description === 'string' ? actual.proposedPayload.description : ''}`.toLowerCase();
  return (
    expected.operation === actual.operation &&
    expected.targetKind === actual.targetKind &&
    (!expected.targetId || expected.targetId === actual.targetId) &&
    expected.terms.every((group) => group.some((term) => text.includes(term.toLowerCase()))) &&
    Object.entries(expected.fields ?? {}).every(([key, value]) => {
      const observed = actual.proposedPayload[key];
      if (
        (key === 'dueAt' || key === 'startAt') &&
        typeof observed === 'string' &&
        typeof value === 'string'
      )
        return Date.parse(observed) === Date.parse(value);
      return observed === value;
    })
  );
}
/** Maximum one-to-one matching: one proposal cannot satisfy multiple expected actions. */
export function scoreSuggestions(row: SuggestionCase, observation: SuggestionObservation) {
  const assigned = new Map<number, number>();
  function assign(expectedIndex: number, seen: Set<number>): boolean {
    const expected = row.expected[expectedIndex];
    if (!expected) return false;
    for (const [index, actual] of observation.actions.entries()) {
      if (seen.has(index) || !matches(expected, actual, observation.actions)) continue;
      seen.add(index);
      const previous = assigned.get(index);
      if (previous === undefined || assign(previous, seen)) {
        assigned.set(index, expectedIndex);
        return true;
      }
    }
    return false;
  }
  for (let index = 0; index < row.expected.length; index++) assign(index, new Set());
  const matched = assigned.size;
  const missed = row.expected.length - matched;
  const optionalMatches = new Set<number>();
  for (const allowed of row.allowed ?? []) {
    const index = observation.actions.findIndex(
      (action, index) =>
        !assigned.has(index) &&
        !optionalMatches.has(index) &&
        matches(allowed, action, observation.actions),
    );
    if (index >= 0) optionalMatches.add(index);
  }
  const allowed = optionalMatches.size;
  const noise = observation.actions.length - matched - allowed;
  const hardFailure =
    observation.unauthorizedDisclosure ||
    observation.canonicalMutation ||
    observation.invalidEvidence;
  const executionFailure = observation.executionErrors.length > 0;
  return {
    expected: row.expected.length,
    proposed: observation.actions.length,
    matched,
    allowed,
    missed,
    noise,
    hardFailure,
    executionFailure,
    passed: !hardFailure && !executionFailure && missed === 0 && noise === 0,
  };
}
export type SuggestionResult = SuggestionObservation & {
  id: string;
  tags: string[];
  score: ReturnType<typeof scoreSuggestions>;
};
export function summarizeSuggestions(rows: SuggestionResult[]) {
  const total = (key: 'expected' | 'proposed' | 'matched' | 'allowed' | 'missed' | 'noise') =>
    rows.reduce((sum, row) => sum + row.score[key], 0);
  const expected = total('expected');
  const proposed = total('proposed');
  return {
    cases: rows.length,
    passed: rows.filter((row) => row.score.passed).length,
    executionFailures: rows.filter((row) => row.score.executionFailure).length,
    hardFailures: rows.filter((row) => row.score.hardFailure).length,
    expected,
    proposed,
    matched: total('matched'),
    missed: total('missed'),
    noise: total('noise'),
    recall: expected ? total('matched') / expected : null,
    precision: proposed ? (total('matched') + total('allowed')) / proposed : null,
    allowed: total('allowed'),
    noActionCases: rows.filter((row) => row.score.expected === 0).length,
    meanDurationMs: rows.length
      ? rows.reduce((sum, row) => sum + row.durationMs, 0) / rows.length
      : null,
    scenarios: scenarioScores(rows, (row) => row.score.passed),
    failedCaseIds: rows.filter((row) => !row.score.passed).map((row) => row.id),
  };
}

/** Completion is about coverage and feedback, never whether model answers passed. */
export function suggestionRunComplete(
  ids: string[],
  expectedIds: string[],
  feedbackComplete: boolean,
) {
  return (
    feedbackComplete &&
    ids.length === expectedIds.length &&
    new Set(ids).size === ids.length &&
    expectedIds.every((id) => ids.includes(id))
  );
}
