import { describe, expect, it } from 'vitest';

import { maxVisionPages, shouldAcceptSandboxPdfText } from '#src/document-ingestion/types.js';

describe('shouldAcceptSandboxPdfText', () => {
  it('accepts non-sparse non-empty text', () => {
    expect(
      shouldAcceptSandboxPdfText({
        text: 'enough text from pdfplumber',
        sparse: false,
      }),
    ).toBe(true);
  });

  it('rejects sparse or empty results so vision can run', () => {
    expect(shouldAcceptSandboxPdfText({ text: 'short', sparse: true })).toBe(false);
    expect(shouldAcceptSandboxPdfText({ text: '   ', sparse: false })).toBe(false);
    expect(shouldAcceptSandboxPdfText({ text: '', sparse: true })).toBe(false);
  });
});

describe('maxVisionPages', () => {
  it('clamps to 1..100', () => {
    expect(maxVisionPages(20)).toBe(20);
    expect(maxVisionPages(0)).toBe(1);
    expect(maxVisionPages(500)).toBe(100);
  });
});
