import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  DRIVE_SNAPSHOT_CHUNK_CHARS,
  DRIVE_SNAPSHOT_MAX_CHARS,
  buildDriveSnapshotLocate,
  diffDriveSnapshots,
  diffDriveText,
  driveDiffHasEvidence,
  driveSnapshotWindowCoversFullText,
  normalizeDriveTextForCompare,
  parseDriveSnapshotLocate,
  resolveDriveSnapshotDiff,
  truncateDriveSnapshot,
  type DriveTextDiff,
} from '#src/integrations/google-drive-diff.js';

const SIGNING_PARAGRAPH = 'Acme Labs signed a $48k annual contract with Northstar this quarter.';
const SOW_LINE = 'Northstar SOW covers implementation, training, and support.\n';

describe('diffDriveText', () => {
  it('skips identical snapshots', () => {
    expect(diffDriveText('hello', 'hello')).toMatchObject({
      changed: false,
      reason: 'identical',
    });
  });

  it('skips markdown and whitespace-only formatting', () => {
    expect(diffDriveText('# Title\n\nHello world', 'Title\nHello   world')).toMatchObject({
      changed: false,
      reason: 'formatting',
    });
    expect(diffDriveText('- Hello world', 'Hello world')).toMatchObject({
      changed: false,
      reason: 'formatting',
    });
    expect(normalizeDriveTextForCompare('# Hello')).toBe('hello');
  });

  it('keeps signed amounts instead of treating hyphens as markdown', () => {
    expect(normalizeDriveTextForCompare('-50000 USD')).toBe('-50000 usd');
    const diff = diffDriveText(
      'Budget is -50000 USD for the Northstar pilot this quarter.',
      'Budget is 50000 USD for the Northstar pilot this quarter.',
    );
    expect(diff.changed).toBe(true);
    expect(diff.reason).toBe('substantive');
    expect(diff.hunks.join(' ')).toContain('50000 USD');
  });

  it('skips tiny punctuation edits', () => {
    expect(diffDriveText('Status is open', 'Status is open.')).toMatchObject({
      changed: false,
      reason: 'tiny',
    });
  });

  const LONG_SOW_SENTENCE =
    'Northstar SOW covers implementation, training, and ongoing support for the 2026 pilot';

  it('skips a punctuation edit on a long line as tiny without counting hunk context', () => {
    expect(LONG_SOW_SENTENCE.length).toBeGreaterThan(60);
    const diff = diffDriveText(LONG_SOW_SENTENCE, `${LONG_SOW_SENTENCE}.`);
    expect(diff.changed).toBe(false);
    expect(diff.reason).toBe('tiny');
    expect(diff.changedChars).toBeLessThan(40);
    expect(diff.hunks.join(' ').length).toBeGreaterThan(diff.changedChars);
    expect(diff.hunks.join(' ')).toContain('pilot');
  });

  it('skips a one-letter typo on a long line as tiny', () => {
    const diff = diffDriveText(
      LONG_SOW_SENTENCE,
      LONG_SOW_SENTENCE.replace('implementation', 'implementaton'),
    );
    expect(diff.changed).toBe(false);
    expect(diff.reason).toBe('tiny');
    expect(diff.changedChars).toBeLessThan(40);
  });

  it('keeps a contract-amount edit on a long line substantive', () => {
    const diff = diffDriveText(
      `${LONG_SOW_SENTENCE} at a $12k fee.`,
      `${LONG_SOW_SENTENCE} at a $48k fee.`,
    );
    expect(diff.changed).toBe(true);
    expect(diff.reason).toBe('substantive');
    expect(diff.hunks.join(' ')).toContain('$48k');
  });

  it.each([
    {
      name: 'punctuation-only period',
      previous: 'Status is open',
      next: 'Status is open.',
      reason: 'tiny' as const,
    },
    {
      name: 'long-line punctuation',
      previous: LONG_SOW_SENTENCE,
      next: `${LONG_SOW_SENTENCE}.`,
      reason: 'tiny' as const,
    },
    {
      name: 'single-letter typo inside a long word',
      previous: LONG_SOW_SENTENCE,
      next: LONG_SOW_SENTENCE.replace('implementation', 'implementaton'),
      reason: 'tiny' as const,
    },
    {
      name: 'whitespace-only',
      previous: 'Hello world',
      next: 'Hello  world',
      reason: 'formatting' as const,
    },
    {
      name: 'case-only',
      previous: 'Hello world',
      next: 'hello world',
      reason: 'formatting' as const,
    },
    {
      name: 'whole-word not insertion',
      previous: 'Customer approval is required before signing.',
      next: 'Customer approval is not required before signing.',
      reason: 'substantive' as const,
    },
    {
      name: 'whole-word no insertion',
      previous: 'The clause is binding after signature.',
      next: 'The clause is no binding after signature.',
      reason: 'substantive' as const,
    },
    {
      name: 'whole-word never insertion',
      previous: 'The customer may cancel after day 30.',
      next: 'The customer may never cancel after day 30.',
      reason: 'substantive' as const,
    },
    {
      name: 'digit change',
      previous: 'Term is 12 months for Northstar.',
      next: 'Term is 24 months for Northstar.',
      reason: 'substantive' as const,
    },
    {
      name: 'currency change',
      previous: `${LONG_SOW_SENTENCE} at a $12k fee.`,
      next: `${LONG_SOW_SENTENCE} at a $48k fee.`,
      reason: 'substantive' as const,
    },
    {
      name: 'short word is not a typo',
      previous: 'Pay the fee now.',
      next: 'Pay teh fee now.',
      reason: 'substantive' as const,
    },
  ])('classifies $name as $reason', ({ previous, next, reason }) => {
    const diff = diffDriveText(previous, next);
    expect(diff.reason).toBe(reason);
    expect(diff.changed).toBe(reason === 'substantive');
  });

  it('returns changed hunks for substantive edits', () => {
    const diff = diffDriveText(
      'Acme Labs is evaluating a $12k pilot.',
      'Acme Labs signed a $48k annual contract with Northstar.',
    );
    expect(diff.changed).toBe(true);
    expect(diff.reason).toBe('substantive');
    expect(diff.hunks.join(' ')).toContain('$48k');
  });

  it('truncates snapshots used for later diffs', () => {
    expect(truncateDriveSnapshot('abcdef', 4)).toBe('abcd');
  });

  it('does not treat an unchanged tail as added when the stored snapshot is truncated', () => {
    const paragraph = 'Contract amount is forty eight thousand dollars for Northstar.\n';
    const full = paragraph.repeat(500);
    expect(full.length).toBeGreaterThan(DRIVE_SNAPSHOT_MAX_CHARS);
    const previousStored = truncateDriveSnapshot(full);
    const nextFull = full.replace('forty eight', 'forty  eight');
    const unlike = diffDriveText(previousStored, nextFull);
    expect(unlike.changed).toBe(true);
    expect(unlike.reason).toBe('substantive');
    const like = diffDriveSnapshots(snapshotArgs(full, nextFull));
    expect(like.changed).toBe(false);
    expect(like.reason).toBe('formatting');
  });

  it('keeps full-text hash changes past the snapshot bound as real current-text hunks', () => {
    const prefix = 'A'.repeat(DRIVE_SNAPSHOT_MAX_CHARS);
    const previousFull = `${prefix}OLD_TAIL signed $12k`;
    const nextFull = `${prefix}NEW_TAIL signed $48k Northstar contract.`;
    const diff = diffDriveSnapshots(snapshotArgs(previousFull, nextFull));
    expect(diff.changed).toBe(true);
    expect(driveDiffHasEvidence(diff)).toBe(true);
    expect(diff.hunks.join(' ')).toContain('$48k');
    expect(diff.hunks.join(' ')).not.toContain('Text changed past the stored snapshot window.');
  });

  it('skips a tiny prefix edit when the suffix window proves the rest is unchanged', () => {
    const body = SOW_LINE.repeat(500);
    const previousFull = `Status is open\n${body}`;
    const nextFull = `Status is open.\n${body}`;
    const diff = diffDriveSnapshots(snapshotArgs(previousFull, nextFull));
    expect(diff.changed).toBe(false);
    expect(diff.reason).toBe('tiny');
  });

  it('keeps later-half edits when a changed line is longer than 400 characters', () => {
    const prefix = 'A'.repeat(500);
    const diff = diffDriveText(`${prefix}OLD_VALUE`, `${prefix}NEW_VALUE`);
    expect(diff.changed).toBe(true);
    expect(diff.hunks.join(' ')).toContain('NEW_VALUE');
    expect(diff.hunks.some((hunk) => hunk.startsWith('- ') && hunk.includes('OLD_VALUE'))).toBe(
      true,
    );
  });

  it('collects removed lines even when other lines were added', () => {
    const diff = diffDriveText(
      'The vendor shall indemnify Acme Labs against all claims arising from delivery.\nKeep this line.',
      `${SIGNING_PARAGRAPH}\nKeep this line.`,
    );
    expect(diff.changed).toBe(true);
    expect(diff.hunks.join(' ')).toContain('$48k');
    expect(diff.hunks.some((hunk) => hunk.startsWith('- ') && hunk.includes('indemnify'))).toBe(
      true,
    );
  });

  it('emits bounded removed-text hunks for deletion-only diffs', () => {
    const previous =
      'Acme Labs is evaluating a $12k pilot with Northstar this quarter.\nKeep this line.';
    const next = 'Keep this line.';
    const diff = diffDriveText(previous, next);
    expect(diff.changed).toBe(true);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]).toMatch(/^- /);
    expect(diff.hunks[0]).toContain('$12k');
    expect(diff.hunks[0]).not.toBe('- ');
  });
});

