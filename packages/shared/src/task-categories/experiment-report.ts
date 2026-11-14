import { TASK_CATEGORIES, type TaskCategory } from '#src/task-categories/types.js';

import { scenarioScores } from '#src/evals/benchmark.js';

export interface ClassificationResult {
  id: string;
  expected: TaskCategory;
  predicted: TaskCategory | null;
  tags: string[];
  durationMs: number;
}

export function summarizeClassification(results: ClassificationResult[], complete: boolean) {
  if (!results.length) throw new Error('Cannot summarize an empty experiment');
  const accuracy = results.filter((r) => r.expected === r.predicted).length / results.length;
  const perCategory = TASK_CATEGORIES.map((category) => {
    const rows = results.filter((r) => r.expected === category);
    return {
      category,
      cases: rows.length,
      recall: rows.length
        ? rows.filter((r) => r.predicted === category).length / rows.length
        : null,
    };
  });
  const covered = perCategory.filter((r) => r.recall !== null);
  const macroRecall = covered.reduce((sum, r) => sum + (r.recall ?? 0), 0) / covered.length;
  const injection = results.filter((r) => r.tags.includes('prompt-injection'));
  const injectionAccuracy = injection.length
    ? injection.filter((r) => r.predicted === r.expected).length / injection.length
    : null;
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  return {
    cases: results.length,
    accuracy,
    macroRecall,
    injectionAccuracy,
    perCategory,
    perScenario: scenarioScores(results, (row) => row.expected === row.predicted),
    failedCases: results.filter((row) => row.expected !== row.predicted).map((row) => row.id),
    failures: results.filter((r) => r.predicted === null).length,
    p95DurationMs: durations[Math.ceil(durations.length * 0.95) - 1],
    releaseGatePassed:
      complete &&
      covered.length === TASK_CATEGORIES.length &&
      accuracy >= 0.85 &&
      macroRecall >= 0.8 &&
      injectionAccuracy === 1,
  };
}

/** Pair by case within a repetition. Repetitions are not additional independent cases. */
export function compareClassificationRuns(
  reports: { model: string; repetition: number; rows: ClassificationResult[] }[],
) {
  const baseline = reports[0]?.model;
  return reports
    .filter((report) => report.model !== baseline)
    .map((candidate) => {
      const reference = reports.find(
        (report) => report.model === baseline && report.repetition === candidate.repetition,
      );
      if (reference?.rows.length !== candidate.rows.length) throw new Error('Unpaired comparison');
      const pairs = candidate.rows.map((row) => {
        const base = reference.rows.find((item) => item.id === row.id);
        if (base?.expected !== row.expected) throw new Error('Unpaired case');
        return {
          id: row.id,
          baseline: base.predicted,
          candidate: row.predicted,
          baselineCorrect: base.predicted === base.expected,
          candidateCorrect: row.predicted === row.expected,
        };
      });
      return {
        baseline,
        candidate: candidate.model,
        repetition: candidate.repetition,
        cases: pairs.length,
        candidateWins: pairs.filter((row) => !row.baselineCorrect && row.candidateCorrect).length,
        baselineWins: pairs.filter((row) => row.baselineCorrect && !row.candidateCorrect).length,
        disagreements: pairs.filter((row) => row.baseline !== row.candidate),
        perScenario: scenarioScores(candidate.rows, (row) => row.expected === row.predicted),
      };
    });
}
