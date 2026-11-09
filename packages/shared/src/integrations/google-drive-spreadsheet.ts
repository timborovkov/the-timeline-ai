/**
 * Native Google Sheets stay on the free text path. Drive `files.export`
 * `text/csv` is first-sheet-only, so a later-tab edit would hash-equal the
 * previous snapshot. Capture lists every tab (including hidden) and formats a
 * stable workbook text before `contentHash`.
 */

export interface DriveSpreadsheetTab {
  title: string;
  rows: readonly (readonly unknown[])[];
}

/** A1 sheet names with spaces, punctuation, or apostrophes must be quoted. */
export function quoteSheetsA1SheetName(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}

export function sheetValuesToCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map((cell) => csvEscapeCell(cellValue(cell))).join(',')).join('\n');
}

export function formatDriveSpreadsheetWorkbook(sheets: readonly DriveSpreadsheetTab[]): string {
  return sheets
    .map((sheet) => {
      const csv = sheetValuesToCsv(sheet.rows);
      return csv.length > 0 ? `# Sheet: ${sheet.title}\n${csv}` : `# Sheet: ${sheet.title}`;
    })
    .join('\n\n');
}

function cellValue(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'number' || typeof cell === 'boolean' || typeof cell === 'bigint') {
    return String(cell);
  }
  return JSON.stringify(cell);
}

function csvEscapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}
