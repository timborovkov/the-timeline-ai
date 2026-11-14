import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { Client } from 'langsmith';
import { evaluate } from 'langsmith/evaluation';

import { AGENT_PROMPT_VERSION } from '#src/agent/system-prompt.js';
import { getEnv } from '#src/env.js';
import { AGENT_CASES } from '#src/evals/agent-cases.js';
import { createAgentHarness } from '#src/evals/agent-harness.js';
import { scoreAgent, summarizeAgent, type AgentResult } from '#src/evals/agent-report.js';
import { selectBenchmark, syncBenchmark } from '#src/evals/benchmark.js';
import { requireValue } from '#src/evals/benchmark.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
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
const selection = selectBenchmark(AGENT_CASES, values);
if (!values.sync) {
  if (!values.out) throw new Error('Comparison requires --out=<new report.json>');
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required');
  const file = await open(values.out, 'wx');
  await file.close();
}
const client = new Client();
const { corpusHash, datasetName, data } = await syncBenchmark(
  client,
  'agent',
  AGENT_CASES,
  selection.corpus,
  selection.split,
  (row) => ({
    requiredEvidence: row.requiredEvidence,
    expectedStatus: row.expectedStatus,
    expectedClaims: row.expectedClaims,
    prohibitedDisclosures: row.prohibitedDisclosures,
    allowedTools: row.allowedTools,
  }),
);
if (!values.sync) {
  process.env.LANGSMITH_TRACING = 'true';
  process.env.LANGSMITH_TRACING_SAMPLING_RATE = '1';
  process.env.DATABASE_URL = 'postgresql://localhost/timeline_synthetic_eval';
  process.env.QDRANT_URL = 'http://127.0.0.1:6333';
  process.env.AUTH_SECRET ??= randomUUID();
  getEnv();
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = Boolean(
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  );
  const harness = await createAgentHarness();
  const reports = [];
  try {
    for (let repetition = 1; repetition <= selection.repeats; repetition++) {
      const rows: AgentResult[] = [];
      const experiment = await evaluate(
        async (inputs: { caseId: string }) => {
          const row = selection.selected.find((item) => item.id === inputs.caseId);
          if (!row) throw new Error('Unknown synthetic case');
          const started = performance.now();
          let observation;
          try {
            observation = await harness.run(row);
          } catch {
            observation = {
              answer: '',
              executionSuccess: false,
              truncated: false,
              tools: [],
              toolErrors: ['execution-failure'],
              retrievalCalls: 0,
              evidenceIds: [],
            };
          }
          const result: AgentResult = {
            ...observation,
            id: row.id,
            tags: row.tags,
            durationMs: performance.now() - started,
            score: scoreAgent(row, observation),
          };
          rows.push(result);
          return result;
        },
        {
          client,
          data: data(selection.selected),
          experimentPrefix: `agent-${selection.split}`,
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
            promptVersion: AGENT_PROMPT_VERSION,
            evaluatorVersion: 1,
            requestedModel: TIMELINE_MODELS.agent.id,
            synthetic: true,
            retrieval: 'controlled',
          },
          disableEvaluatorTracing: true,
          evaluators: [
            ({ outputs }: { outputs: Record<string, unknown> }) => {
              const row = outputs as unknown as AgentResult;
              return {
                results: Object.entries(row.score.criteria)
                  .map(([key, value]) => ({ key, score: Number(value) }))
                  .concat([
                    { key: 'passed', score: Number(row.score.passed) },
                    { key: 'hard_failure', score: Number(row.score.hardFailure) },
                  ]),
              };
            },
          ],
        },
      );
      const feedbackComplete =
        experiment.results.length === selection.selected.length &&
        experiment.results.every((row) => row.evaluationResults.results.length === 8);
      const summary = summarizeAgent(rows);
      reports.push({
        model: TIMELINE_MODELS.agent.id,
        repetition,
        experiment: experiment.experimentName,
        feedbackComplete,
        summary,
        rows: rows.sort((a, b) => a.id.localeCompare(b.id)),
      });
      console.log(
        JSON.stringify({
          repetition,
          experiment: experiment.experimentName,
          feedbackComplete,
          summary,
        }),
      );
      // Checkpoint completed repetitions so later infrastructure failure cannot erase evidence.
      await writeFile(
        requireValue(values.out),
        `${JSON.stringify({ datasetName, corpusHash, revision, dirty, split: selection.split, evaluatedAt: new Date().toISOString(), reports }, null, 2)}\n`,
      );
    }
  } finally {
    await harness.close();
    await client.awaitPendingTraceBatches();
  }
  if (
    reports.some(
      (report) =>
        !report.feedbackComplete ||
        report.summary.failures > 0 ||
        report.summary.hardFailures > 0 ||
        report.summary.passed !== report.summary.cases,
    )
  )
    process.exitCode = 1;
}
