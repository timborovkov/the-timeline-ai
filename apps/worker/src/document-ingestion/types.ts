/**
 * Result of isolated document parsing inside a Daytona sandbox.
 * Vision fallback (sparse PDF / page images) runs in the extract service.
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

/** Office / non-PDF anydoc sandbox result (no page images). */
export interface SandboxOfficeExtractResult {
  text: string;
  method: string;
  error?: string;
}

/** Model stamp for Daytona anydoc sandbox extraction. */
export const ANYDOC_SANDBOX_MODEL = 'daytona-anydoc@1';

export type DaytonaExtractSurface = 'PDF' | 'office' | 'DOCX';

export function maxVisionPages(configured: number): number {
  return Math.max(1, Math.min(configured, 100));
}

/**
 * Thrown when document extract needs Daytona but `DAYTONA_API_KEY` is unset
 * and the in-process escape hatch is off. Callers must fail closed — do not
 * fall through to vision on a credentialed full worker.
 */
export class DaytonaNotConfiguredError extends Error {
  readonly code = 'DAYTONA_NOT_CONFIGURED' as const;

  constructor(surface: DaytonaExtractSurface) {
    const label = surface === 'DOCX' ? 'office' : surface;
    super(
      `Daytona is not configured for ${label} extraction (set DAYTONA_API_KEY or DOCUMENT_EXTRACT_ALLOW_INPROCESS=true for local escape hatch)`,
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

/**
 * Formats handled by Daytona anydoc (not UTF-8 text/*, not images).
 * CSV stays on the cheap UTF-8 path in the worker router.
 */
const ANYDOC_FORMAT_BY_EXTENSION: Record<string, string> = {
  // Word
  doc: 'doc',
  docx: 'docx',
  docm: 'docm',
  // PowerPoint
  ppt: 'ppt',
  pps: 'pps',
  pot: 'pot',
  pptx: 'pptx',
  pptm: 'pptm',
  ppsx: 'ppsx',
  ppsm: 'ppsm',
  // Excel
  xls: 'xls',
  xlsx: 'xlsx',
  xlsm: 'xlsm',
  xlsb: 'xlsb',
  // OpenDocument
  odt: 'odt',
  ods: 'ods',
  odp: 'odp',
  // Other
  rtf: 'rtf',
  epub: 'epub',
  pdf: 'pdf',
};

const ANYDOC_FORMAT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-word.document.macroenabled.12': 'docm',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow': 'ppsx',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12': 'pptm',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'xlsm',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12': 'xlsb',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'application/epub+zip': 'epub',
};

export function resolveAnydocFormatHint(contentType: string, filename: string): string | undefined {
  const ct = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (ct && ANYDOC_FORMAT_BY_MIME[ct]) {
    return ANYDOC_FORMAT_BY_MIME[ct];
  }
  const extMatch = /\.([a-z0-9]+)$/i.exec(filename);
  const ext = extMatch?.[1]?.toLowerCase();
  if (ext && ANYDOC_FORMAT_BY_EXTENSION[ext]) {
    return ANYDOC_FORMAT_BY_EXTENSION[ext];
  }
  return undefined;
}
