/**
 * Cheap deterministic Drive text comparison. Formatting-only and tiny edits
 * must never reach an LLM.
 */

const WHITESPACE = /\s+/g;
const MARKDOWN_MARKERS = /[_*`#>\[\]]/g;
const MARKDOWN_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_LINE_PREFIX = /^\s{0,3}(?:#{1,6}\s+|>\s+|[-*+]\s+)/;

const DRIVE_DIFF_MIN_CHANGED_CHARS = 40;
export const DRIVE_SNAPSHOT_MAX_CHARS = 20_000;
export const DRIVE_BEYOND_SNAPSHOT_HUNK = 'Text changed past the stored snapshot window.';
/** Ignore this many trailing normalized chars so a prefix insert doesn't slide the cap. */
const DRIVE_SNAPSHOT_BOUNDARY_SLACK = 1024;
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

/**
 * Compare stored snapshot text to the current truncated snapshot. Full-text
 * hashes still detect edits past the bound; this must not diff a prefix
 * against a longer current document or the unchanged tail looks added.
 */
export function diffDriveSnapshots(input: {
  previousSnapshotText: string;
  nextSnapshotText: string;
  previousContentHash?: string | null;
  nextContentHash: string;
}): DriveTextDiff {
  const previous = truncateDriveSnapshot(input.previousSnapshotText);
  const next = truncateDriveSnapshot(input.nextSnapshotText);
  const aligned = alignedNormalizedPrefixes(previous, next);
  const hashMoved =
    Boolean(input.previousContentHash) && input.previousContentHash !== input.nextContentHash;

  if (aligned.previous === aligned.next) {
    if (previous === next && hashMoved) {
      return {
        changed: true,
        reason: 'substantive',
        changedChars: 1,
        hunks: [DRIVE_BEYOND_SNAPSHOT_HUNK],
      };
    }
    if (previous === next) {
      return { changed: false, reason: 'identical', changedChars: 0, hunks: [] };
    }
    return { changed: false, reason: 'formatting', changedChars: 0, hunks: [] };
  }

  const changedChars = suffixAlignedChangedChars(aligned.previous, aligned.next);
  const normalizedLengthDelta = Math.abs(
    normalizeDriveTextForCompare(next).length - normalizeDriveTextForCompare(previous).length,
  );
  if (changedChars < DRIVE_DIFF_MIN_CHANGED_CHARS && normalizedLengthDelta < 20) {
    return { changed: false, reason: 'tiny', changedChars, hunks: [] };
  }

  const diff = diffDriveText(previous, next);
  if (diff.changed) return diff;
  if (hashMoved) {
    return {
      changed: true,
      reason: 'substantive',
      changedChars: 1,
      hunks: [DRIVE_BEYOND_SNAPSHOT_HUNK],
    };
  }
  return diff;
}

function alignedNormalizedPrefixes(
  previous: string,
  next: string,
): { previous: string; next: string } {
  const atCap =
    previous.length >= DRIVE_SNAPSHOT_MAX_CHARS || next.length >= DRIVE_SNAPSHOT_MAX_CHARS;
  const prevN = normalizeDriveTextForCompare(previous);
  const nextN = normalizeDriveTextForCompare(next);
  const slack = atCap ? DRIVE_SNAPSHOT_BOUNDARY_SLACK : 0;
  const bound = Math.max(0, Math.min(prevN.length, nextN.length) - slack);
  return { previous: prevN.slice(0, bound), next: nextN.slice(0, bound) };
}

function suffixAlignedChangedChars(previous: string, next: string): number {
  const start = firstDifferingIndex(previous, next);
  let endPrev = previous.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && previous[endPrev - 1] === next[endNext - 1]) {
    endPrev -= 1;
    endNext -= 1;
  }
  return endPrev - start + (endNext - start);
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
