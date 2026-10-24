import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

export const TRANSCRIPTION_EVAL_FORMATS = [
  'wav',
  'mp3',
  'flac',
  'm4a',
  'ogg',
  'webm',
  'aac',
] as const;

export const TRANSCRIPTION_EVAL_SOURCES = [
  'web_voice_note',
  'telegram_voice',
  'slack_audio',
  'email_audio',
] as const;

export const TRANSCRIPTION_EVAL_SCENARIOS = [
  'accent',
  'background_noise',
  'silence',
  'names',
  'numbers',
  'long_low_bitrate',
  'code_switching',
] as const;

export type TranscriptionEvalFormat = (typeof TRANSCRIPTION_EVAL_FORMATS)[number];
export type TranscriptionEvalSource = (typeof TRANSCRIPTION_EVAL_SOURCES)[number];
export type TranscriptionEvalScenario = (typeof TRANSCRIPTION_EVAL_SCENARIOS)[number];

const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const languageSchema = z
  .string()
  .min(2)
  .max(35)
  .regex(/^[a-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u);
const relativeAudioPathSchema = z
  .string()
  .min(1)
  .max(500)
  .superRefine((value, context) => {
    if (path.isAbsolute(value) || value.includes('\\')) {
      context.addIssue({ code: 'custom', message: 'must be a portable relative path' });
      return;
    }
    const normalized = path.posix.normalize(value);
    if (normalized === '..' || normalized.startsWith('../')) {
      context.addIssue({ code: 'custom', message: 'must stay inside the corpus directory' });
    }
  });

const sourceMetadataSchema = z
  .object({
    durationMs: z.number().positive(),
    sampleRateHz: z.number().int().positive().optional(),
    channels: z.number().int().min(1).max(32).optional(),
    bitrateKbps: z.number().positive().optional(),
    codec: z.string().min(1).max(80).optional(),
    container: z.string().min(1).max(80).optional(),
    accent: z.string().min(1).max(100).optional(),
    noiseClass: z.string().min(1).max(100).optional(),
    captureDeviceClass: z.string().min(1).max(100).optional(),
  })
  .strict();

const fixtureCaseSchema = z
  .object({
    id: slugSchema,
    audioPath: relativeAudioPathSchema,
    format: z.enum(TRANSCRIPTION_EVAL_FORMATS),
    language: languageSchema,
    languageFamily: z.string().min(1).max(100),
    referenceText: z.string().max(100_000),
    source: z.enum(TRANSCRIPTION_EVAL_SOURCES),
    sourceMetadata: sourceMetadataSchema,
    scenarios: z.array(z.enum(TRANSCRIPTION_EVAL_SCENARIOS)).min(1),
    entities: z.array(z.string().min(1).max(500)).optional(),
    numbers: z.array(z.string().min(1).max(100)).optional(),
  })
  .strict();

const manifestSchema = z
  .object({
    schemaVersion: z.literal('transcription-quality-corpus-v1'),
    corpusId: slugSchema,
    fixturePolicy: z
      .object({
        origin: z.enum(['synthetic', 'licensed', 'explicitly_approved']),
        containsCustomerData: z.literal(false),
        approvedForExternalModelEvaluation: z.literal(true),
        licenseOrApprovalReference: z.string().min(1).max(500),
      })
      .strict(),
    cases: z.array(fixtureCaseSchema).min(24),
  })
  .strict();

export type TranscriptionEvalManifest = z.infer<typeof manifestSchema>;
export type TranscriptionEvalCase = TranscriptionEvalManifest['cases'][number];

export interface LoadedTranscriptionEvalManifest {
  manifest: TranscriptionEvalManifest;
  manifestDirectory: string;
  manifestSha256: string;
}

export class TranscriptionEvalManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionEvalManifestError';
  }
}

function coverageError(label: string, missing: readonly string[]): TranscriptionEvalManifestError {
  return new TranscriptionEvalManifestError(
    `Corpus does not cover every ${label}; missing ${missing.join(', ')}`,
  );
}

function missingValues<T extends string>(
  required: readonly T[],
  observed: ReadonlySet<string>,
): T[] {
  return required.filter((value) => !observed.has(value));
}

/**
 * Validate the complete quality corpus before a single paid provider request is made.
 * The gate deliberately requires every currently accepted production audio format and
 * capture surface so a model cannot pass on a convenient subset.
 */
