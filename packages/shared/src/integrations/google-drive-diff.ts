/**
 * Cheap deterministic Drive text comparison. Formatting-only and tiny edits
 * must never reach an LLM.
 *
 * Comparable text is the truncated 20k snapshot window. A last incomplete line
 * at the cap may be a clip artifact, but it is always inspected. Prefix
 * equivalence never proves the suffix is unchanged: if the full-text hash
 * moved and the stored window cannot prove the change lies entirely inside
 * that window, return changed (conservative). Added and removed hunks are
 * always collected together. The tiny/substantive threshold uses intra-line
 * edited spans, not hunk context kept for the judge. Tiny is only for edits
 * that are provably non-semantic: whitespace, punctuation-only, case-only, or
 * a single-letter typo (edit distance 1) inside one word longer than 3 chars.
 * Whole-word insertion or removal, digits, currency, and negation are
 * substantive even when the span is short.
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

/** Stored snapshots shorter than the cap are the entire extracted document. */
export function driveSnapshotWindowCoversFullText(previous: string, next: string): boolean {
  return previous.length < DRIVE_SNAPSHOT_MAX_CHARS && next.length < DRIVE_SNAPSHOT_MAX_CHARS;
}

/**
 * Prefix/window equivalence never proves the suffix is unchanged.
 *
 * A substantive window change already locates an edit inside the stored text.
 * Formatting-only or tiny window equivalence may skip only when the window is
 * the whole document, or when the full-text hash did not move. Otherwise a
 * hash change whose location cannot be proven returns a conservative hunk.
 */
export function resolveDriveSnapshotDiff(input: {
  windowDiff: DriveTextDiff;
  hashMoved: boolean;
  windowCoversFullText: boolean;
}): DriveTextDiff {
  if (input.windowDiff.changed) return withProvenHunks(input.windowDiff);
  if (!input.hashMoved || input.windowCoversFullText) return input.windowDiff;
  return beyondSnapshotDiff();
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
  if (!tail?.changed) return withProvenHunks(stable);
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
 * Full-text hashes still see edits past 20k. `resolveDriveSnapshotDiff` is the
 * single invariant: a hash change the stored window cannot locate is changed.
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
  const windowCoversFullText = driveSnapshotWindowCoversFullText(previous, next);

  if (previous === next) {
    return resolveDriveSnapshotDiff({
      windowDiff: { changed: false, reason: 'identical', changedChars: 0, hunks: [] },
      hashMoved,
      windowCoversFullText,
    });
  }

  const previousParts = splitCapWindow(previous);
  const nextParts = splitCapWindow(next);
  const stableDiff = diffDriveText(previousParts.stable, nextParts.stable);
  const tailSlide = tailsAreCapSlide(previousParts.tail, nextParts.tail);
  const tailDiff =
    previousParts.tail === nextParts.tail
      ? null
      : diffDriveText(previousParts.tail, nextParts.tail);
  const provenUnchanged = !stableDiff.changed && (tailSlide || !tailDiff?.changed);
  const windowDiff = provenUnchanged
    ? stableDiff
    : mergeWindowDiffs(stableDiff, tailSlide ? null : tailDiff);
  return resolveDriveSnapshotDiff({ windowDiff, hashMoved, windowCoversFullText });
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
  const edit = measureEditedSpans(previous, next);
  if (
    edit.chars < DRIVE_DIFF_MIN_CHANGED_CHARS &&
    Math.abs(next.length - previous.length) < 20 &&
    edit.cosmetic
  ) {
    return { changed: false, reason: 'tiny', changedChars: edit.chars, hunks };
  }
  return withProvenHunks({
    changed: true,
    reason: 'substantive',
    changedChars: edit.chars,
    hunks,
  });
}

function nonemptyLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function changedLineLists(
  previous: string,
  next: string,
): { addedLines: string[]; removedLines: string[] } {
  const prevLines = nonemptyLines(previous);
  const nextLines = nonemptyLines(next);
  const prevSet = new Set(prevLines);
  const nextSet = new Set(nextLines);
  return {
    addedLines: nextLines.filter((line) => !prevSet.has(line)),
    removedLines: prevLines.filter((line) => !nextSet.has(line)),
  };
}

function differingSpan(
  left: string,
  right: string,
): { start: number; endLeft: number; endRight: number } {
  const start = firstDifferingIndex(left, right);
  let endLeft = left.length;
  let endRight = right.length;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
    endLeft -= 1;
    endRight -= 1;
  }
  return { start, endLeft, endRight };
}

function spanNeighborhood(
  left: string,
  right: string,
  span: ReturnType<typeof differingSpan>,
): string {
  const leftSpan = left.slice(span.start, span.endLeft);
  const rightSpan = right.slice(span.start, span.endRight);
  return (
    left.slice(Math.max(0, span.start - 1), Math.min(left.length, span.endLeft + 1)) +
    right.slice(Math.max(0, span.start - 1), Math.min(right.length, span.endRight + 1)) +
    leftSpan +
    rightSpan
  );
}

function spanTouchesDigit(
  left: string,
  right: string,
  span: ReturnType<typeof differingSpan>,
): boolean {
  return /\d/.test(spanNeighborhood(left, right, span));
}

function spanTouchesCurrency(
  left: string,
  right: string,
  span: ReturnType<typeof differingSpan>,
): boolean {
  return /[$€£¥₹]/.test(spanNeighborhood(left, right, span));
}

