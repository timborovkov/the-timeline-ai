import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { selectBenchmark, syncBenchmark, requireValue } from '@timeline/shared/evals/benchmark';
import { TIMELINE_MODELS } from '@timeline/shared/llm';
import { Client } from 'langsmith';
import { evaluate } from 'langsmith/evaluation';

import { SUGGESTION_CASES, validateSuggestionCases } from '#src/evals/suggestion-cases.js';
import { createSuggestionHarness } from '#src/evals/suggestion-harness.js';
import {
  scoreSuggestions,
  suggestionRunComplete,
  summarizeSuggestions,
  type SuggestionResult,
  type SuggestionObservation,
} from '#src/evals/suggestion-report.js';

const { values } = parseArgs({
  options: {
    sync: { type: 'boolean' },
    split: { type: 'string' },
    repeats: { type: 'string' },
    limit: { type: 'string' },
    out: { type: 'string' },
  },
  strict: true,
});
if (process.env.NODE_ENV === 'production')
  throw new Error('Synthetic experiments cannot run in production');
if (!process.env.LANGSMITH_API_KEY) throw new Error('LANGSMITH_API_KEY is required');
validateSuggestionCases();
const selection = selectBenchmark(SUGGESTION_CASES, values);
if (!values.sync) {
  if (!values.out || !process.env.OPENROUTER_API_KEY)
    throw new Error('Require --out=<new report.json> and OPENROUTER_API_KEY');
  const file = await open(values.out, 'wx');
  await file.close();
}
const client = new Client();
const { datasetName, corpusHash, data } = await syncBenchmark(
  client,
  'suggestions',
  SUGGESTION_CASES,
  selection.corpus,
  selection.split,
  (row) => ({ expected: row.expected, allowed: row.allowed ?? [], rationale: row.rationale }),
);
if (!values.sync) {
  // Never connect to production stores or broad production tracing. Only this synthetic process.
  process.env.DATABASE_URL = 'postgresql://127.0.0.1/timeline_synthetic_eval';
  delete process.env.QDRANT_URL;
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.AUTH_SECRET ??= randomUUID();
  process.env.LANGSMITH_TRACING = 'true';
  process.env.LANGSMITH_TRACING_SAMPLING_RATE = '1';
  process.env.WORKSPACE_EVALUATION_TRACING_READY = 'false';
  process.env.IDENTITY_SEMANTIC_ENABLED = 'false';
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = Boolean(
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  );
  if (selection.split === 'held-out' && dirty)
    throw new Error('Commit fixtures and scoring before held-out evaluation');
  const harness = await createSuggestionHarness();
  const reports: {
    repetition: number;
    experiment: string;
    complete: boolean;
    benchmarkEvidence: boolean;
    feedbackComplete: boolean;
    summary: ReturnType<typeof summarizeSuggestions>;
    rows: SuggestionResult[];
  }[] = [];
  let inProgress: { repetition: number; rows: SuggestionResult[] } | null = null;
  const checkpoint = async () =>
    writeFile(
      requireValue(values.out),
      `${JSON.stringify({ datasetName, corpusHash, revision, dirty, split: selection.split, evaluatedAt: new Date().toISOString(), reports, inProgress }, null, 2)}\n`,
    );
  try {
    for (let repetition = 1; repetition <= selection.repeats; repetition++) {
      const rows: SuggestionResult[] = [];
      inProgress = { repetition, rows };
      await checkpoint();
      const experiment = await evaluate(
        async (inputs: { caseId: string }) => {
          const row = requireValue(selection.selected.find((item) => item.id === inputs.caseId));
          let observation: SuggestionObservation;
          const started = performance.now();
          try {
            observation = await harness.run(row);
          } catch {
            observation = {
              actions: [],
              executionErrors: ['HarnessError'],
              modelCalls: 0,
              durationMs: performance.now() - started,
              unauthorizedDisclosure: false,
              canonicalMutation: false,
              invalidEvidence: false,
              stages: ['harness-failure'],
            };
          }
          const result = {
            ...observation,
            id: row.id,
            tags: row.tags,
            score: scoreSuggestions(row, observation),
          };
          rows.push(result);
          await checkpoint();
          return result;
        },
        {
          client,
          data: data(selection.selected),
          experimentPrefix: `suggestions-${selection.split}`,
          maxConcurrency: 1,
          metadata: {
            revision,
            dirty,
            corpusHash,
            split: selection.split,
            repetition,
            partial: !selection.complete,
            benchmark: selection.benchmark,
            evaluatedAt: new Date().toISOString(),
            evaluatorVersion: 1,
            requestedModel: TIMELINE_MODELS.extraction.id,
            synthetic: true,
            retrieval: 'database-only',
            pipeline: 'raw-event-to-visible-proposal',
          },
          disableEvaluatorTracing: true,
          evaluators: [
            ({ outputs }: { outputs: Record<string, unknown> }) => {
              const { score } = outputs as unknown as SuggestionResult;
              return {
                results: [
                  { key: 'passed', score: Number(score.passed) },
                  { key: 'hard_failure', score: Number(score.hardFailure) },
                  { key: 'execution_failure', score: Number(score.executionFailure) },
                  { key: 'missed_actions', score: score.missed },
                  { key: 'noise', score: score.noise },
                ],
              };
            },
          ],
        },
      );
      const feedbackComplete =
        experiment.results.length === selection.selected.length &&
        experiment.results.every((result) => result.evaluationResults.results.length === 5);
      const complete = suggestionRunComplete(
        rows.map((row) => row.id),
        selection.corpus.map((row) => row.id),
        feedbackComplete,
      );
      const summary = summarizeSuggestions(rows);
      reports.push({
        repetition,
        experiment: experiment.experimentName,
        complete,
        benchmarkEvidence: selection.benchmark && complete,
        feedbackComplete,
        summary,
        rows,
      });
      inProgress = null;
      await checkpoint();
      console.log(JSON.stringify({ repetition, experiment: experiment.experimentName, summary }));
    }
  } finally {
    await checkpoint();
    await harness.close();
    await client.awaitPendingTraceBatches();
  }
  if (
    reports.some(
      (report) => !report.feedbackComplete || report.summary.passed !== report.summary.cases,
    )
  )
    process.exitCode = 1;
}
