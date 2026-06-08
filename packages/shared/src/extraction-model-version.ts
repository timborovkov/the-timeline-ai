import { TIMELINE_MODELS } from '#src/llm/models.js';

export const EXTRACTION_CODE_VERSION = '2026-05-a';

export function makeExtractionModelVersion(modelId: string): string {
  return `${modelId}@${EXTRACTION_CODE_VERSION}`;
}

export function currentExtractionModelVersion(): string {
  return makeExtractionModelVersion(TIMELINE_MODELS.extraction.id);
}

export function currentExtractionModelVersions(): string[] {
  return [
    makeExtractionModelVersion(TIMELINE_MODELS.extraction.id),
    makeExtractionModelVersion(TIMELINE_MODELS.structuredFallback.id),
  ];
}