function snapshotArgs(
  previousFull: string,
  nextFull: string,
): {
  previousSnapshotText: string;
  previousLocate: ReturnType<typeof buildDriveSnapshotLocate>;
  nextFullText: string;
  previousContentHash: string;
  nextContentHash: string;
} {
  return {
    previousSnapshotText: truncateDriveSnapshot(previousFull),
    previousLocate: buildDriveSnapshotLocate(previousFull),
    nextFullText: nextFull,
    previousContentHash: previousFull === nextFull ? 'same-hash' : 'prev-hash',
    nextContentHash: previousFull === nextFull ? 'same-hash' : 'next-hash',
  };
}

function shortSow(repeats = 24): string {
  const text = SOW_LINE.repeat(repeats);
  if (text.length >= DRIVE_SNAPSHOT_MAX_CHARS) {
    throw new Error(`short fixture ${text.length} reached the snapshot cap`);
  }
  return text;
}

function longSow(repeats = 500): string {
  const text = SOW_LINE.repeat(repeats);
  if (text.length <= DRIVE_SNAPSHOT_MAX_CHARS) {
    throw new Error(`long fixture ${text.length} did not exceed the snapshot cap`);
  }
  return text;
}

/** Unique clause starting near char 19.2k, past the old 1024-char slack drop. */
function nearCapBoundaryEdit(amount: string): string {
  const marker = `Acme Labs signed a ${amount} annual contract with Northstar this quarter.`;
  const prefix = 'A'.repeat(19_200);
  const tail = 'B'.repeat(5_000);
  const text = `${prefix}${marker}${tail}`;
  if (text.length <= DRIVE_SNAPSHOT_MAX_CHARS) {
    throw new Error(`near-cap fixture ${text.length} did not exceed the snapshot cap`);
  }
  if (prefix.length + marker.length > DRIVE_SNAPSHOT_MAX_CHARS) {
    throw new Error('near-cap marker sits past the stored snapshot window');
  }
  return text;
}

