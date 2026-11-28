import { expect, test } from 'bun:test';

import { evidenceNamePattern, repairEvidencePassages } from '#src/workers/proposal-evidence.js';

test('matches typographic variants and retains exact source offsets and whole names', () => {
  const text = 'Morgan O’Neil and Cedar–North rollout';
  for (const [name, cited] of [
    ["Morgan O'Neil", 'Morgan O’Neil'],
    ['Cedar-North rollout', 'Cedar–North rollout'],
  ] as const) {
    expect(evidenceNamePattern([name]).exec(text)?.[0]).toBe(cited);
  }
  for (const nearMiss of ['Morgan ONeil', 'Cedar North rollout', 'Morgan O’Ne', 'North roll']) {
    expect(evidenceNamePattern([nearMiss]).test(text)).toBe(false);
  }
});

test('locates a name and organization in unspaced Japanese prose', () => {
  const source = { rawEventId: 'jp', text: '青空物流の担当者は山田太郎です。' };
  expect(repairEvidencePassages([source], ['青空物流'])).toEqual([source]);
  expect(evidenceNamePattern(['山田太郎']).exec(source.text)?.[0]).toBe('山田太郎');
});

test('retains exact passages across newer sources and a long document with several object mentions', () => {
  const appointment = 'Casey Lane coordinates Juniper.';
  const text =
    'Juniper inventory. ' +
    'Filed. '.repeat(1500) +
    appointment +
    ' Filed.'.repeat(1500) +
    ' Juniper.';
  const sources = Array.from({ length: 79 }, (_, i) => ({
    rawEventId: String(i),
    text: 'Juniper office inventory.',
  }));
  const result = repairEvidencePassages(
    [
      ...sources,
      { rawEventId: 'old', text, factStatements: ['Invented appointment.', appointment] },
    ],
    ['Juniper'],
  );
  const excerpts = result.filter((row) => row.rawEventId === 'old');
  expect(excerpts.some((row) => row.text.includes(appointment))).toBe(true);
  expect(excerpts.every((row) => text.includes(row.text))).toBe(true);
  expect(result.reduce((sum, row) => sum + row.text.length, 0)).toBeLessThanOrEqual(48000);
  expect(new Set(result.map((row) => row.rawEventId)).size).toBe(80);
});
