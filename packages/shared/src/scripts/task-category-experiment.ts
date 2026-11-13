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
import { TASK_CATEGORY_EVAL_CASES } from '#src/task-categories/eval-cases.js';

import type { Example } from 'langsmith/schemas';

import {
  summarizeClassification,
  type ClassificationResult,
} from '#src/task-categories/experiment-report.js';

const { values } = parseArgs({
  options: {
    sync: { type: 'boolean' },
    candidate: { type: 'string', multiple: true },
    limit: { type: 'string' },
    out: { type: 'string' },
  },
  strict: true,
});
if (process.env.NODE_ENV === 'production')
  throw new Error('Synthetic experiments cannot run in production');
if (!process.env.LANGSMITH_API_KEY) throw new Error('LANGSMITH_API_KEY is required');
const limit = values.limit === undefined ? TASK_CATEGORY_EVAL_CASES.length : Number(values.limit);
if (!Number.isInteger(limit) || limit < 1 || limit > TASK_CATEGORY_EVAL_CASES.length)
  throw new Error('Invalid --limit');
if (!values.sync && !values.out) throw new Error('Comparison requires --out=<new report.json>');
if (!values.sync && !process.env.OPENROUTER_API_KEY)
  throw new Error('OPENROUTER_API_KEY is required');
if (!values.sync && values.out) {
  const report = await open(values.out, 'wx');
  await report.close();
}
// Only checked-in synthetic fixtures are accepted; never load arbitrary remote inputs.
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const corpusHash = hash(JSON.stringify(TASK_CATEGORY_EVAL_CASES));
const datasetName = `timeline-task-categories-${corpusHash.slice(0, 16)}`;
const client = new Client();
const datasets = [];
for await (const dataset of client.listDatasets({ datasetName })) datasets.push(dataset);
const dataset =
  datasets.find((item) => item.name === datasetName) ??
  (await client.createDataset(datasetName, {
    description:
      'Repository-owned synthetic task classification benchmark. Do not edit in the UI; change fixtures in Git.',
    metadata: { corpusHash, source: 'synthetic', schemaVersion: 1 },
  }));
const examples: Example[] = [];
for await (const example of client.listExamples({ datasetId: dataset.id })) examples.push(example);
for (const testCase of TASK_CATEGORY_EVAL_CASES) {
  const inputs = { caseId: testCase.id };
  const existing = examples.filter((example) => example.inputs.caseId === testCase.id);
  const match = existing[0];
  if (
    existing.length > 1 ||
    (match &&
      (match.outputs?.category !== testCase.expected || match.metadata?.corpusHash !== corpusHash))
  ) {
    throw new Error(`Remote dataset drift for ${testCase.id}; refusing to overwrite`);
  }
  if (!existing.length)
    examples.push(
      await client.createExample({
        dataset_id: dataset.id,
        inputs,
        reference_outputs: { category: testCase.expected },
        metadata: {
          corpusHash,
          tags: testCase.tags,
          synthetic: true,
          title: testCase.title,
          description: testCase.description,
          primaryProjectName: testCase.primaryProjectName,
        },
      }),
    );
}
if (examples.length !== TASK_CATEGORY_EVAL_CASES.length)
  throw new Error('Remote dataset contains unexpected examples');
console.log(
  JSON.stringify({ dataset: datasetName, datasetId: dataset.id, examples: examples.length }),
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
  const selected = TASK_CATEGORY_EVAL_CASES.slice(0, limit);
  const reports = [];
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
              ...(testCase.description ? { metadata: { description: testCase.description } } : {}),
              ...(testCase.primaryProjectName
                ? { primaryProjectName: testCase.primaryProjectName }
                : {}),
            }),
            { modelId: model, abortSignal: AbortSignal.timeout(60_000) },
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
        data: selected.map((testCase): Example => {
          const example = examples.find((item) => item.inputs.caseId === testCase.id);
          if (!example) throw new Error('Missing synced example');
          return {
            id: example.id,
            dataset_id: dataset.id,
            created_at: example.created_at,
            inputs: { caseId: testCase.id },
            outputs: { category: testCase.expected },
            metadata: { synthetic: true, corpusHash },
            runs: [],
          };
        }),
        experimentPrefix: `task-category-${model.replaceAll('/', '-')}`,
        maxConcurrency: 4,
        metadata: {
          revision,
          dirty,
          corpusHash,
          promptHash: hash(TASK_CATEGORY_SYSTEM_PROMPT),
          evaluatorVersion: 1,
          requestedModel: model,
          synthetic: true,
          partial: limit !== TASK_CATEGORY_EVAL_CASES.length,
        },
        summaryEvaluators: [
          () => {
            const summary = summarizeClassification(
              rows,
              limit === TASK_CATEGORY_EVAL_CASES.length,
            );
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
    const summary = summarizeClassification(rows, limit === TASK_CATEGORY_EVAL_CASES.length);
    reports.push({
      model,
      experiment: experiment.experimentName,
      feedbackComplete,
      summary,
      rows: rows.sort((a, b) => a.id.localeCompare(b.id)),
    });
    console.log(JSON.stringify({ model, experiment: experiment.experimentName, summary }));
  }
  await client.awaitPendingTraceBatches();
  await writeFile(
    values.out ?? '',
    `${JSON.stringify({ datasetName, corpusHash, revision, dirty, reports }, null, 2)}\n`,
    { flag: 'w' },
  );
  if (
    reports.some(
      (report) =>
        !report.feedbackComplete ||
        report.summary.failures > 0 ||
        (limit === TASK_CATEGORY_EVAL_CASES.length && !report.summary.releaseGatePassed),
    )
  )
    process.exitCode = 1;
}