function suffixAmountAt(offset: number, amount: string): string {
  const line = `Renewal amount is ${amount} for Northstar.\n`;
  const prefix = 'A'.repeat(offset);
  const tail = 'B'.repeat(200);
  const text = `${prefix}${line}${tail}`;
  if (offset <= DRIVE_SNAPSHOT_MAX_CHARS) {
    throw new Error(`suffix amount offset ${offset} sits inside the prefix window`);
  }
  return text;
}

function cosmeticSuffixAt(offset: number, next = false): string {
  const line = next ? 'Status is open.\n' : 'Status is open\n';
  return `${'A'.repeat(offset)}${line}${'B'.repeat(200)}`;
}

function middleAmountAt(offset: number, amount: string): string {
  const line = `Renewal amount is ${amount} for Northstar.\n`;
  const prefix = 'A'.repeat(offset);
  const tail = 'B'.repeat(40_000);
  const text = `${prefix}${line}${tail}`;
  if (offset <= DRIVE_SNAPSHOT_MAX_CHARS) {
    throw new Error(`middle amount offset ${offset} sits inside the prefix window`);
  }
  if (text.length - offset - line.length < DRIVE_SNAPSHOT_MAX_CHARS) {
    throw new Error('middle amount fixture tail is shorter than the suffix window');
  }
  return text;
}

