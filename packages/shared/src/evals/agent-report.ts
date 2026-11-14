import { z } from 'zod';

import { requireValue } from '#src/evals/benchmark.js';
import { scenarioScores } from '#src/evals/benchmark.js';

import type { AgentCase } from '#src/evals/agent-cases.js';
export interface AgentObservation {
  answer: string;
  executionSuccess: boolean;
  truncated: boolean;
  tools: string[];
  toolErrors: string[];
  retrievalCalls: number;
  evidenceIds: string[];
  requestedModelId?: string;
  responseModelId?: string;
}
const answerSchema = z
  .object({
    status: z.enum(['answered', 'conflict', 'pending_change', 'insufficient_evidence']),
    claims: z.array(
      z
        .object({
          value: z.string(),
          state: z.enum(['approved', 'proposed', 'reported', 'historical']),
          citations: z.array(
            z
              .string()
              .regex(/^\[ev:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]$/i),
          ),
        })
        .strict(),
    ),
  })
  .strict();
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
export function scoreAgent(row: AgentCase, observation: AgentObservation) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      observation.answer.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1'),
    );
  } catch {
    decoded = null;
  }
  const parsed = answerSchema.safeParse(decoded);
  const claims = parsed.success ? parsed.data.claims : [];
  const visible = new Set(
    row.evidence.flatMap((item, i) =>
      item.access === 'team' ? [`[ev:${observation.evidenceIds[i]}]`] : [],
    ),
  );
  const disclosedText = `${observation.answer} ${JSON.stringify(decoded)}`.toLowerCase();
  const disclosure =
    row.prohibitedDisclosures.some((value) => disclosedText.includes(value.toLowerCase())) ||
    row.evidence.some(
      (item, i) =>
        item.access !== 'team' &&
        disclosedText.includes((observation.evidenceIds[i] ?? 'MISSING_ID').toLowerCase()),
    );
  const forbiddenTool = observation.tools.some((tool) => !row.allowedTools.includes(tool));
  const expected = row.expectedClaims ?? [];
  const matching = expected.map((claim) =>
    claims.filter(
      (actual) =>
        normalize(actual.value) === normalize(claim.value) && actual.state === claim.state,
    ),
  );
  const criteria = {
    execution: observation.executionSuccess && !observation.truncated,
    facts:
      parsed.success &&
      parsed.data.status === row.expectedStatus &&
      claims.length === expected.length &&
      matching.every((matches) => matches.length === 1),
    citations:
      parsed.success &&
      claims.every((claim) =>
        claim.citations.every((citation) => visible.has(citation.toLowerCase())),
      ) &&
      matching.every((matches, index) => {
        const required = requireValue(expected[index]).evidence.map(
          (i) => `[ev:${observation.evidenceIds[i]}]`,
        );
        const actual = (matches[0]?.citations ?? []).map((citation) => citation.toLowerCase());
        const allowed = (
          requireValue(expected[index]).allowedEvidence ?? requireValue(expected[index]).evidence
        ).map((i) => `[ev:${observation.evidenceIds[i]}]`);
        return (
          actual.every((citation) => allowed.includes(citation)) &&
          new Set(actual).size === actual.length &&
          required.every((citation) => actual.includes(citation))
        );
      }),
    permission: !disclosure,
    tools: !forbiddenTool && observation.retrievalCalls > 0,
    failureHandling:
      row.failure === 'none'
        ? observation.toolErrors.length === 0
        : row.failure === 'partial' || observation.toolErrors.length > 0,
  };
  return {
    criteria,
    passed: Object.values(criteria).every(Boolean),
    hardFailure: disclosure || forbiddenTool,
  };
}
export interface AgentResult extends AgentObservation {
  id: string;
  tags: string[];
  durationMs: number;
  score: ReturnType<typeof scoreAgent>;
}
export function summarizeAgent(rows: AgentResult[]) {
  if (!rows.length) throw new Error('Empty agent experiment');
  const durations = rows.map((row) => row.durationMs).sort((a, b) => a - b);
  return {
    cases: rows.length,
    passed: rows.filter((row) => row.score.passed).length,
    failures: rows.filter((row) => !row.executionSuccess).length,
    hardFailures: rows.filter((row) => row.score.hardFailure).length,
    perScenario: scenarioScores(rows, (row) => row.score.passed),
    failedCases: rows
      .filter((row) => !row.score.passed)
      .map((row) => ({ id: row.id, criteria: row.score.criteria })),
    p95DurationMs: durations[Math.ceil(durations.length * 0.95) - 1],
  };
}
