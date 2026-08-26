import {
  TRANSCRIPTION_EVAL_FORMATS,
  TRANSCRIPTION_EVAL_SCENARIOS,
  TRANSCRIPTION_EVAL_SOURCES,
  type TranscriptionEvalManifest,
} from '#src/transcription-eval/manifest.js';

const LANGUAGES = [
  'en',
  'fi',
  'et',
  'sv',
  'de',
  'fr',
  'es',
  'pt',
  'it',
  'nl',
  'pl',
  'cs',
  'uk',
  'tr',
  'ar',
  'he',
  'hi',
  'bn',
  'ta',
  'zh',
  'ja',
  'ko',
  'id',
  'sw',
] as const;

export function buildValidTranscriptionEvalManifest(): TranscriptionEvalManifest {
  return {
    schemaVersion: 'transcription-quality-corpus-v1',
    corpusId: 'synthetic-multilingual-v1',
    fixturePolicy: {
      origin: 'synthetic',
      containsCustomerData: false,
      approvedForExternalModelEvaluation: true,
      licenseOrApprovalReference: 'repository-generated-test-fixture',
    },
    cases: LANGUAGES.map((language, index) => {
      const scenario = TRANSCRIPTION_EVAL_SCENARIOS[index % TRANSCRIPTION_EVAL_SCENARIOS.length];
      const referenceText =
        scenario === 'silence'
          ? ''
          : scenario === 'names'
            ? 'Alice meets Bob at Timeline'
            : scenario === 'numbers'
              ? 'Project 42 closes in 2026'
              : scenario === 'long_low_bitrate'
                ? 'This deliberately long synthetic sentence checks whether the provider cuts off the final part of a low bitrate recording before the expected ending arrives.'
                : scenario === 'code_switching'
                  ? 'Hello maailma this is synthetic'
                  : `Synthetic speech sample ${String(index + 1)}`;
      return {
        id: `case-${String(index + 1).padStart(2, '0')}`,
        audioPath: `audio/case-${String(index + 1).padStart(2, '0')}.${TRANSCRIPTION_EVAL_FORMATS[index % TRANSCRIPTION_EVAL_FORMATS.length]}`,
        format: TRANSCRIPTION_EVAL_FORMATS[index % TRANSCRIPTION_EVAL_FORMATS.length] ?? 'wav',
        language,
        languageFamily: `family-${String(index % 8)}`,
        referenceText,
        source:
          TRANSCRIPTION_EVAL_SOURCES[index % TRANSCRIPTION_EVAL_SOURCES.length] ?? 'web_voice_note',
        sourceMetadata: {
          durationMs: 1_000 + index,
          sampleRateHz: 16_000,
          channels: 1,
          bitrateKbps: scenario === 'long_low_bitrate' ? 16 : 64,
          codec: 'synthetic-test-codec',
          accent: scenario === 'accent' ? 'synthetic-accent' : 'neutral-synthetic',
          noiseClass: scenario === 'background_noise' ? 'synthetic-office' : 'clean',
          captureDeviceClass: 'test-generator',
        },
        scenarios: [scenario ?? 'accent'],
        ...(scenario === 'names' ? { entities: ['Alice', 'Bob', 'Timeline'] } : {}),
        ...(scenario === 'numbers' ? { numbers: ['42', '2026'] } : {}),
      };
    }),
  };
}
