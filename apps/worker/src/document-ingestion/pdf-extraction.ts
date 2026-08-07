import { getEnv } from '@timeline/shared';

import {
  extractOfficeInDaytonaSandbox,
  extractPdfInDaytonaSandbox,
  isDaytonaConfigured,
} from '#src/document-ingestion/daytona.js';
import {
  DaytonaNotConfiguredError,
  type SandboxOfficeExtractResult,
  type SandboxPdfExtractResult,
} from '#src/document-ingestion/types.js';

export {
  ANYDOC_SANDBOX_MODEL,
  resolveAnydocFormatHint,
  shouldAcceptSandboxPdfText,
  type SandboxOfficeExtractResult,
  type SandboxPdfExtractResult,
} from '#src/document-ingestion/types.js';

/**
 * Resolve PDF extraction: Daytona sandbox by default; optional in-process
 * escape hatch only when `DOCUMENT_EXTRACT_ALLOW_INPROCESS=true` (or `1`)
 * and Daytona is unset (dev). In-process PDF path returns empty text so the
 * caller falls through to vision without opening a native PDF parser.
 */
export async function extractPdfForDocument(body: Buffer): Promise<SandboxPdfExtractResult> {
  if (isDaytonaConfigured()) {
    return extractPdfInDaytonaSandbox(body);
  }
  const env = getEnv();
  if (env.DOCUMENT_EXTRACT_ALLOW_INPROCESS) {
    return {
      text: '',
      method: 'inprocess-vision-only',
      pageCount: 0,
      sparse: true,
      pageImages: [],
    };
  }
  throw new DaytonaNotConfiguredError('PDF');
}

/**
 * Office formats via Daytona anydoc. In-process hatch only supports DOCX
 * via mammoth; other office formats require Daytona.
 */
export async function extractOfficeForDocument(
  body: Buffer,
  formatHint: string,
): Promise<SandboxOfficeExtractResult> {
  const format = formatHint.trim().toLowerCase();
  if (isDaytonaConfigured()) {
    return extractOfficeInDaytonaSandbox(body, format);
  }
  const env = getEnv();
  if (env.DOCUMENT_EXTRACT_ALLOW_INPROCESS && (format === 'docx' || format === 'docm')) {
    // Dev escape hatch: mammoth stays local-only and is never loaded on
    // the production extract hot path when Daytona is configured.
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: body });
    return { text: result.value, method: 'inprocess-mammoth' };
  }
  throw new DaytonaNotConfiguredError('office');
}
