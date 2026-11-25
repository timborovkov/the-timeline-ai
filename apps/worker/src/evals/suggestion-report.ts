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
  evidenceEventIds?: string[];
  providerCosts?: (number | null)[];
}

export function observedProviderCost(value: unknown): number | null {
  const cost =
    value && typeof value === 'object' && 'openRouterUsd' in value ? value.openRouterUsd : null;
  return typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? cost : null;
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
  const citationChecks = [...assigned].flatMap(([index, expectedIndex]) => {
    const expectedEvidence = row.expected[expectedIndex]?.evidenceEventIndices;
    const cited = observation.actions[index]?.evidenceIds ?? [];
    return expectedEvidence
      ? [
          expectedEvidence.length === new Set(cited).size &&
            expectedEvidence.every((eventIndex) =>
              cited.includes(observation.evidenceEventIds?.[eventIndex] ?? ''),
            ),
        ]
      : [];
  });
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
    citationChecks: { total: citationChecks.length, passed: citationChecks.filter(Boolean).length },
    passed:
      !hardFailure &&
      !executionFailure &&
      missed === 0 &&
      noise === 0 &&
      citationChecks.every(Boolean),
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
  const receipts = rows.flatMap((row) => row.providerCosts ?? []);
  const costs = receipts.filter((cost): cost is number => cost !== null);
  return {
    cases: rows.length,
    passed: rows.filter((row) => row.score.passed).length,
    executionFailures: rows.filter((row) => row.score.executionFailure).length,
    hardFailures: rows.filter((row) => row.score.hardFailure).length,
    citationCorrectness: rows.reduce(
      (result, row) => ({
        total: result.total + row.score.citationChecks.total,
        passed: result.passed + row.score.citationChecks.passed,
      }),
      { total: 0, passed: 0 },
    ),
    providerCost: {
      observedUsd: costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null,
      callsWithCost: costs.length,
      callsWithoutCost: receipts.length - costs.length,
    },
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
  fullSelection = true,
) {
  return (
    fullSelection &&
    feedbackComplete &&
    ids.length === expectedIds.length &&
    new Set(ids).size === ids.length &&
    expectedIds.every((id) => ids.includes(id))
  );
}

/** v2 runs.query defaults to the last 24h when omitted; keep experiment history in scope. */
const SUGGESTION_PUBLICATION_MIN_START_TIME = '2000-01-01T00:00:00.000Z';

/** Verify durable root runs and evaluator scores, not only local evaluator output. */
export async function verifySuggestionPublication(
  client: {
    awaitPendingTraceBatches(): Promise<void>;
    readProject(options: { projectName: string }): Promise<{ id: string }>;
    runs: {
      query(options: {
        project_ids: string[];
        ids: string[];
        is_root: boolean;
        selects: ('ID' | 'END_TIME')[];
        min_start_time: string;
      }): AsyncIterable<{ id?: string; end_time?: string | null | undefined }>;
    };
    listFeedback(options: {
      runIds: string[];
    }): AsyncIterable<{ run_id: string; key: string; score?: number | boolean | null | undefined }>;
  },
  projectName: string,
  expected: {
    runId: string;
    scores: { key: string; score?: number | boolean | null | undefined }[];
  }[],
) {
  const roots = new Set<string>();
  const feedback = new Map<
    string,
    { key: string; score?: number | boolean | null | undefined }[]
  >();
  let error: string | null = null;
  try {
    await client.awaitPendingTraceBatches();
    const project = await client.readProject({ projectName });
    for (let offset = 0; offset < expected.length; offset += 50) {
      const ids = expected.slice(offset, offset + 50).map((row) => row.runId);
      for await (const run of client.runs.query({
        project_ids: [project.id],
        ids,
        is_root: true,
        selects: ['ID', 'END_TIME'],
        min_start_time: SUGGESTION_PUBLICATION_MIN_START_TIME,
      }))
        if (run.id && run.end_time !== undefined && run.end_time !== null) roots.add(run.id);
      for await (const item of client.listFeedback({ runIds: ids })) {
        const entries = feedback.get(item.run_id) ?? [];
        entries.push(item);
        feedback.set(item.run_id, entries);
      }
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.name : 'PublicationError';
  }
  const missingRunIds = expected.filter((row) => !roots.has(row.runId)).map((row) => row.runId);
  const missingFeedback = expected.flatMap((row) =>
    row.scores
      .filter(
        (score) =>
          score.score === undefined ||
          score.score === null ||
          !(feedback.get(row.runId) ?? []).some(
            (item) => item.key === score.key && item.score === score.score,
          ),
      )
      .map((score) => ({ runId: row.runId, key: score.key })),
  );
  return {
    complete:
      !error &&
      expected.length > 0 &&
      new Set(expected.map((row) => row.runId)).size === expected.length &&
      expected.every((row) => row.scores.length > 0) &&
      missingRunIds.length === 0 &&
      missingFeedback.length === 0,
    missingRunIds,
    missingFeedback,
    error,
  };
}
