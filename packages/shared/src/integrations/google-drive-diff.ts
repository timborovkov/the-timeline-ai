/**
 * Cheap deterministic Drive text comparison. Formatting-only and tiny edits
 * must never reach an LLM.
 */

const WHITESPACE = /\s+/g;
const MARKDOWN_NOISE = /[_*`#>\-\[\]()]/g;

const DRIVE_DIFF_MIN_CHANGED_CHARS = 40;
const DRIVE_SNAPSHOT_MAX_CHARS = 20_000;

type DriveDiffReason = 'identical' | 'formatting' | 'tiny' | 'substantive';

export interface DriveTextDiff {
  changed: boolean;
  reason: DriveDiffReason;
  changedChars: number;
  hunks: string[];
}

export function normalizeDriveTextForCompare(text: string): string {
  return text.replace(WHITESPACE, ' ').replace(MARKDOWN_NOISE, '').trim().toLowerCase();
}

export function truncateDriveSnapshot(text: string, maxChars = DRIVE_SNAPSHOT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

export function diffDriveText(previous: string, next: string): DriveTextDiff {
  if (previous === next) {
    return { changed: false, reason: 'identical', changedChars: 0, hunks: [] };
  }
  const prevNorm = normalizeDriveTextForCompare(previous);
  const nextNorm = normalizeDriveTextForCompare(next);
  if (prevNorm === nextNorm) {
    return { changed: false, reason: 'formatting', changedChars: 0, hunks: [] };
  }
  const hunks = changedHunks(previous, next);
  const changedChars = hunks.reduce((sum, hunk) => sum + hunk.length, 0);
  if (changedChars < DRIVE_DIFF_MIN_CHANGED_CHARS && Math.abs(next.length - previous.length) < 20) {
    return { changed: false, reason: 'tiny', changedChars, hunks };
  }
  return { changed: true, reason: 'substantive', changedChars, hunks };
}

function changedHunks(previous: string, next: string): string[] {
  const prevLines = previous.split('\n');
  const nextLines = next.split('\n');
  const prevSet = new Set(prevLines.map((line) => line.trim()).filter((line) => line.length > 0));
  const hunks: string[] = [];
  for (const line of nextLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!prevSet.has(trimmed)) hunks.push(trimmed.slice(0, 400));
  }
  if (hunks.length === 0 && next !== previous) {
    const start = firstDifferingIndex(previous, next);
    hunks.push(next.slice(start, start + 400));
  }
  return hunks.slice(0, 40);
}

function firstDifferingIndex(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  for (let i = 0; i < limit; i++) {
    if (left[i] !== right[i]) return i;
  }
  return limit;
}
