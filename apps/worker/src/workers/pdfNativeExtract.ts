/**
 * Native PDF extraction policy for the document-extract worker.
 *
 * `@firecrawl/pdf-inspector` classifies PDFs and extracts Markdown for
 * text-based documents. Scanned/mixed/unreliable results fall through to
 * the vision OCR path in `documentExtract.ts`.
 */

/** Model stamp for native pdf-inspector extractions (version-pinned). */
export const PDF_NATIVE_MODEL = 'pdf-inspector@1.12.0';

/** Minimum classifier confidence required to trust native PDF markdown. */
export const NATIVE_PDF_MIN_CONFIDENCE = 0.8;

export type NativePdfType = 'TextBased' | 'Scanned' | 'ImageBased' | 'Mixed';

export interface NativePdfExtractResult {
  pdfType: NativePdfType;
  confidence: number;
  markdown?: string;
  hasEncodingIssues: boolean;
  title?: string;
}

/**
 * Accept local markdown for text-based PDFs. Scanned/Mixed/ImageBased always
 * fall through to vision. Do not require empty `pagesNeedingOcr` — real
 * TextBased PDFs from pdf-inspector still report OCR pages even with good
 * markdown (verified against W3C dummy + confidence 1.0).
 */
export function shouldAcceptNativePdf(result: NativePdfExtractResult): boolean {
  return (
    result.pdfType === 'TextBased' &&
    result.confidence >= NATIVE_PDF_MIN_CONFIDENCE &&
    !result.hasEncodingIssues &&
    Boolean(result.markdown?.trim())
  );
}
