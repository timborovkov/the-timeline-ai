import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chdir } from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { shouldAcceptNativePdf } from '#src/workers/pdfNativeExtract.js';
import {
  isPdfInspectorNativeSupported,
  processPdfNativeOffThread,
} from '#src/workers/pdfNativeExtractRuntime.js';

/**
 * Real `@firecrawl/pdf-inspector` binary + fixture proofs. These are not
 * mocked: they load the napi binding off-thread (same path as production)
 * and classify committed PDF bytes so Railway (glibc) / Alpine (musl)
 * packaging regressions fail loudly without importing the binding at
 * worker module-evaluation time.
 *
 * Platforms without a published optional binary (e.g. Darwin x64) skip the
 * native fixture suite — production intentionally falls back to vision.
 */

const thisDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(thisDir, '../../test/fixtures/pdfs');
// apps/worker/src/workers -> repo root (four levels up).
const repoRoot = join(thisDir, '../../../..');

function loadFixture(name: string): Buffer {
  return readFileSync(join(fixturesDir, name));
}

const describeNative = isPdfInspectorNativeSupported() ? describe : describe.skip;

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

describeNative('pdf-inspector native binary + fixtures', () => {
  it('classifies the text-based fixture off-thread as natively acceptable', async () => {
    const result = await processPdfNativeOffThread(loadFixture('text-based-dummy.pdf'));
    expect(result.pdfType).toBe('TextBased');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.hasEncodingIssues).toBe(false);
    expect(result.markdown).toMatch(/Dummy PDF file/i);
    expect(shouldAcceptNativePdf(result)).toBe(true);
  });

  it('rejects the image-only fixture off-thread so vision fallback would run', async () => {
    const result = await processPdfNativeOffThread(loadFixture('image-only.pdf'));
    expect(result.pdfType).toMatch(/^(Scanned|ImageBased|Mixed)$/);
    expect(shouldAcceptNativePdf(result)).toBe(false);
  });

  it('resolves pdf-inspector when cwd is the repo root (Railway start path)', async () => {
    // apps/worker/railway.json starts `node apps/worker/dist/index.js` from
    // the repository root. Bare imports inside eval workers resolve from cwd
    // and would miss apps/worker/node_modules — we pass an absolute file URL
    // resolved from this module instead.
    const previousCwd = process.cwd();
    chdir(repoRoot);
    try {
      expect(process.cwd()).toBe(repoRoot);
      const result = await processPdfNativeOffThread(loadFixture('text-based-dummy.pdf'));
      expect(result.pdfType).toBe('TextBased');
      expect(result.markdown).toMatch(/Dummy PDF file/i);
    } finally {
      chdir(previousCwd);
    }
  });
});

describe('pdf-inspector platform support probe', () => {
  it('reports a boolean without throwing', () => {
    expect(typeof isPdfInspectorNativeSupported()).toBe('boolean');
  });
});
