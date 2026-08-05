import { describe, expect, it } from 'vitest';

import {
  DaytonaNotConfiguredError,
  isDaytonaNotConfiguredError,
  isPlausibleSandboxPdfText,
  maxVisionPages,
  shouldAcceptSandboxPdfText,
} from '#src/document-ingestion/types.js';

describe('shouldAcceptSandboxPdfText', () => {
  it('accepts non-sparse plausible text', () => {
    expect(
      shouldAcceptSandboxPdfText({
        text: 'enough text from pdfplumber about the quarterly report',
        sparse: false,
      }),
    ).toBe(true);
  });

  it('rejects sparse or empty results so vision can run', () => {
    expect(shouldAcceptSandboxPdfText({ text: 'short', sparse: true })).toBe(false);
    expect(shouldAcceptSandboxPdfText({ text: '   ', sparse: false })).toBe(false);
    expect(shouldAcceptSandboxPdfText({ text: '', sparse: true })).toBe(false);
  });

  it('rejects dense but garbled OCR so vision can run', () => {
    const garbage = Array.from({ length: 40 }, () => '§§@@##$$%%^^&&').join(' ');
    expect(shouldAcceptSandboxPdfText({ text: garbage, sparse: false })).toBe(false);
    expect(isPlausibleSandboxPdfText(garbage)).toBe(false);
  });
});

describe('DaytonaNotConfiguredError', () => {
  it('is detectable across instanceof and name checks', () => {
    const err = new DaytonaNotConfiguredError('PDF');
    expect(isDaytonaNotConfiguredError(err)).toBe(true);
    expect(isDaytonaNotConfiguredError(new Error('other'))).toBe(false);
    expect(err.message).toMatch(/DAYTONA_API_KEY/);
  });
});

describe('maxVisionPages', () => {
  it('clamps to 1..100', () => {
    expect(maxVisionPages(20)).toBe(20);
    expect(maxVisionPages(0)).toBe(1);
    expect(maxVisionPages(500)).toBe(100);
  });
});
