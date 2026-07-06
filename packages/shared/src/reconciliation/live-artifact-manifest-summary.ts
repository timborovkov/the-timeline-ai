export interface LiveEvalManifestSummaryCase {
  scenarioFamily: string | null;
  ingestionSurfaces: string[];
  passed: boolean;
  judgeScore: number | null;
  judgePassed: boolean | null;
}

export interface LiveEvalManifestSummary {
  caseCount: number;
  passedCount: number;
  failedCount: number;
  judgeAverageScore: number | null;
  judgePassedCount: number;
  judgeFailedCount: number;
  scenarioFamilies: string[];
  ingestionSurfaces: string[];
}

export function summarizeLiveEvalManifestCases(
  cases: LiveEvalManifestSummaryCase[],
): LiveEvalManifestSummary {
  const judgedCases = cases.filter((entry) => entry.judgeScore !== null);
  return {
    caseCount: cases.length,
    passedCount: cases.filter((entry) => entry.passed).length,
    failedCount: cases.filter((entry) => !entry.passed).length,
    judgeAverageScore:
      judgedCases.length > 0
        ? judgedCases.reduce((sum, entry) => sum + (entry.judgeScore ?? 0), 0) / judgedCases.length
        : null,
    judgePassedCount: cases.filter((entry) => entry.judgePassed === true).length,
    judgeFailedCount: cases.filter((entry) => entry.judgePassed === false).length,
    scenarioFamilies: uniqueSorted(cases.flatMap((entry) => entry.scenarioFamily ?? [])),
    ingestionSurfaces: uniqueSorted(cases.flatMap((entry) => entry.ingestionSurfaces)),
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
