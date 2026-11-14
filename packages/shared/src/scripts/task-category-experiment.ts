import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { Client } from 'langsmith';
import { evaluate } from 'langsmith/evaluation';

import { getEnv } from '#src/env.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import {
  buildTaskCategoryPacket,
  classifyTaskCategory,
  TASK_CATEGORY_SYSTEM_PROMPT,
} from '#src/task-categories/classifier.js';

import { requireValue } from '#src/evals/benchmark.js';
import { selectBenchmark, syncBenchmark } from '#src/evals/benchmark.js';
import { CLASSIFICATION_CASES } from '#src/task-categories/benchmark-cases.js';
import {
  summarizeClassification,
  compareClassificationRuns,
  type ClassificationResult,
} from '#src/task-categories/experiment-report.js';
const { values } = parseArgs({
  options: {
    sync: { type: 'boolean' },
    split: { type: 'string' },
    repeats: { type: 'string' },
    candidate: { type: 'string', multiple: true },
    limit: { type: 'string' },
    out: { type: 'string' },
  },
  strict: true,
});
if (process.env.NODE_ENV === 'production')
  throw new Error('Synthetic experiments cannot run in production');
if (!process.env.LANGSMITH_API_KEY) throw new Error('LANGSMITH_API_KEY is required');
const selection = selectBenchmark(CLASSIFICATION_CASES, values);
const { selected, repeats, split, benchmark } = selection;
if (!values.sync && !values.out) throw new Error('Comparison requires --out=<new report.json>');
if (!values.sync && !process.env.OPENROUTER_API_KEY)
  throw new Error('OPENROUTER_API_KEY is required');
if (!values.sync && values.out) {
  const report = await open(values.out, 'wx');
  await report.close();
}
// Only checked-in synthetic fixtures are accepted; never load arbitrary remote inputs.
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const client = new Client();
const { corpusHash, datasetName, data } = await syncBenchmark(
  client,
  'task-categories',
  CLASSIFICATION_CASES,
  selection.corpus,
  split,
  (row) => ({ category: row.expected }),
);
if (!values.sync) {
  process.env.LANGSMITH_TRACING = 'true';
  process.env.LANGSMITH_TRACING_SAMPLING_RATE = '1';
  // The classifier does not use a database; satisfy the shared environment schema without production access.
  process.env.DATABASE_URL ??= 'postgresql://localhost/timeline_synthetic_eval';
  process.env.AUTH_SECRET ??= randomUUID();
  getEnv();
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = Boolean(
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  );
  const models = [...new Set([TIMELINE_MODELS.taskCategorization.id, ...(values.candidate ?? [])])];
  const reports = [];
  for (let repetition = 1; repetition <= repeats; repetition++) {
    for (const model of models) {
      const rows: ClassificationResult[] = [];
      const experiment = await evaluate(
        async (inputs: { caseId: string }) => {
          const testCase = selected.find((item) => item.id === inputs.caseId);
          if (!testCase) throw new Error('Unknown synthetic case');
          const start = performance.now();
          try {
            const prediction = await classifyTaskCategory(
              buildTaskCategoryPacket({
                title: testCase.title,
                ...(testCase.description
                  ? { metadata: { description: testCase.description } }
                  : {}),
                ...(testCase.primaryProjectName
                  ? { primaryProjectName: testCase.primaryProjectName }
                  : {}),
              }),
              { modelId: model, abortSignal: AbortSignal.timeout(60000) },
            );
            rows.push({
              id: testCase.id,
              expected: testCase.expected,
              predicted: prediction.category,
              tags: testCase.tags,
              durationMs: performance.now() - start,
            });
            return prediction;
          } catch {
            rows.push({
              id: testCase.id,
              expected: testCase.expected,
              predicted: null,
              tags: testCase.tags,
              durationMs: performance.now() - start,
            });
            // Provider error bodies can contain credentials; report a bounded failure category.
            return { category: null, failed: true };
          }
        },
        {
          client,
          data: data(selected),
          experimentPrefix: `task-category-${model.replaceAll('/', '-')}`,
          maxConcurrency: 4,
          metadata: {
            revision,
            dirty,
            corpusHash,
            promptHash: hash(TASK_CATEGORY_SYSTEM_PROMPT),
            evaluatorVersion: 2,
            split,
            repetition,
            evaluatedAt: new Date().toISOString(),
            requestedModel: model,
            synthetic: true,
            partial: !selection.complete,
          },
          summaryEvaluators: [
            () => {
              const summary = summarizeClassification(rows, benchmark);
              return [
                { key: 'accuracy', score: summary.accuracy },
                { key: 'macro_recall', score: summary.macroRecall },
                { key: 'release_gate', score: Number(summary.releaseGatePassed) },
              ];
            },
          ],
          disableEvaluatorTracing: true,
          evaluators: [
            ({
              outputs,
              referenceOutputs,
            }: {
              outputs: Record<string, unknown>;
              referenceOutputs?: Record<string, unknown>;
            }) => ({
              key: 'exact_label',
              score: Number(outputs.category === referenceOutputs?.category),
            }),
            ({ outputs }: { outputs: Record<string, unknown> }) => ({
              key: 'execution_success',
              score: Number(!outputs.failed),
            }),
          ],
        },
      );
      const feedbackComplete =
        experiment.summaryResults.results.length === 3 &&
        experiment.results.length === selected.length &&
        experiment.results.every((row) => row.evaluationResults.results.length === 2);
      const summary = summarizeClassification(rows, benchmark);
      reports.push({
        model,
        repetition,
        experiment: experiment.experimentName,
        feedbackComplete,
        summary,
        rows: rows.sort((a, b) => a.id.localeCompare(b.id)),
      });
      console.log(JSON.stringify({ model, experiment: experiment.experimentName, summary }));
      await writeFile(
        requireValue(values.out),
        `${JSON.stringify({ datasetName, corpusHash, revision, dirty, split, evaluatedAt: new Date().toISOString(), reports, comparisons: compareClassificationRuns(reports) }, null, 2)}\n`,
      );
    }
  }
  await client.awaitPendingTraceBatches();
  await writeFile(
    values.out ?? '',
    `${JSON.stringify({ datasetName, corpusHash, revision, dirty, split, evaluatedAt: new Date().toISOString(), reports, comparisons: compareClassificationRuns(reports) }, null, 2)}\n`,
    { flag: 'w' },
  );
  if (
    reports.some(
      (report) =>
        !report.feedbackComplete ||
        report.summary.failures > 0 ||
        (benchmark && !report.summary.releaseGatePassed),
    )
  )
    process.exitCode = 1;
}
