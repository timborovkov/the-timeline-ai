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
  /** PDF metadata Title when present (dense text path). */
  title?: string;
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

/**
 * Thrown when PDF/DOCX extract needs Daytona but `DAYTONA_API_KEY` is unset
 * and the in-process escape hatch is off. Callers must fail closed — do not
 * fall through to vision on a credentialed full worker.
 */
export class DaytonaNotConfiguredError extends Error {
  readonly code = 'DAYTONA_NOT_CONFIGURED' as const;

  constructor(surface: 'PDF' | 'DOCX') {
    super(
      `Daytona is not configured for ${surface} extraction (set DAYTONA_API_KEY or DOCUMENT_EXTRACT_ALLOW_INPROCESS=true for local escape hatch)`,
    );
    this.name = 'DaytonaNotConfiguredError';
  }
}

export function isDaytonaNotConfiguredError(err: unknown): err is DaytonaNotConfiguredError {
  return (
    err instanceof DaytonaNotConfiguredError ||
    (err instanceof Error && err.name === 'DaytonaNotConfiguredError')
  );
}

/**
 * Reject sandbox PDF text that is long enough to look "dense" but is not
 * plausible natural language (garbled OCR, binary mojibake, symbol soup).
 * Sparse / empty results are already rejected via `sparse`.
 */
export function isPlausibleSandboxPdfText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const letters = trimmed.match(/\p{L}/gu)?.length ?? 0;
  const letterRatio = letters / trimmed.length;
  if (letterRatio < 0.35) return false;

  const replacementOrControl =
    trimmed.match(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu)?.length ?? 0;
  if (replacementOrControl / trimmed.length > 0.02) return false;

  const words = trimmed.split(/\s+/u).filter((w) => /\p{L}{2,}/u.test(w));
  // Long runs with almost no word-shaped tokens are almost always garbage.
  if (trimmed.length >= 80 && words.length < 3) return false;

  return true;
}

export function shouldAcceptSandboxPdfText(
  result: Pick<SandboxPdfExtractResult, 'text' | 'sparse'>,
  _sparseChars?: number,
): boolean {
  // Trust the sandbox sparse flag (computed with DOCUMENT_EXTRACT_SPARSE_TEXT_CHARS),
  // then require plausible text so dense OCR garbage falls through to vision.
  const text = result.text.trim();
  return Boolean(text) && !result.sparse && isPlausibleSandboxPdfText(text);
}
