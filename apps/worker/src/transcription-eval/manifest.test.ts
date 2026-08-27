/**
 * The quality bake-off must reject incomplete or unapproved corpora before any
 * provider call. These unit tests use synthetic metadata only and touch no files,
 * customer data, or external services.
 */
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseTranscriptionEvalManifest,
  resolveTranscriptionEvalAudioPath,
  TranscriptionEvalManifestError,
} from '#src/transcription-eval/manifest.js';
import { buildValidTranscriptionEvalManifest } from '#src/transcription-eval/test-fixtures.js';

describe('transcription eval manifest', () => {
  it('accepts an approved 24-language corpus covering every required dimension', () => {
    const manifest = buildValidTranscriptionEvalManifest();

    expect(parseTranscriptionEvalManifest(manifest)).toEqual(manifest);
  });

  it('rejects customer data and fewer than 24 distinct languages', () => {
    const manifest = buildValidTranscriptionEvalManifest();
    const unsafe = {
      ...manifest,
      fixturePolicy: { ...manifest.fixturePolicy, containsCustomerData: true },
      cases: manifest.cases.map((fixture) => ({ ...fixture, language: 'en' })),
    };

    expect(() => parseTranscriptionEvalManifest(unsafe)).toThrow(TranscriptionEvalManifestError);
  });

  it('requires representation across at least eight language families', () => {
    const manifest = buildValidTranscriptionEvalManifest();
    const oneFamily = {
      ...manifest,
      cases: manifest.cases.map((fixture) => ({ ...fixture, languageFamily: 'one-family' })),
    };

    expect(() => parseTranscriptionEvalManifest(oneFamily)).toThrow(
      /8 distinct language families/u,
    );
  });

  it('rejects a corpus that omits a production format, source, or stress scenario', () => {
    const manifest = buildValidTranscriptionEvalManifest();
    const missingCoverage = {
      ...manifest,
      cases: manifest.cases.map((fixture) => ({
        ...fixture,
        format: 'wav' as const,
        source: 'web_voice_note' as const,
        scenarios: ['accent' as const],
        referenceText: fixture.referenceText || 'Synthetic non-silence replacement',
      })),
    };

    expect(() => parseTranscriptionEvalManifest(missingCoverage)).toThrow(/audio format/u);
  });

  it('rejects path traversal both at schema validation and resolution time', async () => {
    const manifest = buildValidTranscriptionEvalManifest();
    const unsafe = {
      ...manifest,
      cases: [{ ...manifest.cases[0], audioPath: '../private.wav' }, ...manifest.cases.slice(1)],
    };

    expect(() => parseTranscriptionEvalManifest(unsafe)).toThrow(TranscriptionEvalManifestError);
    await expect(
      resolveTranscriptionEvalAudioPath('/tmp/corpus', '../private.wav'),
    ).rejects.toThrow(/escapes/u);
  });

  it('rejects an audio symlink that resolves outside the approved corpus', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'timeline-transcription-eval-'));
    const corpus = path.join(parent, 'corpus');
    const outside = path.join(parent, 'customer-audio.wav');
    try {
      await mkdir(path.join(corpus, 'audio'), { recursive: true });
      await writeFile(outside, 'not real audio');
      await symlink(outside, path.join(corpus, 'audio', 'fixture.wav'));

      await expect(resolveTranscriptionEvalAudioPath(corpus, 'audio/fixture.wav')).rejects.toThrow(
        /escapes/u,
      );
      const realOutside = await realpath(outside);
      await expect(realpath(path.join(corpus, 'audio', 'fixture.wav'))).resolves.toBe(realOutside);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('requires entity and number targets for the corresponding accuracy slices', () => {
    const manifest = buildValidTranscriptionEvalManifest();
    const withoutTargets = {
      ...manifest,
      cases: manifest.cases.map((fixture) => ({
        ...fixture,
        ...(fixture.scenarios.includes('names') ? { entities: undefined } : {}),
      })),
    };

    expect(() => parseTranscriptionEvalManifest(withoutTargets)).toThrow(/expected entities/u);
  });
});
