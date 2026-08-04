import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { processPdf } from '@firecrawl/pdf-inspector';
import { describe, expect, it } from 'vitest';

import {
  type NativePdfExtractResult,
  shouldAcceptNativePdf,
} from '#src/workers/pdfNativeExtract.js';

/**
 * Real `@firecrawl/pdf-inspector` binary + fixture proofs. These are not
 * mocked: they load the napi binding and classify committed PDF bytes so
 * Railway (glibc) / Alpine (musl) packaging regressions fail loudly.
 */

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/pdfs');

function loadFixture(name: string): Buffer {
  return readFileSync(join(fixturesDir, name));
}

function toNativeResult(result: ReturnType<typeof processPdf>): NativePdfExtractResult {
  return {
    pdfType: result.pdfType,
    confidence: result.confidence,
    hasEncodingIssues: result.hasEncodingIssues,
    ...(result.markdown !== undefined ? { markdown: result.markdown } : {}),
    ...(result.title ? { title: result.title } : {}),
  };
}

describe('shouldAcceptNativePdf', () => {
  it('accepts confident TextBased markdown and rejects other cases', () => {
    expect(
      shouldAcceptNativePdf({
        pdfType: 'TextBased',
        confidence: 0.8,
        hasEncodingIssues: false,
        markdown: 'ok',
      }),
    ).toBe(true);
    expect(
      shouldAcceptNativePdf({
        pdfType: 'TextBased',
        confidence: 0.79,
        hasEncodingIssues: false,
        markdown: 'ok',
      }),
    ).toBe(false);
    expect(
      shouldAcceptNativePdf({
        pdfType: 'Scanned',
        confidence: 1,
        hasEncodingIssues: false,
        markdown: 'ghost text layer',
      }),
    ).toBe(false);
  });
});

describe('pdf-inspector native binary + fixtures', () => {
  it('loads the native binding and exports processPdf', () => {
    expect(typeof processPdf).toBe('function');
  });

  it('classifies the text-based fixture as natively acceptable', () => {
    const result = processPdf(loadFixture('text-based-dummy.pdf'));
    expect(result.pdfType).toBe('TextBased');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.hasEncodingIssues).toBe(false);
    expect(result.markdown).toMatch(/Dummy PDF file/i);
    // Library quirk: TextBased PDFs may still list pagesNeedingOcr.
    expect(result.pagesNeedingOcr.length).toBeGreaterThan(0);
    expect(shouldAcceptNativePdf(toNativeResult(result))).toBe(true);
  });

  it('rejects the image-only fixture so vision fallback would run', () => {
    const result = processPdf(loadFixture('image-only.pdf'));
    expect(result.pdfType).toMatch(/^(Scanned|ImageBased|Mixed)$/);
    expect(shouldAcceptNativePdf(toNativeResult(result))).toBe(false);
  });
});
