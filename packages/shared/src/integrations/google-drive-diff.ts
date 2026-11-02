/**
 * Cheap deterministic Drive text comparison. Formatting-only and tiny edits
 * must never reach an LLM.
 *
 * Comparable text is the truncated 20k snapshot window. A last incomplete line
 * at the cap may be a clip artifact, but it is always inspected: hash-moved
 * snapshots never report identical/formatting unless the full comparable window
 * is verifiably whitespace-equivalent. If the window cannot prove the hash
 * change is formatting or tiny, fall back to a conservative changed hunk.
 * Added and removed hunks are always collected together.
 */

const WHITESPACE = /\s+/g;
const MARKDOWN_MARKERS = /[_*`#>\[\]]/g;
const MARKDOWN_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_LINE_PREFIX = /^\s{0,3}(?:#{1,6}\s+|>\s+|[-*+]\s+)/;

const DRIVE_DIFF_MIN_CHANGED_CHARS = 40;
export const DRIVE_SNAPSHOT_MAX_CHARS = 20_000;
export const DRIVE_BEYOND_SNAPSHOT_HUNK = 'Text changed past the stored snapshot window.';
const DRIVE_CAP_TAIL_SLACK = 1024;
const DRIVE_HUNK_LINE_MAX = 400;
const DRIVE_HUNK_HEAD_CHARS = 240;
const DRIVE_HUNK_CONTEXT_CHARS = 80;

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

function beyondSnapshotDiff(): DriveTextDiff {
  return {
    changed: true,
    reason: 'substantive',
    changedChars: 1,
    hunks: [DRIVE_BEYOND_SNAPSHOT_HUNK],
  };
}

function withProvenHunks(diff: DriveTextDiff): DriveTextDiff {
  if (!diff.changed) return diff;
  if (diff.hunks.length > 0) return diff;
  return { ...diff, hunks: [DRIVE_BEYOND_SNAPSHOT_HUNK] };
}

function splitCapWindow(text: string): { stable: string; tail: string } {
  if (text.length < DRIVE_SNAPSHOT_MAX_CHARS) return { stable: text, tail: '' };
  const lastNl = text.lastIndexOf('\n');
  if (lastNl < 0) return { stable: text, tail: '' };
  if (lastNl < text.length - DRIVE_CAP_TAIL_SLACK) return { stable: text, tail: '' };
  return { stable: text.slice(0, lastNl), tail: text.slice(lastNl + 1) };
}

function tailsAreCapSlide(previousTail: string, nextTail: string): boolean {
  if (previousTail === nextTail) return true;
  if (normalizeDriveTextForCompare(previousTail) === normalizeDriveTextForCompare(nextTail)) {
    return true;
  }
  if (previousTail.length === 0 || nextTail.length === 0) return false;
  if (previousTail.startsWith(nextTail) || nextTail.startsWith(previousTail)) return true;
  const [shorter, longer] =
    previousTail.length <= nextTail.length ? [previousTail, nextTail] : [nextTail, previousTail];
  return longer.slice(1).startsWith(shorter) || shorter.startsWith(longer.slice(1));
}

function mergeWindowDiffs(stable: DriveTextDiff, tail: DriveTextDiff | null): DriveTextDiff {
  if (!tail || !tail.changed) return withProvenHunks(stable);
  if (!stable.changed) return withProvenHunks(tail);
  return withProvenHunks({
    changed: true,
    reason: 'substantive',
    changedChars: stable.changedChars + tail.changedChars,
    hunks: [...stable.hunks, ...tail.hunks].slice(0, 40),
  });
}

/**
 * Compare stored snapshot text to the current truncated snapshot.
 *
 * Always inspect the full truncated window, including the last incomplete line
 * at the cap. That tail is ignored only when it is a clip/slide artifact.
 * Full-text hashes still see edits past 20k: byte-identical windows with a
 * moved hash are beyond-window. A hash change whose comparable window is
 * whitespace-equivalent stays formatting; a proven tiny window edit stays tiny.
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
    return hashMoved
      ? beyondSnapshotDiff()
      : { changed: false, reason: 'identical', changedChars: 0, hunks: [] };
  }

  const previousParts = splitCapWindow(previous);
  const nextParts = splitCapWindow(next);
  const stableDiff = diffDriveText(previousParts.stable, nextParts.stable);
  const tailSlide = tailsAreCapSlide(previousParts.tail, nextParts.tail);
  const tailDiff =
    previousParts.tail === nextParts.tail
      ? null
      : diffDriveText(previousParts.tail, nextParts.tail);
  const provenUnchanged = !stableDiff.changed && (tailSlide || !tailDiff || !tailDiff.changed);

  if (provenUnchanged) {
    if (stableDiff.reason === 'formatting' || stableDiff.reason === 'tiny') {
      return stableDiff;
    }
    if (hashMoved) return beyondSnapshotDiff();
    return stableDiff;
  }

  const windowDiff = mergeWindowDiffs(stableDiff, tailSlide ? null : tailDiff);
  if (windowDiff.changed) return windowDiff;
  if (hashMoved) return beyondSnapshotDiff();
  return windowDiff;
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
  return withProvenHunks({ changed: true, reason: 'substantive', changedChars, hunks });
}

function changedHunks(previous: string, next: string): string[] {
  const prevLines = previous.split('\n');
  const nextLines = next.split('\n');
  const prevSet = new Set(prevLines.map((line) => line.trim()).filter((line) => line.length > 0));
  const nextSet = new Set(nextLines.map((line) => line.trim()).filter((line) => line.length > 0));
  const addedLines = nextLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !prevSet.has(line));
  const removedLines = prevLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !nextSet.has(line));
  const hunks: string[] = [];
  const pairedRemoved = new Set<number>();
  for (const added of addedLines) {
    if (added.length <= DRIVE_HUNK_LINE_MAX) {
      hunks.push(truncateChangedLine(added));
      continue;
    }
    const pairIndex = removedLines.findIndex(
      (line, index) => !pairedRemoved.has(index) && line.length > DRIVE_HUNK_LINE_MAX,
    );
    if (pairIndex >= 0) {
      pairedRemoved.add(pairIndex);
      hunks.push(...changedSpanHunks(removedLines[pairIndex] ?? '', added));
      continue;
    }
    hunks.push(truncateChangedLine(added));
  }
  for (const [index, removed] of removedLines.entries()) {
    if (pairedRemoved.has(index)) continue;
    hunks.push(`- ${truncateChangedLine(removed)}`);
  }
  if (hunks.length === 0 && next !== previous) {
    hunks.push(...changedSpanHunks(previous, next));
  }
  return hunks.slice(0, 40);
}

function changedSpanHunks(previous: string, next: string): string[] {
  const start = firstDifferingIndex(previous, next);
  let endPrev = previous.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && previous[endPrev - 1] === next[endNext - 1]) {
    endPrev -= 1;
    endNext -= 1;
  }
  const contextStart = Math.max(0, start - DRIVE_HUNK_CONTEXT_CHARS);
  const addedEnd = Math.min(next.length, Math.max(endNext, start) + DRIVE_HUNK_CONTEXT_CHARS);
  const removedEnd = Math.min(previous.length, Math.max(endPrev, start) + DRIVE_HUNK_CONTEXT_CHARS);
  const added = next.slice(contextStart, addedEnd);
  const removed = previous.slice(contextStart, removedEnd);
  const hunks: string[] = [];
  if (added.trim()) hunks.push(truncateChangedLine(added.trim()));
  if (removed.trim()) hunks.push(`- ${truncateChangedLine(removed.trim())}`);
  return hunks;
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
