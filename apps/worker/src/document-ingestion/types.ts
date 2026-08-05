/**
 * Result of isolated PDF parsing inside a Daytona sandbox.
 * Vision fallback (sparse text / page images) runs in the extract service.
 */
export interface SandboxPdfExtractResult {
  text: string;
  method: string;
  pageCount: number;
  sparse: boolean;
  /** PNG page bytes for vision when text is sparse. */
  pageImages: Buffer[];
  error?: string;
}

export interface SandboxDocxExtractResult {
  text: string;
  error?: string;
}

/** Model stamp for Daytona sandbox PDF text extraction. */
export const PDF_SANDBOX_MODEL = 'daytona-pdfplumber-pypdfium2@1';

/** Model stamp for Daytona sandbox DOCX text extraction. */
export const DOCX_SANDBOX_MODEL = 'daytona-python-docx@1';

export function maxVisionPages(configured: number): number {
  return Math.max(1, Math.min(configured, 100));
}

export function shouldAcceptSandboxPdfText(
  result: Pick<SandboxPdfExtractResult, 'text' | 'sparse'>,
  _sparseChars?: number,
): boolean {
  // Trust the sandbox sparse flag (computed with DOCUMENT_EXTRACT_SPARSE_TEXT_CHARS).
  const text = result.text.trim();
  return Boolean(text) && !result.sparse;
}
