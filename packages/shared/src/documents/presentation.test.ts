import { describe, expect, it } from 'vitest';

import {
  documentPresentation,
  isLikelyGeneratedDocumentName,
  normalizeSuggestedTitle,
  truncateFilenameMiddle,
} from '#src/documents/presentation.js';

describe('document presentation', () => {
  it('keeps human document names as the display title', () => {
    expect(
      documentPresentation({
        name: 'Acme contract.pdf',
        contentType: 'application/pdf',
        metadata: { suggested_title: 'Contract summary' },
      }),
    ).toMatchObject({
      displayTitle: 'Acme contract.pdf',
      storedName: 'Acme contract.pdf',
      suggestedTitle: 'Contract summary',
      isGeneratedName: false,
    });
  });

  it('uses suggested_title when the stored name is generated', () => {
    const presentation = documentPresentation({
      name: 'AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.png',
      contentType: 'image/png',
      metadata: { suggested_title: 'Spreadsheet screenshot with CRM export' },
      fileKind: 'captured',
    });
    expect(presentation).toMatchObject({
      displayTitle: 'Spreadsheet screenshot with CRM export',
      isGeneratedName: true,
    });
    expect(presentation.storedName).toContain('AgACAg');
  });

  it('falls back to generic attachment titles when no suggestion exists', () => {
    expect(
      documentPresentation({
        name: 'AgACAgQAAyEFAATcv6dYAAP8aimEaIUKrUMUitNrnbYk0qrfrl4AAroOaxuM6UIR43.png',
        contentType: 'image/png',
        metadata: {},
        fileKind: 'captured',
      }).displayTitle,
    ).toBe('Image attachment');
    expect(
      documentPresentation({
        name: '4f6dfcba7a6ef8085bdf0d3f604a8df3.pdf',
        contentType: 'application/pdf',
      }).displayTitle,
    ).toBe('PDF attachment');
  });

  it('normalizes suggested titles for metadata storage', () => {
    expect(normalizeSuggestedTitle('  Q3   board     pack  ')).toBe('Q3 board pack');
    expect(normalizeSuggestedTitle('[no title]')).toBeNull();
    expect(isLikelyGeneratedDocumentName('Screenshot 2026-06-11 at 10.32.24 PM.png')).toBe(false);
  });

  it('middle-truncates long stored filenames while preserving the extension', () => {
    expect(
      truncateFilenameMiddle(
        'AgACAgQAAyEFAATcv6dYAAIBuWo4jeyMZiYwKT1k92NCNuPTCoTcAALpDWsbBCfJUUAcqaMvf4JYAQADAgADdwADPAQ.jpg',
      ),
    ).toBe('AgACAgQ…wADPAQ.jpg');
    expect(truncateFilenameMiddle('contract.pdf')).toBe('contract.pdf');
  });
});