function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch && /[0-9A-Za-z']/.test(ch));
}

function isPunctuationOrSpace(text: string): boolean {
  return /^[\s\p{P}\p{S}]*$/u.test(text);
}

const NEGATION_WORDS = new Set([
  'not',
  'no',
  'never',
  'none',
  'nor',
  "n't",
  'cannot',
  "can't",
  "don't",
  "doesn't",
  "won't",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  'without',
]);

function wordsIn(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+(?:n't|'[a-z]+)?/g) ?? [];
}

function spanHasWordChar(text: string, start: number, end: number): boolean {
  for (let index = start; index < end; index++) {
    if (isWordChar(text[index])) return true;
  }
  return false;
}

function containingWord(text: string, start: number, end: number): string | null {
  const insertionInsideWord =
    start === end && isWordChar(text[start - 1]) && isWordChar(text[start]);
  if (!spanHasWordChar(text, start, end) && !insertionInsideWord) return null;
  let wordStart = start;
  let wordEnd = end;
  while (wordStart > 0 && isWordChar(text[wordStart - 1])) wordStart -= 1;
  while (wordEnd < text.length && isWordChar(text[wordEnd])) wordEnd += 1;
  const word = text.slice(wordStart, wordEnd);
  return word.length > 0 ? word : null;
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  if (left.length > 64 || right.length > 64) return 64;
  const prev = Array.from({ length: right.length + 1 }, (_, index) => index);
  const next = prev.slice();
  for (let i = 0; i < left.length; i++) {
    next[0] = i + 1;
    for (let j = 0; j < right.length; j++) {
      const cost = left[i] === right[j] ? 0 : 1;
      next[j + 1] = Math.min((prev[j + 1] ?? 0) + 1, (next[j] ?? 0) + 1, (prev[j] ?? 0) + cost);
    }
    for (let j = 0; j <= right.length; j++) prev[j] = next[j] ?? 0;
  }
  return next[right.length] ?? 64;
}

function spanIsCosmetic(
  left: string,
  right: string,
  span: ReturnType<typeof differingSpan>,
): boolean {
  if (spanTouchesDigit(left, right, span)) return false;
  if (spanTouchesCurrency(left, right, span)) return false;
  const from = left.slice(span.start, span.endLeft);
  const to = right.slice(span.start, span.endRight);
  if (from === to) return true;
  if (from.replace(/\s+/g, '') === '' && to.replace(/\s+/g, '') === '') return true;
  if (isPunctuationOrSpace(from) && isPunctuationOrSpace(to)) return true;
  if (from.toLowerCase() === to.toLowerCase()) return true;

  const fromWords = wordsIn(from);
  const toWords = wordsIn(to);
  if (
    fromWords.some((word) => NEGATION_WORDS.has(word)) ||
    toWords.some((word) => NEGATION_WORDS.has(word))
  ) {
    return false;
  }

  const leftWord = containingWord(left, span.start, span.endLeft);
  const rightWord = containingWord(right, span.start, span.endRight);
  if (!leftWord || !rightWord) return false;
  if (wordsIn(leftWord).length !== 1 || wordsIn(rightWord).length !== 1) return false;
  if (leftWord.length <= 3 || rightWord.length <= 3) return false;
  if (/\d/.test(leftWord) || /\d/.test(rightWord)) return false;
  return levenshtein(leftWord.toLowerCase(), rightWord.toLowerCase()) === 1;
}

function measureEditedSpans(previous: string, next: string): { chars: number; cosmetic: boolean } {
  const { addedLines, removedLines } = changedLineLists(previous, next);
  if (addedLines.length === 0 && removedLines.length === 0) {
    const span = differingSpan(previous, next);
    return {
      chars: span.endLeft - span.start + (span.endRight - span.start),
      cosmetic: spanIsCosmetic(previous, next, span),
    };
  }
  const usedRemoved = new Set<number>();
  let chars = 0;
  let cosmetic = true;
  for (const added of addedLines) {
    let bestIndex = -1;
    let bestChars = added.length;
    for (const [index, removed] of removedLines.entries()) {
      if (usedRemoved.has(index)) continue;
      const span = differingSpan(removed, added);
      const size = span.endLeft - span.start + (span.endRight - span.start);
      if (size < bestChars) {
        bestChars = size;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) {
      usedRemoved.add(bestIndex);
      const removed = removedLines[bestIndex] ?? '';
      const span = differingSpan(removed, added);
      chars += bestChars;
      if (!spanIsCosmetic(removed, added, span)) cosmetic = false;
      continue;
    }
    chars += added.length;
    if (!spanIsCosmetic('', added, { start: 0, endLeft: 0, endRight: added.length })) {
      cosmetic = false;
    }
  }
  for (const [index, removed] of removedLines.entries()) {
    if (usedRemoved.has(index)) continue;
    chars += removed.length;
    if (!spanIsCosmetic(removed, '', { start: 0, endLeft: removed.length, endRight: 0 })) {
      cosmetic = false;
    }
  }
  return { chars, cosmetic };
}

function changedHunks(previous: string, next: string): string[] {
  const { addedLines, removedLines } = changedLineLists(previous, next);
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
  const { start, endLeft: endPrev, endRight: endNext } = differingSpan(previous, next);
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
