/**
 * Cheap deterministic Drive text comparison. Formatting-only and tiny edits
 * must never reach an LLM.
 */

const WHITESPACE = /\s+/g;
const MARKDOWN_MARKERS = /[_*`#>\[\]]/g;
const MARKDOWN_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_LINE_PREFIX = /^\s{0,3}(?:#{1,6}\s+|>\s+|[-*+]\s+)/;

const DRIVE_DIFF_MIN_CHANGED_CHARS = 40;
const DRIVE_SNAPSHOT_MAX_CHARS = 20_000;
const DRIVE_HUNK_LINE_MAX = 400;
const DRIVE_HUNK_HEAD_CHARS = 240;

type DriveDiffReason = 'identical' | 'formatting' | 'tiny' | 'substantive';

export interface DriveTextDiff {
  changed: boolean;
  reason: DriveDiffReason;
  changedChars: number;
  hunks: string[];
}

export function normalizeDriveTextForCompare(text: string): string {
  const withoutLinks = text.replace(MARKDOWN_LINK, '$1');
  const withoutLineMarkup = withoutLinks
    .split('\n')
    .map((line) => line.replace(MARKDOWN_LINE_PREFIX, ''))
    .join(' ');
  return withoutLineMarkup
    .replace(MARKDOWN_MARKERS, '')
    .replace(WHITESPACE, ' ')
    .trim()
    .toLowerCase();
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
  const nextSet = new Set(nextLines.map((line) => line.trim()).filter((line) => line.length > 0));
  const hunks: string[] = [];
  for (const line of nextLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!prevSet.has(trimmed)) hunks.push(truncateChangedLine(trimmed));
  }
  if (hunks.length === 0) {
    for (const line of prevLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!nextSet.has(trimmed)) hunks.push(`- ${truncateChangedLine(trimmed)}`);
    }
  }
  if (hunks.length === 0 && next !== previous) {
    const start = firstDifferingIndex(previous, next);
    const added = next.slice(start);
    const removed = previous.slice(start);
    if (added.trim()) hunks.push(truncateChangedLine(added));
    if (removed.trim()) hunks.push(`- ${truncateChangedLine(removed)}`);
  }
  return hunks.slice(0, 40);
}

function truncateChangedLine(line: string, maxChars = DRIVE_HUNK_LINE_MAX): string {
  if (line.length <= maxChars) return line;
  const head = Math.min(DRIVE_HUNK_HEAD_CHARS, maxChars - 2);
  const tail = maxChars - head - 1;
  return `${line.slice(0, head)}…${line.slice(-tail)}`;
}

function firstDifferingIndex(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  for (let i = 0; i < limit; i++) {
    if (left[i] !== right[i]) return i;
  }
  return limit;
}
