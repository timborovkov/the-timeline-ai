/**
 * Cheap deterministic Drive text comparison. Formatting-only and tiny edits
 * must never reach an LLM.
 *
 * Stored evidence is a 20k prefix, a 20k suffix, and a full-document locate
 * index. The latest retained state stores every chunk's hash and extracted text,
 * including straddlers of the prefix and suffix bounds; older retained states
 * keep hashes only. Capture always has the current full text. Distinct changed
 * spans stay separate: a bounding first-to-last char-diff must not merge distant
 * edits into one truncated hunk. Hunks are centered on each span and truncated
 * around it. Every distinct span must appear in those hunks; if count or budget
 * would drop any span, the diff has no evidence and the baseline does not
 * advance. Prefix equivalence never proves the suffix is unchanged. A hash
 * change whose location is proven cosmetic (tiny/formatting) may skip. When the
 * full-text hash moved the result is never `identical`. Added and removed hunks
 * are always collected together.
 * The tiny/substantive threshold uses intra-line edited spans, not hunk context
 * kept for the judge. Tiny is only for edits that are provably non-semantic:
 * whitespace, punctuation-only, case-only, or a single-letter typo (edit
 * distance 1) inside one word longer than 3 chars. Whole-word insertion or
 * removal, digits, currency, and negation are substantive even when the span
 * is short.
 */

import { createHash } from 'node:crypto';

