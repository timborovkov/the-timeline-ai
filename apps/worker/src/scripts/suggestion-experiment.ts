import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { syncBenchmark, requireValue } from '@timeline/shared/evals/benchmark';
import { TIMELINE_MODELS } from '@timeline/shared/llm';
import { Client } from 'langsmith';
import { evaluate } from 'langsmith/evaluation';

import {
  COMMUNICATION_CASES,
  selectCommunications,
  validateCommunicationCases,
} from '#src/evals/communication-cases.js';
import { createCommunicationHarness } from '#src/evals/communication-harness.js';
import {
  scoreCommunications,
  summarizeCommunications,
  type CommunicationResult,
} from '#src/evals/communication-report.js';
import type {
  CommunicationCase,
  CommunicationObservation,
} from '#src/evals/communication-types.js';
import {
  SUGGESTION_CASES,
  selectSuggestionCases,
  validateSuggestionCases,
} from '#src/evals/suggestion-cases.js';
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
    suite: { type: 'string' },
    split: { type: 'string' },
    repeats: { type: 'string' },
    limit: { type: 'string' },
    tag: { type: 'string' },
    out: { type: 'string' },
  },
  strict: true,
});
if (process.env.NODE_ENV === 'production')
  throw new Error('Synthetic experiments cannot run in production');
if (!process.env.LANGSMITH_API_KEY) throw new Error('LANGSMITH_API_KEY is required');
const suite = values.suite ?? 'suggestions';
if (suite !== 'suggestions' && suite !== 'communications') throw new Error('Invalid --suite');
const communications = suite === 'communications';
if (communications) validateCommunicationCases();
else validateSuggestionCases();
const selection = communications ? selectCommunications(values) : selectSuggestionCases(values);
if (!values.sync) {
  if (
    !values.out ||
    (!process.env.OPENROUTER_API_KEY &&
      selection.selected.some((row) => !row.tags.includes('github-completion')))
  )
    throw new Error('Require --out=<new report.json> and OPENROUTER_API_KEY');
  const file = await open(values.out, 'wx');
  await file.close();
}
const client = new Client();
const { datasetName, corpusHash, data } = await syncBenchmark(
  client,
  suite,
  communications ? COMMUNICATION_CASES : SUGGESTION_CASES,
  selection.corpus,
  selection.split,
  (row) =>
    communications
      ? { outcome: (row as CommunicationCase).outcome, rationale: row.rationale }
      : { expected: row.expected, allowed: row.allowed ?? [], rationale: row.rationale },
);
if (!values.sync) {
  // Never connect to production stores or broad production tracing. Only this synthetic process.
  process.env.DATABASE_URL = 'postgresql://127.0.0.1/timeline_synthetic_eval';
  delete process.env.QDRANT_URL;
  if (communications) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = 'redis://127.0.0.1:1';
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
  const implementationHash = createHash('sha256');
  for (const path of [
    '../workers/suggestions.ts',
    '../workers/communication-policy.ts',
    '../workers/communication-grounding.ts',
    '../evals/communication-gap-cases.ts',
    '../../../../packages/shared/src/suggestions/linked-hubs.ts',
    '../evals/communication-harness.ts',
    '../evals/communication-cases.ts',
    '../../../../packages/shared/src/suggestions/hub-context.ts',
    '../evals/communication-report.ts',
    '../../../../packages/shared/src/suggestions/index.ts',
    '../../../../packages/shared/src/suggestions/proposal-payload.ts',
    '../../../../packages/shared/src/conversation-review/index.ts',
  ])
    implementationHash.update(await readFile(new URL(path, import.meta.url)));
  const implementationDigest = implementationHash.digest('hex');
  // Each concurrent communication case owns a separate database and queue.
  const harnesses = [];
  for (let index = 0; index < (communications ? 4 : 1); index++)
    harnesses.push(
      communications ? await createCommunicationHarness() : await createSuggestionHarness(),
    );
  const available = [...harnesses];
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
  let checkpointChain = Promise.resolve();
  const checkpoint = () => {
    const content = `${JSON.stringify({ suite, datasetName, corpusHash, implementationDigest, revision, dirty, split: selection.split, evaluatedAt: new Date().toISOString(), reports, inProgress }, null, 2)}\n`;
    checkpointChain = checkpointChain.then(() => writeFile(requireValue(values.out), content));
    return checkpointChain;
  };
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
          const harness = requireValue(available.shift());
          try {
            observation = await harness.run(row as CommunicationCase);
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
              ...(communications
                ? {
                    nodes: [],
                    edges: [],
                    acceptanceErrors: 0,
                    acceptanceFailureReasons: [],
                    duplicateProposals: 0,
                    packetLoss: [],
                    protectedPendingChanged: false,
                    uncertaintyMissing: false,
                    capturedEvents: 0,
                    queuedJobs: 0,
                    source: row.source,
                    familyId: row.familyId,
                  }
                : {}),
            };
          }
          available.push(harness);
          const result = {
            ...observation,
            id: row.id,
            tags: row.tags,
            score: communications
              ? scoreCommunications(
                  row as CommunicationCase,
                  observation as CommunicationObservation,
                )
              : scoreSuggestions(row, observation),
          };
          rows.push(result);
          await checkpoint();
          return result;
        },
        {
          client,
          data: data(selection.selected),
          experimentPrefix: `${suite}-${selection.split}`,
          maxConcurrency: harnesses.length,
          metadata: {
            revision,
            dirty,
            corpusHash,
            implementationDigest,
            split: selection.split,
            repetition,
            partial: !selection.complete,
            benchmark: selection.benchmark,
            evaluatedAt: new Date().toISOString(),
            evaluatorVersion: communications ? 6 : 2,
            requestedModel: selection.selected.every((row) =>
              row.tags.includes('github-completion'),
            )
              ? 'none-deterministic'
              : TIMELINE_MODELS.extraction.id,
            scenarioFilter: values.tag ?? null,
            synthetic: true,
            retrieval: 'database-only',
            pipeline: communications
              ? 'capture-to-approved-graph'
              : 'raw-event-to-visible-proposal',
            suite,
            concurrency: harnesses.length,
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
      const summary = communications
        ? summarizeCommunications(rows as CommunicationResult[])
        : summarizeSuggestions(rows);
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
    await Promise.all(harnesses.map((harness) => harness.close()));
    await client.awaitPendingTraceBatches();
  }
  if (
    reports.some(
      (report) => !report.feedbackComplete || report.summary.passed !== report.summary.cases,
    )
  )
    process.exitCode = 1;
}
