import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { hashDrivePayload } from '#src/integrations/google-drive-capture.js';
import {
  formatDriveSpreadsheetWorkbook,
  quoteSheetsA1SheetName,
  sheetValuesToCsv,
} from '#src/integrations/google-drive-spreadsheet.js';

describe('quoteSheetsA1SheetName', () => {
  it('quotes ordinary titles and doubles apostrophes', () => {
    expect(quoteSheetsA1SheetName('Summary')).toBe("'Summary'");
    expect(quoteSheetsA1SheetName('Q2 Plan')).toBe("'Q2 Plan'");
    expect(quoteSheetsA1SheetName("O'Brien")).toBe("'O''Brien'");
  });
});

describe('sheetValuesToCsv', () => {
  it('quotes commas, quotes, and newlines the way RFC 4180 CSV does', () => {
    expect(sheetValuesToCsv([['Widgets', '12k']])).toBe('Widgets,12k');
    expect(sheetValuesToCsv([['Acme, Inc.', 'He said "go"', 'line\nbreak']])).toBe(
      '"Acme, Inc.","He said ""go""","line\nbreak"',
    );
  });
});

describe('formatDriveSpreadsheetWorkbook', () => {
  it('hashes every tab so a later-sheet edit is not equal to first-sheet CSV', () => {
    const firstSheet = [
      ['item', 'amount'],
      ['Widgets', '12k'],
    ];
    const previousSecond = [['deal'], ['Northstar 12k']];
    const nextSecond = [['deal'], ['Northstar 48k']];
    const firstSheetCsv = sheetValuesToCsv(firstSheet);
    const previousWorkbook = formatDriveSpreadsheetWorkbook([
      { title: 'Summary', rows: firstSheet },
      { title: 'Pipeline', rows: previousSecond },
    ]);
    const nextWorkbook = formatDriveSpreadsheetWorkbook([
      { title: 'Summary', rows: firstSheet },
      { title: 'Pipeline', rows: nextSecond },
    ]);

    expect(firstSheetCsv).toBe('item,amount\nWidgets,12k');
    expect(hashDrivePayload(firstSheetCsv)).toBe(hashDrivePayload(sheetValuesToCsv(firstSheet)));
    expect(hashDrivePayload(previousWorkbook)).not.toBe(hashDrivePayload(nextWorkbook));
    expect(nextWorkbook).toContain('# Sheet: Pipeline');
    expect(nextWorkbook).toContain('Northstar 48k');
    expect(previousWorkbook).toContain('# Sheet: Summary');
  });

  it('keeps empty and hidden-named tabs in index order so a rename or extra tab moves the hash', () => {
    const withHidden = formatDriveSpreadsheetWorkbook([
      { title: 'Visible', rows: [['ok']] },
      { title: 'Hidden notes', rows: [] },
    ]);
    const renamed = formatDriveSpreadsheetWorkbook([
      { title: 'Visible', rows: [['ok']] },
      { title: 'Private notes', rows: [] },
    ]);
    expect(withHidden).toBe('# Sheet: Visible\nok\n\n# Sheet: Hidden notes');
    expect(hashDrivePayload(withHidden)).not.toBe(hashDrivePayload(renamed));
  });
});
