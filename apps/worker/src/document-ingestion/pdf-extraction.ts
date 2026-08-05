import { getEnv } from '@timeline/shared';

import {
  extractDocxInDaytonaSandbox,
  extractPdfInDaytonaSandbox,
  isDaytonaConfigured,
} from '#src/document-ingestion/daytona.js';
import {
  DaytonaNotConfiguredError,
  type SandboxDocxExtractResult,
  type SandboxPdfExtractResult,
} from '#src/document-ingestion/types.js';

export {
  DaytonaNotConfiguredError,
  DOCX_SANDBOX_MODEL,
  isDaytonaNotConfiguredError,
  PDF_SANDBOX_MODEL,
  shouldAcceptSandboxPdfText,
  type SandboxDocxExtractResult,
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

export async function extractDocxForDocument(body: Buffer): Promise<SandboxDocxExtractResult> {
  if (isDaytonaConfigured()) {
    return extractDocxInDaytonaSandbox(body);
  }
  const env = getEnv();
  if (env.DOCUMENT_EXTRACT_ALLOW_INPROCESS) {
    // Dev escape hatch: mammoth stays local-only and is never loaded on
    // the production extract hot path when Daytona is configured.
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: body });
    return { text: result.value };
  }
  throw new DaytonaNotConfiguredError('DOCX');
}
