export const DOCUMENT_PROCESSING_STATUSES = [
  'pending',
  'extracting',
  'chunked',
  'embedded',
  'deferred',
  'failed',
] as const;
export type DocumentProcessingStatus = (typeof DOCUMENT_PROCESSING_STATUSES)[number];

export const EXTRACTED_REPRESENTATION_KINDS = [
  'source_text',
  'transcript',
  'visual_description',
  'metadata_preview',
] as const;
export type ExtractedRepresentationKind = (typeof EXTRACTED_REPRESENTATION_KINDS)[number];