const WHITESPACE = /\s+/g;
const MARKDOWN_MARKERS = /[_*`#>\[\]]/g;
const MARKDOWN_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_LINE_PREFIX = /^\s{0,3}(?:#{1,6}\s+|>\s+|[-*+]\s+)/;

const DRIVE_DIFF_MIN_CHANGED_CHARS = 40;
export const DRIVE_SNAPSHOT_MAX_CHARS = 20_000;
export const DRIVE_SNAPSHOT_CHUNK_CHARS = 4_096;
const DRIVE_CAP_TAIL_SLACK = 1024;
const DRIVE_HUNK_LINE_MAX = 400;
const DRIVE_HUNK_HEAD_CHARS = 240;
const DRIVE_HUNK_CONTEXT_CHARS = 80;
const DRIVE_HUNK_MAX = 40;
/** Cap of distinct changed spans; exceeding it refuses persist rather than dropping a span. */
export const DRIVE_CHANGED_SPAN_MAX = 20;
const DRIVE_SPAN_RESYNC_CHARS = 32;
/** Bound each resync scan so a long doc with thousands of edits cannot rebuild a full remaining-text map. */
const DRIVE_SPAN_RESYNC_WINDOW = 8_192;
const DRIVE_HUNK_BUDGET_CHARS = DRIVE_HUNK_MAX * DRIVE_HUNK_LINE_MAX;

interface DriveChangedSpan {
  startLeft: number;
  endLeft: number;
  startRight: number;
  endRight: number;
}

export interface DriveSnapshotLocate {
  length: number;
  suffix: string;
  chunkSize: number;
  chunkHashes: string[];
  chunkTexts: string[];
}

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

function hashDriveChunk(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function buildDriveSnapshotLocate(
  text: string,
  chunkSize = DRIVE_SNAPSHOT_CHUNK_CHARS,
): DriveSnapshotLocate {
  const size = chunkSize > 0 ? chunkSize : DRIVE_SNAPSHOT_CHUNK_CHARS;
  const chunkHashes: string[] = [];
  const chunkTexts: string[] = [];
  for (let offset = 0; offset < text.length; offset += size) {
    const chunk = text.slice(offset, offset + size);
    chunkTexts.push(chunk);
    chunkHashes.push(hashDriveChunk(chunk));
  }
  return {
    length: text.length,
    suffix: text.length <= DRIVE_SNAPSHOT_MAX_CHARS ? text : text.slice(-DRIVE_SNAPSHOT_MAX_CHARS),
    chunkSize: size,
    chunkHashes,
    chunkTexts,
  };
}

/** Older retained snapshots keep hashes for uniqueness; only the latest stores chunk text. */
export function hashesOnlyDriveSnapshotLocate(locate: DriveSnapshotLocate): DriveSnapshotLocate {
  return {
    length: locate.length,
    suffix: locate.suffix,
    chunkSize: locate.chunkSize,
    chunkHashes: locate.chunkHashes,
    chunkTexts: [],
  };
}

export function parseDriveSnapshotLocate(value: unknown): DriveSnapshotLocate | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.length !== 'number' || !Number.isFinite(record.length) || record.length < 0) {
    return null;
  }
  if (typeof record.suffix !== 'string') return null;
  if (
    typeof record.chunkSize !== 'number' ||
    !Number.isFinite(record.chunkSize) ||
    record.chunkSize <= 0
  ) {
    return null;
  }
  if (!Array.isArray(record.chunkHashes)) return null;
  const chunkHashes = record.chunkHashes.filter(
    (hash): hash is string => typeof hash === 'string' && hash.length > 0,
  );
  if (chunkHashes.length !== record.chunkHashes.length) return null;
  let chunkTexts: string[] = [];
  if (Array.isArray(record.chunkTexts)) {
    if (
      record.chunkTexts.length === chunkHashes.length &&
      record.chunkTexts.every((chunk): chunk is string => typeof chunk === 'string')
    ) {
      const joinedLength = record.chunkTexts.reduce((sum, chunk) => sum + chunk.length, 0);
      if (joinedLength === Math.floor(record.length)) chunkTexts = record.chunkTexts;
    }
  }
  return {
    length: Math.floor(record.length),
    suffix: record.suffix,
    chunkSize: Math.floor(record.chunkSize),
    chunkHashes,
    chunkTexts,
  };
}

/** Stored snapshots shorter than the cap are the entire extracted document. */
export function driveSnapshotWindowCoversFullText(previous: string, next: string): boolean {
  return previous.length < DRIVE_SNAPSHOT_MAX_CHARS && next.length < DRIVE_SNAPSHOT_MAX_CHARS;
}

/**
 * Prefix/window equivalence never proves the suffix is unchanged.
 *
 * A substantive prefix change already locates an edit inside the stored prefix.
 * Formatting-only or tiny prefix equivalence may skip only when the stored
 * windows cover the whole document, the full-text hash did not move, or the
 * suffix/chunk index classified the remaining edit as skippable. A hash change
 * that still needs evidence uses `locatedDiff` hunks taken from current text.
 * Empty located hunks mean "do not advance the baseline".
 */
export function resolveDriveSnapshotDiff(input: {
  windowDiff: DriveTextDiff;
  hashMoved: boolean;
  windowCoversFullText: boolean;
  locatedDiff?: DriveTextDiff | null;
}): DriveTextDiff {
  if (input.windowDiff.changed) return input.windowDiff;
  if (!input.hashMoved || input.windowCoversFullText) return input.windowDiff;
  const located = input.locatedDiff;
  if (!located) {
    return { changed: true, reason: 'substantive', changedChars: 1, hunks: [] };
  }
  if (!located.changed && located.reason === 'identical') {
    return { changed: true, reason: 'substantive', changedChars: 1, hunks: [] };
  }
  if (located.changed && located.hunks.length === 0) {
    return { ...located, hunks: [] };
  }
  return located;
}

/** Skip classification is evidence; a changed diff needs at least one real hunk. */
export function driveDiffHasEvidence(diff: DriveTextDiff): boolean {
  return !diff.changed || diff.hunks.some((hunk) => hunk.trim().length > 0);
}

function changeProbe(text: string): string {
  const needle = text.trim() || text;
  if (needle.length === 0) return '';
  return needle.slice(0, Math.min(48, needle.length));
}

function haystackContainsProbe(haystack: string, probe: string): boolean {
  if (probe.length === 0) return true;
  if (haystack.includes(probe)) return true;
  const head = probe.slice(0, Math.min(24, probe.length));
  return head.length > 0 && haystack.includes(head);
}

function mergeHunkLists(left: string[], right: string[]): string[] {
  const hunks = [...left, ...right];
  return hunks.length > DRIVE_HUNK_MAX ? [] : hunks;
}

/**
 * Every distinct changed span of `previous` vs `next` must appear in the emitted
 * hunks. Truncation may keep a head of a long span; it may not drop a span, and
 * a first-to-last bounding span must not stand in for distant middle edits.
 * Callers that cannot satisfy this must return empty hunks.
 */
export function driveHunksContainChangedSpan(
  hunks: string[],
  previous: string,
  next: string,
): boolean {
  if (previous === next) return true;
  if (!hunks.some((hunk) => hunk.trim().length > 0)) return false;
  const spans = collectDistinctChangedSpans(previous, next);
  if (spans.length === 0) return false;
  if (spans.length > DRIVE_CHANGED_SPAN_MAX) return false;
  const currentBlob = hunks.filter((hunk) => !hunk.startsWith('- ')).join('\n');
  const removedBlob = hunks.filter((hunk) => hunk.startsWith('- ')).join('\n');
  const blob = hunks.join('\n');
  for (const span of spans) {
    const added = next.slice(span.startRight, span.endRight);
    const removed = previous.slice(span.startLeft, span.endLeft);
    if (added.length > 0) {
      const probe = changeProbe(added);
      if (!haystackContainsProbe(currentBlob.length > 0 ? currentBlob : blob, probe)) return false;
      continue;
    }
    if (removed.length > 0) {
      const probe = changeProbe(removed);
      if (!haystackContainsProbe(removedBlob.length > 0 ? removedBlob : blob, probe)) return false;
    }
  }
  return true;
}

function collectDistinctChangedSpans(left: string, right: string): DriveChangedSpan[] {
  if (left === right) return [];
  const spans: DriveChangedSpan[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (spans.length > DRIVE_CHANGED_SPAN_MAX) return spans;
    while (i < left.length && j < right.length && left[i] === right[j]) {
      i += 1;
      j += 1;
    }
    if (i >= left.length && j >= right.length) break;
    if (spans.length >= DRIVE_CHANGED_SPAN_MAX) {
      spans.push({
        startLeft: i,
        endLeft: left.length,
        startRight: j,
        endRight: right.length,
      });
      return spans;
    }
    if (i >= left.length) {
      spans.push({ startLeft: i, endLeft: i, startRight: j, endRight: right.length });
      break;
    }
    if (j >= right.length) {
      spans.push({ startLeft: i, endLeft: left.length, startRight: j, endRight: j });
      break;
    }
    const leftRemain = left.length - i;
    const rightRemain = right.length - j;
    if (leftRemain < DRIVE_SPAN_RESYNC_CHARS || rightRemain < DRIVE_SPAN_RESYNC_CHARS) {
      spans.push({ startLeft: i, endLeft: left.length, startRight: j, endRight: right.length });
      break;
    }
    const resync = findNearestResync(left, right, i, j, DRIVE_SPAN_RESYNC_CHARS);
    if (!resync || (resync.i === i && resync.j === j)) {
      spans.push({ startLeft: i, endLeft: left.length, startRight: j, endRight: right.length });
      break;
    }
    spans.push({ startLeft: i, endLeft: resync.i, startRight: j, endRight: resync.j });
    i = resync.i;
    j = resync.j;
  }
  return spans;
}

function findNearestResync(
  left: string,
  right: string,
  leftStart: number,
  rightStart: number,
  minMatch: number,
): { i: number; j: number } | null {
  if (left.length - leftStart < minMatch || right.length - rightStart < minMatch) return null;
  const leftLimit = Math.min(left.length - minMatch, leftStart + DRIVE_SPAN_RESYNC_WINDOW);
  const rightLimit = Math.min(right.length - minMatch, rightStart + DRIVE_SPAN_RESYNC_WINDOW);
  const leftPos = new Map<string, number>();
  for (let li = leftStart; li <= leftLimit; li++) {
    const gram = left.slice(li, li + minMatch);
    if (!leftPos.has(gram)) leftPos.set(gram, li);
  }
  let best: { i: number; j: number; cost: number } | null = null;
  for (let rj = rightStart; rj <= rightLimit; rj++) {
    const minPossible = rj - rightStart;
    if (best && minPossible >= best.cost) break;
    const gram = right.slice(rj, rj + minMatch);
    const li = leftPos.get(gram);
    if (li === undefined) continue;
    const cost = li - leftStart + (rj - rightStart);
    if (cost === 0) continue;
    if (!best || cost < best.cost) best = { i: li, j: rj, cost };
  }
  return best ? { i: best.i, j: best.j } : null;
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
  if (!tail?.changed) return stable;
  if (!stable.changed) return tail;
  return {
    changed: true,
    reason: 'substantive',
    changedChars: stable.changedChars + tail.changedChars,
    hunks: mergeHunkLists(stable.hunks, tail.hunks),
  };
}

function diffPrefixWindows(previous: string, next: string): DriveTextDiff {
  if (previous === next) {
    return { changed: false, reason: 'identical', changedChars: 0, hunks: [] };
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
  return provenUnchanged ? stableDiff : mergeWindowDiffs(stableDiff, tailSlide ? null : tailDiff);
}

function skipLocatedDiff(prefix: DriveTextDiff, suffix: DriveTextDiff | null): DriveTextDiff {
  if (suffix && !suffix.changed && suffix.reason === 'tiny') return suffix;
  if (!prefix.changed && prefix.reason === 'tiny') return prefix;
  if (suffix && !suffix.changed && suffix.reason === 'formatting') return suffix;
  if (!prefix.changed && prefix.reason === 'formatting') return prefix;
  return prefix;
}

function collapseRepeatedRuns(text: string): string {
  let result = '';
  let index = 0;
  while (index < text.length && result.length < DRIVE_HUNK_LINE_MAX) {
    let end = index + 1;
    while (end < text.length && text[end] === text[index]) end += 1;
    const run = end - index;
    if (run >= 32) {
      result += (text[index] ?? '').repeat(8);
    } else {
      result += text.slice(index, end);
    }
    index = end;
  }
  return result;
}

function truncateAroundChange(left: string, core: string, right: string): string {
  const max = DRIVE_HUNK_LINE_MAX;
  const keptCore =
    core.length <= max
      ? core
      : `${core.slice(0, DRIVE_HUNK_HEAD_CHARS)}…${core.slice(-(max - DRIVE_HUNK_HEAD_CHARS - 1))}`;
  const remaining = max - keptCore.length;
  if (remaining <= 0) return keptCore;
  let leftKeep = Math.min(left.length, Math.ceil(remaining / 2));
  const rightKeep = Math.min(right.length, remaining - leftKeep);
  if (leftKeep + rightKeep < remaining) {
    leftKeep = Math.min(left.length, remaining - rightKeep);
  }
  return `${left.slice(left.length - leftKeep)}${keptCore}${right.slice(0, rightKeep)}`.trim();
}

function excerptCenteredOnSpan(text: string, start: number, end: number): string {
  const lo = Math.max(0, Math.min(start, text.length));
  const hi = Math.min(text.length, Math.max(end, lo));
  const core = text.slice(lo, hi);
  const left = collapseRepeatedRuns(text.slice(Math.max(0, lo - DRIVE_HUNK_CONTEXT_CHARS), lo));
  const right = collapseRepeatedRuns(
    text.slice(hi, Math.min(text.length, hi + DRIVE_HUNK_CONTEXT_CHARS)),
  );
  return truncateAroundChange(left, core, right);
}

function hunksForChangedSpans(
  previous: string,
  next: string,
  nextFull: string,
  nextOffset: number,
): string[] {
  const spans = collectDistinctChangedSpans(previous, next);
  if (spans.length === 0) return [];
  if (spans.length > DRIVE_CHANGED_SPAN_MAX) return [];
  const hunks: string[] = [];
  for (const span of spans) {
    const addedHunk = excerptCenteredOnSpan(
      nextFull,
      nextOffset + span.startRight,
      nextOffset + span.endRight,
    );
    const removedHunk = excerptCenteredOnSpan(previous, span.startLeft, span.endLeft);
    if (addedHunk.length > 0) hunks.push(addedHunk);
    if (removedHunk.length > 0) hunks.push(`- ${removedHunk}`);
  }
  if (hunks.length > DRIVE_HUNK_MAX) return [];
  const budget = hunks.reduce((sum, hunk) => sum + hunk.length, 0);
  if (budget > DRIVE_HUNK_BUDGET_CHARS) return [];
  if (!driveHunksContainChangedSpan(hunks, previous, next)) return [];
  return hunks;
}

function hunksCenteredOnChunkSpan(
  previousChunk: string,
  nextChunk: string,
  nextFull: string,
  chunkStart: number,
): string[] {
  return hunksForChangedSpans(previousChunk, nextChunk, nextFull, chunkStart);
}

/** Last-N suffix windows slide at the start when document length changes. */
function alignCappedSuffix(
  previousSuffix: string,
  nextSuffix: string,
  previousLength: number,
  nextLength: number,
): { previous: string; next: string } {
  const delta = nextLength - previousLength;
  if (delta === 0) return { previous: previousSuffix, next: nextSuffix };
  if (
    previousSuffix.length < DRIVE_SNAPSHOT_MAX_CHARS &&
    nextSuffix.length < DRIVE_SNAPSHOT_MAX_CHARS
  ) {
    return { previous: previousSuffix, next: nextSuffix };
  }
  if (delta > 0 && previousSuffix.length >= DRIVE_SNAPSHOT_MAX_CHARS) {
    return {
      previous: previousSuffix.slice(Math.min(delta, previousSuffix.length)),
      next: nextSuffix,
    };
  }
  if (delta < 0 && nextSuffix.length >= DRIVE_SNAPSHOT_MAX_CHARS) {
    return {
      previous: previousSuffix,
      next: nextSuffix.slice(Math.min(-delta, nextSuffix.length)),
    };
  }
  return { previous: previousSuffix, next: nextSuffix };
}

function chunkTouchesUnstored(input: {
  start: number;
  end: number;
  prefixEnd: number;
  previousSuffixStart: number;
  nextSuffixStart: number;
}): boolean {
  if (input.end <= input.prefixEnd) return false;
  if (input.start >= input.previousSuffixStart && input.start >= input.nextSuffixStart) {
    return false;
  }
  return true;
}

function locateIndexHasChunkTexts(locate: DriveSnapshotLocate): boolean {
  return (
    locate.chunkTexts.length === locate.chunkHashes.length &&
    locate.chunkTexts.join('').length === locate.length
  );
}

function centeredHunksFromFullText(
  previous: DriveSnapshotLocate,
  nextFull: string,
): string[] | null {
  if (!locateIndexHasChunkTexts(previous)) return null;
  const previousFull = previous.chunkTexts.join('');
  return hunksForChangedSpans(previousFull, nextFull, nextFull, 0);
}

function unwitnessedHashMove(previousLength: number, nextLength: number): DriveTextDiff {
  return {
    changed: true,
    reason: 'substantive',
    changedChars: Math.max(1, Math.abs(previousLength - nextLength)),
    hunks: [],
  };
}

/**
 * Walk the full-document chunk index. Prefix and suffix text already classified
 * their windows; inspect every remaining mismatched chunk, including straddlers.
 * Hunks are char-diff spans of stored previous chunk text vs current chunk text.
 */
function locateByChunkHashes(
  previous: DriveSnapshotLocate,
  next: DriveSnapshotLocate,
  nextFull: string,
): DriveTextDiff | null {
  const prefixEnd = Math.min(DRIVE_SNAPSHOT_MAX_CHARS, previous.length, nextFull.length);
  const previousSuffixStart = Math.max(0, previous.length - DRIVE_SNAPSHOT_MAX_CHARS);
  const nextSuffixStart = Math.max(0, nextFull.length - DRIVE_SNAPSHOT_MAX_CHARS);
  if (prefixEnd >= previousSuffixStart && prefixEnd >= nextSuffixStart) return null;
  const chunkSize = previous.chunkSize > 0 ? previous.chunkSize : DRIVE_SNAPSHOT_CHUNK_CHARS;
  const nextLocate =
    next.chunkSize === chunkSize ? next : buildDriveSnapshotLocate(nextFull, chunkSize);
  const limit = Math.max(previous.chunkHashes.length, nextLocate.chunkHashes.length);
  const hasPreviousTexts = locateIndexHasChunkTexts(previous);
  const hunks: string[] = [];
  let mismatchedUnstored = false;
  for (let index = 0; index < limit; index++) {
    if ((previous.chunkHashes[index] ?? '') === (nextLocate.chunkHashes[index] ?? '')) continue;
    const start = index * chunkSize;
    const end = start + chunkSize;
    if (
      !chunkTouchesUnstored({
        start,
        end,
        prefixEnd,
        previousSuffixStart,
        nextSuffixStart,
      })
    ) {
      continue;
    }
    mismatchedUnstored = true;
    if (!hasPreviousTexts) {
      return unwitnessedHashMove(previous.length, nextFull.length);
    }
    const previousChunk = previous.chunkTexts[index] ?? '';
    const nextChunk = nextFull.slice(start, start + chunkSize);
    const chunkHunks = hunksCenteredOnChunkSpan(previousChunk, nextChunk, nextFull, start);
    if (chunkHunks.length === 0) {
      return unwitnessedHashMove(previous.length, nextFull.length);
    }
    hunks.push(...chunkHunks);
    if (hunks.length > DRIVE_HUNK_MAX) {
      return unwitnessedHashMove(previous.length, nextFull.length);
    }
  }
  if (hunks.length > 0) {
    if (hunks.length > DRIVE_HUNK_MAX) return unwitnessedHashMove(previous.length, nextFull.length);
    return {
      changed: true,
      reason: 'substantive',
      changedChars: Math.max(1, Math.abs(previous.length - nextFull.length) || chunkSize),
      hunks,
    };
  }
  if (mismatchedUnstored) return unwitnessedHashMove(previous.length, nextFull.length);
  return null;
}

function excerptCurrentTextFallback(
  nextFull: string,
  previousPrefix: string,
  previousLocate: DriveSnapshotLocate | null,
): DriveTextDiff {
  if (previousLocate) {
    const nextLocate = buildDriveSnapshotLocate(
      nextFull,
      previousLocate.chunkSize > 0 ? previousLocate.chunkSize : DRIVE_SNAPSHOT_CHUNK_CHARS,
    );
    const located = locateByChunkHashes(previousLocate, nextLocate, nextFull);
    if (located) return located;
  }
  return unwitnessedHashMove(previousPrefix.length, nextFull.length);
}

function locateBeyondPrefix(input: {
  prefixDiff: DriveTextDiff;
  previousPrefix: string;
  previousLocate: DriveSnapshotLocate | null;
  nextFull: string;
  nextLocate: DriveSnapshotLocate;
}): DriveTextDiff {
  const suffixCoversBeyondPrefix =
    (input.previousLocate?.length ?? input.previousPrefix.length) > DRIVE_SNAPSHOT_MAX_CHARS ||
    input.nextFull.length > DRIVE_SNAPSHOT_MAX_CHARS;
  const suffixDiff = (() => {
    if (!input.previousLocate || !suffixCoversBeyondPrefix) return null;
    const raw = diffDriveText(input.previousLocate.suffix, input.nextLocate.suffix);
    if (!raw.changed) return raw;
    const aligned = alignCappedSuffix(
      input.previousLocate.suffix,
      input.nextLocate.suffix,
      input.previousLocate.length,
      input.nextLocate.length,
    );
    if (
      aligned.previous === input.previousLocate.suffix &&
      aligned.next === input.nextLocate.suffix
    ) {
      return raw;
    }
    const shifted = diffDriveText(aligned.previous, aligned.next);
    if (!shifted.changed) return shifted;
    return shifted.changedChars <= raw.changedChars ? shifted : raw;
  })();
  if (suffixDiff?.changed) return suffixDiff;
  const skipped = skipLocatedDiff(input.prefixDiff, suffixDiff);
  const middle =
    input.previousLocate && suffixCoversBeyondPrefix
      ? locateByChunkHashes(input.previousLocate, input.nextLocate, input.nextFull)
      : null;
  if (middle?.changed) return middle;
  if (input.previousLocate) return skipped;
  return unwitnessedHashMove(input.previousPrefix.length, input.nextFull.length);
}

/**
 * Compare the previous stored windows to the current full extracted text.
 *
 * Always inspect the truncated prefix, including the last incomplete line at
 * the cap. That tail is ignored only when it is a clip/slide artifact. When
 * the prefix is skippable, locate the change in the stored suffix or chunk
 * index and excerpt bounded hunks from the current text. `resolveDriveSnapshotDiff`
 * is the single invariant: a hash change the stored windows cannot locate still
 * needs real current-text hunks, never a content-free marker.
 */
export function diffDriveSnapshots(input: {
  previousSnapshotText: string;
  nextFullText: string;
  nextSnapshotText?: string;
  previousLocate?: DriveSnapshotLocate | null;
  previousContentHash?: string | null;
  nextContentHash: string;
}): DriveTextDiff {
  const nextFull = input.nextFullText;
  const previous = truncateDriveSnapshot(input.previousSnapshotText);
  const next = truncateDriveSnapshot(input.nextSnapshotText ?? nextFull);
  const hashMoved =
    Boolean(input.previousContentHash) && input.previousContentHash !== input.nextContentHash;
  const previousLength = input.previousLocate?.length ?? previous.length;
  const windowCoversFullText =
    driveSnapshotWindowCoversFullText(previous, next) &&
    previousLength < DRIVE_SNAPSHOT_MAX_CHARS &&
    nextFull.length < DRIVE_SNAPSHOT_MAX_CHARS;
  const prefixDiff = diffPrefixWindows(previous, next);
  const nextLocate = buildDriveSnapshotLocate(nextFull);
  let locatedDiff = locateBeyondPrefix({
    prefixDiff,
    previousPrefix: previous,
    previousLocate: input.previousLocate ?? null,
    nextFull,
    nextLocate,
  });
  if (hashMoved && !windowCoversFullText && locatedDiff.reason === 'identical') {
    locatedDiff = excerptCurrentTextFallback(nextFull, previous, input.previousLocate ?? null);
  }
  const resolved = resolveDriveSnapshotDiff({
    windowDiff: prefixDiff,
    hashMoved,
    windowCoversFullText,
    locatedDiff,
  });
  if (resolved.changed && input.previousLocate) {
    const centered = centeredHunksFromFullText(input.previousLocate, nextFull);
    if (centered === null) return resolved;
    if (centered.length > 0) return { ...resolved, hunks: centered };
    return { ...resolved, hunks: [] };
  }
  return resolved;
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
  return {
    changed: true,
    reason: 'substantive',
    changedChars: edit.chars,
    hunks,
  };
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
  return hunks.length > DRIVE_HUNK_MAX ? [] : hunks;
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
