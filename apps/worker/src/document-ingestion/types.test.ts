import { describe, expect, it } from 'vitest';

import {
  DaytonaNotConfiguredError,
  isDaytonaNotConfiguredError,
  isPlausibleSandboxPdfText,
  maxVisionPages,
  resolveAnydocFormatHint,
  shouldAcceptSandboxPdfText,
} from '#src/document-ingestion/types.js';

describe('shouldAcceptSandboxPdfText', () => {
  it('accepts non-sparse plausible text', () => {
    expect(
      shouldAcceptSandboxPdfText({
        text: 'enough text from anydoc about the quarterly report summary',
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

describe('resolveAnydocFormatHint', () => {
  it('resolves MIME and extension for office + PDF', () => {
    expect(
      resolveAnydocFormatHint(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'deck.bin',
      ),
    ).toBe('pptx');
    expect(resolveAnydocFormatHint('application/octet-stream', 'sheet.xlsx')).toBe('xlsx');
    expect(resolveAnydocFormatHint('application/pdf', 'scan.pdf')).toBe('pdf');
    expect(resolveAnydocFormatHint('text/csv', 'data.csv')).toBeUndefined();
  });
});