export function parseTranscriptionEvalManifest(input: unknown): TranscriptionEvalManifest {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    const issueSummary = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join('.') || 'manifest'}:${issue.code}`)
      .join(', ');
    throw new TranscriptionEvalManifestError(`Invalid corpus manifest (${issueSummary})`);
  }

  const manifest = parsed.data;
  const ids = new Set<string>();
  const languages = new Set<string>();
  const languageFamilies = new Set<string>();
  const formats = new Set<string>();
  const sources = new Set<string>();
  const scenarios = new Set<string>();

  for (const fixture of manifest.cases) {
    if (ids.has(fixture.id)) {
      throw new TranscriptionEvalManifestError('Corpus case IDs must be unique');
    }
    ids.add(fixture.id);
    languages.add(fixture.language.toLowerCase());
    languageFamilies.add(fixture.languageFamily.toLocaleLowerCase('und'));
    formats.add(fixture.format);
    sources.add(fixture.source);
    for (const scenario of fixture.scenarios) scenarios.add(scenario);

    const isSilence = fixture.scenarios.includes('silence');
    if (isSilence && fixture.referenceText.trim().length > 0) {
      throw new TranscriptionEvalManifestError('Silence cases must have an empty reference');
    }
    if (!isSilence && fixture.referenceText.trim().length === 0) {
      throw new TranscriptionEvalManifestError('Non-silence cases require a reference');
    }
    if (fixture.scenarios.includes('names') && !fixture.entities?.length) {
      throw new TranscriptionEvalManifestError('Name cases require expected entities');
    }
    if (fixture.scenarios.includes('numbers') && !fixture.numbers?.length) {
      throw new TranscriptionEvalManifestError('Number cases require expected numbers');
    }
  }

  if (languages.size < 24) {
    throw new TranscriptionEvalManifestError(
      `Corpus requires at least 24 distinct languages; found ${String(languages.size)}`,
    );
  }
  if (languageFamilies.size < 8) {
    throw new TranscriptionEvalManifestError(
      `Corpus requires at least 8 distinct language families; found ${String(languageFamilies.size)}`,
    );
  }

  const missingFormats = missingValues(TRANSCRIPTION_EVAL_FORMATS, formats);
  if (missingFormats.length > 0) throw coverageError('audio format', missingFormats);
  const missingSources = missingValues(TRANSCRIPTION_EVAL_SOURCES, sources);
  if (missingSources.length > 0) throw coverageError('capture source', missingSources);
  const missingScenarios = missingValues(TRANSCRIPTION_EVAL_SCENARIOS, scenarios);
  if (missingScenarios.length > 0)
    throw coverageError('required stress scenario', missingScenarios);

  return manifest;
}

export async function loadTranscriptionEvalManifest(
  manifestPath: string,
): Promise<LoadedTranscriptionEvalManifest> {
  let resolvedManifestPath: string;
  let bytes: Buffer;
  try {
    resolvedManifestPath = await realpath(manifestPath);
    bytes = await readFile(resolvedManifestPath);
  } catch (error) {
    throw new TranscriptionEvalManifestError(
      `Could not read corpus manifest (${error instanceof Error ? error.name : 'unknown error'})`,
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new TranscriptionEvalManifestError('Corpus manifest is not valid JSON');
  }

  return {
    manifest: parseTranscriptionEvalManifest(input),
    manifestDirectory: path.dirname(resolvedManifestPath),
    manifestSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function resolveTranscriptionEvalAudioPath(
  manifestDirectory: string,
  audioPath: string,
): Promise<string> {
  const root = path.resolve(manifestDirectory);
  const resolved = path.resolve(root, audioPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new TranscriptionEvalManifestError('Audio path escapes the corpus directory');
  }

  let realRoot: string;
  let realAudioPath: string;
  try {
    [realRoot, realAudioPath] = await Promise.all([realpath(root), realpath(resolved)]);
  } catch (error) {
    throw new TranscriptionEvalManifestError(
      `Could not resolve corpus audio path (${error instanceof Error ? error.name : 'unknown error'})`,
    );
  }
  if (realAudioPath !== realRoot && !realAudioPath.startsWith(`${realRoot}${path.sep}`)) {
    throw new TranscriptionEvalManifestError('Audio path escapes the corpus directory');
  }
  return realAudioPath;
}
