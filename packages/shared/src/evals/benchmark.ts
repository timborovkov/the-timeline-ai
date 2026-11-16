import { createHash } from 'node:crypto';

import { stableStringify } from '#src/suggestions/dedupe-key.js';

import type { Client } from 'langsmith';
import type { Example } from 'langsmith/schemas';

export type EvalSplit = 'development' | 'held-out';
export interface BenchmarkCase {
  id: string;
  familyId: string;
  split: EvalSplit;
  tags: string[];
  rationale: string;
}
export const hashCorpus = (value: unknown) =>
  createHash('sha256').update(stableStringify(value)).digest('hex');

export function selectBenchmark<T extends BenchmarkCase>(
  cases: T[],
  options: { split?: string; repeats?: string; limit?: string },
) {
  const split = options.split ?? 'development';
  if (split !== 'development' && split !== 'held-out') throw new Error('Invalid --split');
  const repeats = Number(options.repeats ?? 1);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10)
    throw new Error('Invalid --repeats (1–10)');
  const corpus = cases.filter((row) => row.split === split);
  const limit = Number(options.limit ?? corpus.length);
  if (!Number.isInteger(limit) || limit < 1 || limit > corpus.length)
    throw new Error('Invalid --limit');
  return {
    split,
    repeats,
    corpus,
    selected: corpus.slice(0, limit),
    complete: limit === corpus.length,
    benchmark: split === 'held-out' && limit === corpus.length,
  };
}

export function validateCases(cases: BenchmarkCase[]) {
  const ids = new Set<string>();
  const families = new Map<string, EvalSplit>();
  for (const row of cases) {
    if (ids.has(row.id)) throw new Error(`Duplicate case ${row.id}`);
    ids.add(row.id);
    if (!row.rationale.trim() || !row.familyId.trim() || !row.tags.length)
      throw new Error(`Incomplete case ${row.id}`);
    if (families.has(row.familyId) && families.get(row.familyId) !== row.split)
      throw new Error(`Family crosses splits: ${row.familyId}`);
    families.set(row.familyId, row.split);
  }
}

/** Git fixtures are authoritative; remote text is never executed. */
export async function syncBenchmark<T extends BenchmarkCase>(
  client: Client,
  suite: string,
  allCases: T[],
  corpus: T[],
  split: string,
  reference: (row: T) => Record<string, unknown>,
) {
  validateCases(allCases);
  const corpusHash = hashCorpus(allCases);
  const datasetName = `timeline-${suite}-${split}-${corpusHash.slice(0, 16)}`;
  const datasets = [];
  for await (const item of client.listDatasets({ datasetName })) datasets.push(item);
  const dataset =
    datasets.find((item) => item.name === datasetName) ??
    (await client.createDataset(datasetName, {
      description:
        'Versioned synthetic Git fixtures. Do not edit in the UI. Held-out runs are evaluation history, not fresh evidence after tuning.',
      metadata: { corpusHash, split, synthetic: true, schemaVersion: 2 },
    }));
  const examples: Example[] = [];
  for await (const example of client.listExamples({ datasetId: dataset.id }))
    examples.push(example);
  for (const row of corpus) {
    const matches = examples.filter((example) => example.inputs.caseId === row.id);
    const match = matches[0];
    if (
      matches.length > 1 ||
      (match &&
        (hashCorpus(match.outputs) !== hashCorpus(reference(row)) ||
          match.metadata?.corpusHash !== corpusHash))
    )
      throw new Error(`Remote dataset drift: ${row.id}`);
    if (!match)
      examples.push(
        await client.createExample({
          dataset_id: dataset.id,
          inputs: { caseId: row.id },
          reference_outputs: reference(row),
          metadata: { ...row, corpusHash, synthetic: true },
        }),
      );
  }
  if (examples.length !== corpus.length) throw new Error('Unexpected remote examples');
  const data = (selected: T[]): Example[] =>
    selected.map((row) => {
      const example = examples.find((item) => item.inputs.caseId === row.id);
      if (!example) throw new Error('Missing synced example');
      return {
        id: example.id,
        dataset_id: dataset.id,
        created_at: example.created_at,
        modified_at: example.modified_at ?? example.created_at,
        inputs: { caseId: row.id },
        outputs: reference(row),
        metadata: { synthetic: true, corpusHash, split },
        runs: [],
      };
    });
  // eslint-disable-next-line no-console -- CLI dataset identity contains no secrets.
  console.info(JSON.stringify({ datasetName, datasetId: dataset.id, examples: examples.length }));
  return { corpusHash, datasetName, data };
}

export function scenarioScores<T extends { tags: string[] }>(
  rows: T[],
  passed: (row: T) => boolean,
) {
  return [...new Set(rows.flatMap((row) => row.tags))].sort().map((scenario) => {
    const cases = rows.filter((row) => row.tags.includes(scenario));
    const correct = cases.filter(passed).length;
    return { scenario, cases: cases.length, correct, accuracy: correct / cases.length };
  });
}

export function requireValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Missing benchmark fixture value');
  return value;
}