const APPROVED_RENEWAL = 'Customer renewal approved.';
const REJECTED_RENEWAL = 'Customer renewal rejected.';

function documentWithPhrase(length: number, offset: number, phrase: string): string {
  if (phrase.length === 0) {
    throw new Error('documentWithPhrase requires a phrase');
  }
  if (offset < 0 || offset + phrase.length > length) {
    throw new Error(`phrase at ${offset} does not fit in ${length}`);
  }
  return `${'A'.repeat(offset)}${phrase}${'B'.repeat(length - offset - phrase.length)}`;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function spliceAt(text: string, offset: number, deleteCount: number, insert: string): string {
  return `${text.slice(0, offset)}${insert}${text.slice(offset + deleteCount)}`;
}

function hunkBody(hunk: string): string {
  return hunk.startsWith('- ') ? hunk.slice(2) : hunk;
}

describe('diffDriveSnapshots regression matrix', () => {
  const short = shortSow();
  const long = longSow();
  const nearCap = SOW_LINE.repeat(400).slice(0, DRIVE_SNAPSHOT_MAX_CHARS - 50);

  const matrix: {
    name: string;
    previousFull: string;
    nextFull: string;
    changed: boolean;
    reason: 'identical' | 'formatting' | 'tiny' | 'substantive';
    hunkIncludes?: string;
    hunkExcludes?: string;
    hunkEquals?: string[];
    removedHunk?: boolean;
  }[] = [
    {
      name: '<20k append of a contract-signing paragraph',
      previousFull: short,
      nextFull: `${short}\n${SIGNING_PARAGRAPH}`,
      changed: true,
      reason: 'substantive',
      hunkIncludes: '$48k',
    },
    {
      name: '<20k delete-tail of a contract-signing paragraph',
      previousFull: `${short}\n${SIGNING_PARAGRAPH}`,
      nextFull: short,
      changed: true,
      reason: 'substantive',
      hunkIncludes: '$48k',
      removedHunk: true,
    },
    {
      name: '<20k mid-window amount edit',
      previousFull: short.replace('implementation', 'a $12k implementation'),
      nextFull: short.replace('implementation', 'a $48k implementation'),
      changed: true,
      reason: 'substantive',
      hunkIncludes: '$48k',
    },
    {
      name: '<20k whitespace-only',
      previousFull: short,
      nextFull: short.replace('training, and', 'training,  and'),
      changed: false,
      reason: 'formatting',
    },
    {
      name: '<20k markdown formatting-only',
      previousFull: `# Title\n\n${short}`,
      nextFull: `Title\n${short.replaceAll('\n\n', '\n')}`,
      changed: false,
      reason: 'formatting',
    },
    {
      name: '<20k tiny punctuation',
      previousFull: 'Status is open\n' + short,
      nextFull: 'Status is open.\n' + short,
      changed: false,
      reason: 'tiny',
    },
    {
      name: '<20k signed-amount hyphen stays substantive',
      previousFull: `Budget is -50000 USD for the Northstar pilot.\n${short}`,
      nextFull: `Budget is 50000 USD for the Northstar pilot.\n${short}`,
      changed: true,
      reason: 'substantive',
      hunkIncludes: '50000 USD',
    },
    {
      name: '<20k identical snapshots',
      previousFull: short,
      nextFull: short,
      changed: false,
      reason: 'identical',
    },
    {
      name: '<20k whitespace-only unmatched suffix',
      previousFull: short,
      nextFull: `${short}\n\n  `,
      changed: false,
      reason: 'formatting',
    },
    {
      name: 'cross-cap append keeps the visible signing suffix',
      previousFull: nearCap,
      nextFull: `${nearCap}\n${SIGNING_PARAGRAPH}`,
      changed: true,
      reason: 'substantive',
      hunkIncludes: '$48k',
    },
    {
      name: 'cross-cap delete-tail keeps the removed signing suffix',
      previousFull: `${nearCap}\n${SIGNING_PARAGRAPH}`,
      nextFull: nearCap,
      changed: true,
      reason: 'substantive',
      hunkIncludes: '$48k',
      removedHunk: true,
    },
    {
      name: '>20k append past the stored window',
      previousFull: long,
      nextFull: `${long}\n${SIGNING_PARAGRAPH}`,
      changed: true,
      reason: 'substantive',
      hunkIncludes: '$48k',
    },
    {
      name: '>20k delete-tail past the stored window',
      previousFull: `${long}\n${SIGNING_PARAGRAPH}`,
      nextFull: long,
      changed: true,
      reason: 'substantive',
      hunkIncludes: '$48k',
      removedHunk: true,
    },
    {
      name: '>20k delete of the stored window tail',
      previousFull: long,
      nextFull: long.slice(0, 15_000),
      changed: true,
      reason: 'substantive',
      removedHunk: true,
    },
    {
      name: '>20k mid-window amount edit',
      previousFull: long.replace('implementation', 'a $12k implementation'),
      nextFull: long.replace('implementation', 'a $48k implementation'),
      changed: true,
      reason: 'substantive',
      hunkIncludes: '$48k',
    },
    {
      name: '>20k whitespace-only in the stored window with a moved hash',
      previousFull: long,
      nextFull: long.replace('training, and', 'training,  and'),
      changed: false,
      reason: 'formatting',
    },
    {
      name: '>20k tiny prefix punctuation with a moved hash',
      previousFull: `Status is open\n${long}`,
      nextFull: `Status is open.\n${long}`,
      changed: false,
      reason: 'tiny',
    },
    {
      name: '>20k renewal amount at char 25k',
      previousFull: suffixAmountAt(25_000, '$12k'),
      nextFull: suffixAmountAt(25_000, '$48k'),
      changed: true,
      reason: 'substantive',
      hunkIncludes: '$48k',
    },
    {
      name: '>20k cosmetic suffix punctuation is distinguishable as tiny',
      previousFull: cosmeticSuffixAt(25_000),
      nextFull: cosmeticSuffixAt(25_000, true),
      changed: false,
      reason: 'tiny',
    },
    {
      name: '>20k middle-window amount past prefix and suffix',
      previousFull: middleAmountAt(50_000, '$12k'),
      nextFull: middleAmountAt(50_000, '$48k'),
      changed: true,
      reason: 'substantive',
      hunkIncludes: '$48k',
    },
    {
      name: '>40k straddling-chunk renewal at char 20200',
      previousFull: documentWithPhrase(41_001, 20_200, APPROVED_RENEWAL),
      nextFull: documentWithPhrase(41_001, 20_200, REJECTED_RENEWAL),
      changed: true,
      reason: 'substantive',
      hunkIncludes: 'rejected',
    },
    {
      name: '>40k prefix-boundary straddling chunk',
      previousFull: documentWithPhrase(41_001, DRIVE_SNAPSHOT_MAX_CHARS - 10, APPROVED_RENEWAL),
      nextFull: documentWithPhrase(41_001, DRIVE_SNAPSHOT_MAX_CHARS - 10, REJECTED_RENEWAL),
      changed: true,
      reason: 'substantive',
      hunkIncludes: 'rejected',
    },
    {
      name: '>40k suffix-start straddling chunk',
      previousFull: documentWithPhrase(41_001, 21_001 - APPROVED_RENEWAL.length, APPROVED_RENEWAL),
      nextFull: documentWithPhrase(41_001, 21_001 - REJECTED_RENEWAL.length, REJECTED_RENEWAL),
      changed: true,
      reason: 'substantive',
      hunkIncludes: 'rejected',
    },
    {
      name: '>40k edit on a 4096-char chunk boundary in the unstored region',
      previousFull: documentWithPhrase(41_001, DRIVE_SNAPSHOT_CHUNK_CHARS * 5, APPROVED_RENEWAL),
      nextFull: documentWithPhrase(41_001, DRIVE_SNAPSHOT_CHUNK_CHARS * 5, REJECTED_RENEWAL),
      changed: true,
      reason: 'substantive',
      hunkIncludes: 'rejected',
    },
    {
      name: '>20k mid-window edit plus past-window append',
      previousFull: long.replace('implementation', 'a $12k implementation'),
      nextFull: `${long.replace('implementation', 'a $48k implementation')}\n${SIGNING_PARAGRAPH}`,
      changed: true,
      reason: 'substantive',
      hunkIncludes: '$48k',
    },
    {
      name: '<20k delete a clause while adding a signing line',
      previousFull: `The vendor shall indemnify Acme Labs against all claims arising from delivery.\n${short}`,
      nextFull: `${SIGNING_PARAGRAPH}\n${short}`,
      changed: true,
      reason: 'substantive',
      hunkIncludes: '$48k',
      removedHunk: true,
    },
    {
      name: '~19k mid-window amount edit under a moved hash',
      previousFull: nearCapBoundaryEdit('$12k'),
      nextFull: nearCapBoundaryEdit('$48k'),
      changed: true,
      reason: 'substantive',
      hunkIncludes: '$48k',
      removedHunk: true,
    },
  ];

  for (const row of matrix) {
    it(row.name, () => {
      const diff = diffDriveSnapshots(snapshotArgs(row.previousFull, row.nextFull));
      expect(diff.changed).toBe(row.changed);
      expect(diff.reason).toBe(row.reason);
      if (row.hunkEquals) {
        expect(diff.hunks).toEqual(row.hunkEquals);
      }
      if (row.hunkIncludes) {
        expect(diff.hunks.join(' ')).toContain(row.hunkIncludes);
      }
      if (row.hunkExcludes) {
        expect(diff.hunks.join(' ')).not.toContain(row.hunkExcludes);
      }
      if (row.removedHunk) {
        expect(diff.hunks.some((hunk) => hunk.startsWith('- '))).toBe(true);
      }
      if (row.previousFull !== row.nextFull) {
        expect(diff.reason).not.toBe('identical');
      }
      if (row.changed) expect(driveDiffHasEvidence(diff)).toBe(true);
      expect(diff.hunks.join(' ')).not.toContain('Text changed past the stored snapshot window.');
    });
  }

  it('never returns identical for a 41,001-char hash-moved edit at offset 20,200', () => {
    const previousFull = documentWithPhrase(41_001, 20_200, APPROVED_RENEWAL);
    const nextFull = documentWithPhrase(41_001, 20_200, REJECTED_RENEWAL);
    expect(previousFull.length).toBe(41_001);
    expect(nextFull.length).toBe(41_001);
    expect(previousFull.indexOf(APPROVED_RENEWAL)).toBe(20_200);
    expect(nextFull.indexOf(REJECTED_RENEWAL)).toBe(20_200);
    const prefixEnd = DRIVE_SNAPSHOT_MAX_CHARS;
    const suffixStart = 41_001 - DRIVE_SNAPSHOT_MAX_CHARS;
    expect(20_200).toBeGreaterThan(prefixEnd);
    expect(20_200 + APPROVED_RENEWAL.length).toBeLessThan(suffixStart);
    const firstExclusive = Math.ceil(prefixEnd / DRIVE_SNAPSHOT_CHUNK_CHARS);
    const lastExclusive = Math.floor(suffixStart / DRIVE_SNAPSHOT_CHUNK_CHARS);
    expect(firstExclusive).toBe(lastExclusive);
    const diff = diffDriveSnapshots(snapshotArgs(previousFull, nextFull));
    expect(diff.changed).toBe(true);
    expect(diff.reason).not.toBe('identical');
    expect(diff.reason).toBe('substantive');
    expect(diff.hunks.join(' ')).toContain('rejected');
    expect(diff.hunks.some((hunk) => nextFull.includes(hunkBody(hunk)))).toBe(true);
    expect(driveDiffHasEvidence(diff)).toBe(true);
  });

  it('never returns identical for hash-moved edits across prefix, chunk, and suffix bounds', () => {
    const rng = mulberry32(20_200);
    const lengths = [41_001, 45_000, 50_000, 81_920];
    const inserts = ['X', 'rejected.', REJECTED_RENEWAL, ' $48k '];
    let checked = 0;
    for (const length of lengths) {
      const previous = 'N'.repeat(length);
      const suffixStart = Math.max(0, length - DRIVE_SNAPSHOT_MAX_CHARS);
      const offsets = [
        0,
        DRIVE_SNAPSHOT_MAX_CHARS - 1,
        DRIVE_SNAPSHOT_MAX_CHARS,
        DRIVE_SNAPSHOT_MAX_CHARS + 1,
        DRIVE_SNAPSHOT_CHUNK_CHARS * 4,
        DRIVE_SNAPSHOT_CHUNK_CHARS * 5,
        20_200,
        suffixStart - 1,
        suffixStart,
        suffixStart + 1,
        length - 8,
        ...Array.from({ length: 8 }, () => Math.floor(rng() * Math.max(1, length - 12))),
      ].filter((offset) => offset >= 0 && offset < length);
      for (const offset of offsets) {
        for (const insert of inserts) {
          const deleteCount = Math.min(length - offset, 1 + Math.floor(rng() * 12));
          const next = spliceAt(previous, offset, deleteCount, insert);
          if (next === previous) continue;
          const diff = diffDriveSnapshots(snapshotArgs(previous, next));
          expect(diff.reason).not.toBe('identical');
          if (diff.changed) {
            expect(driveDiffHasEvidence(diff)).toBe(true);
            const currentHunks = diff.hunks.filter((hunk) => !hunk.startsWith('- '));
            expect(currentHunks.length).toBeGreaterThan(0);
            expect(
              currentHunks.some((hunk) => {
                const body = hunkBody(hunk).replaceAll('…', '');
                return body.length === 0 || next.includes(body.slice(0, Math.min(24, body.length)));
              }),
            ).toBe(true);
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(80);
  });

  it('does not treat unlike truncated-vs-full comparison as the snapshot path', () => {
    const previousFull = longSow();
    const nextFull = `${previousFull}\n${SIGNING_PARAGRAPH}`;
    const unlike = diffDriveText(truncateDriveSnapshot(previousFull), nextFull);
    expect(unlike.changed).toBe(true);
    expect(unlike.hunks.join(' ')).toContain('$48k');
    const like = diffDriveSnapshots(snapshotArgs(previousFull, nextFull));
    expect(like.changed).toBe(true);
    expect(like.hunks.join(' ')).toContain('$48k');
    expect(like.hunks.join(' ')).not.toContain('Text changed past the stored snapshot window.');
  });

  it('still excerpts a 25k amount from current text when the previous locate is missing', () => {
    const previousFull = suffixAmountAt(25_000, '$12k');
    const nextFull = suffixAmountAt(25_000, '$48k');
    const diff = diffDriveSnapshots({
      previousSnapshotText: truncateDriveSnapshot(previousFull),
      nextFullText: nextFull,
      previousContentHash: 'old-hash',
      nextContentHash: 'new-hash',
    });
    expect(diff.changed).toBe(true);
    expect(diff.hunks.join(' ')).toContain('$48k');
    expect(driveDiffHasEvidence(diff)).toBe(true);
  });

  it('builds a parseable suffix and chunk-hash locate index', () => {
    const text = suffixAmountAt(25_000, '$48k');
    const locate = buildDriveSnapshotLocate(text);
    expect(locate.length).toBe(text.length);
    expect(locate.chunkSize).toBe(DRIVE_SNAPSHOT_CHUNK_CHARS);
    expect(locate.suffix).toBe(text.slice(-DRIVE_SNAPSHOT_MAX_CHARS));
    expect(locate.suffix).toContain('$48k');
    expect(locate.chunkHashes.length).toBe(Math.ceil(text.length / DRIVE_SNAPSHOT_CHUNK_CHARS));
    expect(parseDriveSnapshotLocate(locate)).toEqual(locate);
    expect(parseDriveSnapshotLocate(null)).toBeNull();
  });
});

describe('resolveDriveSnapshotDiff invariant', () => {
  const identical = {
    changed: false,
    reason: 'identical' as const,
    changedChars: 0,
    hunks: [] as string[],
  };
  const formatting = {
    changed: false,
    reason: 'formatting' as const,
    changedChars: 0,
    hunks: [] as string[],
  };
  const tiny = {
    changed: false,
    reason: 'tiny' as const,
    changedChars: 5,
    hunks: ['Status is open.'],
  };
  const substantive = {
    changed: true,
    reason: 'substantive' as const,
    changedChars: 40,
    hunks: ['$48k annual contract'],
  };

  const matrix: {
    name: string;
    windowDiff: DriveTextDiff;
    hashMoved: boolean;
    windowCoversFullText: boolean;
    changed: boolean;
    reason: DriveTextDiff['reason'];
    hunkEquals?: string[];
  }[] = [];

  for (const windowDiff of [identical, formatting, tiny, substantive]) {
    for (const hashMoved of [false, true]) {
      for (const windowCoversFullText of [false, true]) {
        const mustEscalate = !windowDiff.changed && hashMoved && !windowCoversFullText;
        matrix.push({
          name: `${windowDiff.reason} window, hashMoved=${String(hashMoved)}, coversFullText=${String(windowCoversFullText)}`,
          windowDiff,
          hashMoved,
          windowCoversFullText,
          changed: windowDiff.changed || mustEscalate,
          reason: mustEscalate ? 'substantive' : windowDiff.reason,
          ...(mustEscalate ? { hunkEquals: [] } : {}),
        });
      }
    }
  }

  for (const row of matrix) {
    it(row.name, () => {
      const diff = resolveDriveSnapshotDiff({
        windowDiff: row.windowDiff,
        hashMoved: row.hashMoved,
        windowCoversFullText: row.windowCoversFullText,
      });
      expect(diff.changed).toBe(row.changed);
      expect(diff.reason).toBe(row.reason);
      if (row.hunkEquals) expect(diff.hunks).toEqual(row.hunkEquals);
      if (row.windowDiff.changed) expect(diff.hunks).toEqual(row.windowDiff.hunks);
      expect(diff.hunks.join(' ')).not.toContain('Text changed past the stored snapshot window.');
    });
  }

  it('never returns identical when a located diff is identical but the hash moved', () => {
    const diff = resolveDriveSnapshotDiff({
      windowDiff: identical,
      hashMoved: true,
      windowCoversFullText: false,
      locatedDiff: identical,
    });
    expect(diff.changed).toBe(true);
    expect(diff.reason).not.toBe('identical');
  });

  it('uses located current-text hunks instead of escalating to a content-free marker', () => {
    const located = {
      changed: true,
      reason: 'substantive' as const,
      changedChars: 8,
      hunks: ['Renewal amount is $48k for Northstar.'],
    };
    const diff = resolveDriveSnapshotDiff({
      windowDiff: identical,
      hashMoved: true,
      windowCoversFullText: false,
      locatedDiff: located,
    });
    expect(diff).toEqual(located);
    expect(driveDiffHasEvidence(diff)).toBe(true);
  });

  it('honors a located tiny suffix instead of escalating a moved hash', () => {
    const located = {
      changed: false,
      reason: 'tiny' as const,
      changedChars: 1,
      hunks: ['Status is open.'],
    };
    const diff = resolveDriveSnapshotDiff({
      windowDiff: identical,
      hashMoved: true,
      windowCoversFullText: false,
      locatedDiff: located,
    });
    expect(diff.changed).toBe(false);
    expect(diff.reason).toBe('tiny');
  });

  it('treats a cap-length stored window as unable to prove the suffix', () => {
    const cap = 'A'.repeat(DRIVE_SNAPSHOT_MAX_CHARS);
    expect(driveSnapshotWindowCoversFullText(cap, cap)).toBe(false);
    expect(driveSnapshotWindowCoversFullText('short', 'short')).toBe(true);
  });

  it('keeps <20k formatting skip even when the full-text hash moved', () => {
    const previousFull = shortSow();
    const nextFull = previousFull.replace('training, and', 'training,  and');
    const diff = diffDriveSnapshots(snapshotArgs(previousFull, nextFull));
    expect(diff.changed).toBe(false);
    expect(diff.reason).toBe('formatting');
  });

  it('keeps >20k formatting skip when the full-text hash did not move', () => {
    const previousFull = longSow();
    const nextFull = previousFull.replace('training, and', 'training,  and');
    const diff = diffDriveSnapshots({
      ...snapshotArgs(previousFull, nextFull),
      previousContentHash: 'same-hash',
      nextContentHash: 'same-hash',
    });
    expect(diff.changed).toBe(false);
    expect(diff.reason).toBe('formatting');
  });
});
