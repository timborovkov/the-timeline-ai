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
 * Compare stored snapshot text to the current truncated snapshot.
 *
 * Below the cap, compare the full normalized snapshots — including unmatched
 * suffixes — so an appended or deleted tail is not sliced away. At the cap,
 * compare only the stored window; extra suffix inside that window is an
 * explicit append/delete, and full-text hashes still see edits past 20k.
 */
export function diffDriveSnapshots(input: {
  previousSnapshotText: string;
  nextSnapshotText: string;
  previousContentHash?: string | null;
  nextContentHash: string;
}): DriveTextDiff {
  const previous = truncateDriveSnapshot(input.previousSnapshotText);
  const next = truncateDriveSnapshot(input.nextSnapshotText);
  const hashMoved =
    Boolean(input.previousContentHash) && input.previousContentHash !== input.nextContentHash;

  if (previous === next) {
    if (hashMoved) {
      return {
        changed: true,
        reason: 'substantive',
        changedChars: 1,
        hunks: [DRIVE_BEYOND_SNAPSHOT_HUNK],
      };
    }
    return { changed: false, reason: 'identical', changedChars: 0, hunks: [] };
  }

  const atCap =
    previous.length >= DRIVE_SNAPSHOT_MAX_CHARS || next.length >= DRIVE_SNAPSHOT_MAX_CHARS;
  if (!atCap) {
    return diffDriveText(previous, next);
  }

  const overlapLen = Math.min(previous.length, next.length);
  const extraPrev = previous.slice(overlapLen);
  const extraNext = next.slice(overlapLen);
  if (extraPrev.length > 0 || extraNext.length > 0) {
    return diffWithUnmatchedSuffixes(
      previous.slice(0, overlapLen),
      next.slice(0, overlapLen),
      extraPrev,
      extraNext,
    );
  }
  return diffCappedEqualWindow(previous, next);
}

function diffWithUnmatchedSuffixes(
  overlapPrev: string,
  overlapNext: string,
  extraPrev: string,
  extraNext: string,
): DriveTextDiff {
  const overlapDiff =
    overlapPrev.length >= DRIVE_SNAPSHOT_MAX_CHARS && overlapNext.length >= DRIVE_SNAPSHOT_MAX_CHARS
      ? diffCappedEqualWindow(overlapPrev, overlapNext)
      : diffDriveText(overlapPrev, overlapNext);
  const suffixHunks = unmatchedSuffixHunks(extraPrev, extraNext);
  const extraChars = extraPrev.trim().length + extraNext.trim().length;
  if (suffixHunks.length === 0) {
    if (!overlapDiff.changed) {
      return { changed: false, reason: 'formatting', changedChars: 0, hunks: [] };
    }
    return overlapDiff;
  }
  const tinySuffix =
    extraChars < DRIVE_DIFF_MIN_CHANGED_CHARS && Math.abs(extraNext.length - extraPrev.length) < 20;
  if (tinySuffix && !overlapDiff.changed) {
    return { changed: false, reason: 'tiny', changedChars: extraChars, hunks: [] };
  }
  if (!overlapDiff.changed) {
    return {
      changed: true,
      reason: 'substantive',
      changedChars: extraChars,
      hunks: suffixHunks,
    };
  }
  return {
    changed: true,
    reason: 'substantive',
    changedChars: overlapDiff.changedChars + extraChars,
    hunks: [...overlapDiff.hunks, ...suffixHunks].slice(0, 40),
  };
}

function diffCappedEqualWindow(previous: string, next: string): DriveTextDiff {
  return diffDriveText(storedWindowForCompare(previous), storedWindowForCompare(next));
}

/** Drop the clipped last line at the cap so a 1-char slide is not a hunk. */
function storedWindowForCompare(text: string): string {
  if (text.length < DRIVE_SNAPSHOT_MAX_CHARS) return text;
  const lastNl = text.lastIndexOf('\n');
  const nearEnd = text.length - Math.min(DRIVE_SNAPSHOT_BOUNDARY_SLACK, text.length);
  if (lastNl >= nearEnd) return text.slice(0, lastNl);
  return text.slice(0, Math.max(0, text.length - DRIVE_SNAPSHOT_BOUNDARY_SLACK));
}

function unmatchedSuffixHunks(extraPrev: string, extraNext: string): string[] {
  const hunks: string[] = [];
  const added = extraNext.trim();
  const removed = extraPrev.trim();
  if (added) hunks.push(truncateChangedLine(added));
  if (removed) hunks.push(`- ${truncateChangedLine(removed)}`);
  return hunks;
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
