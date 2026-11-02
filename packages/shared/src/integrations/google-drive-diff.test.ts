import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  DRIVE_BEYOND_SNAPSHOT_HUNK,
  DRIVE_SNAPSHOT_MAX_CHARS,
  diffDriveSnapshots,
  diffDriveText,
  normalizeDriveTextForCompare,
  truncateDriveSnapshot,
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
    const like = diffDriveSnapshots({
      previousSnapshotText: previousStored,
      nextSnapshotText: truncateDriveSnapshot(nextFull),
      previousContentHash: 'prev-hash',
      nextContentHash: 'next-hash',
    });
    expect(like.changed).toBe(false);
    expect(like.reason).toBe('formatting');
  });

  it('keeps full-text hash changes past the snapshot bound without inventing a tail add', () => {
    const prefix = 'A'.repeat(DRIVE_SNAPSHOT_MAX_CHARS);
    const previousFull = `${prefix}OLD_TAIL signed $12k`;
    const nextFull = `${prefix}NEW_TAIL signed $48k Northstar contract.`;
    const diff = diffDriveSnapshots({
      previousSnapshotText: truncateDriveSnapshot(previousFull),
      nextSnapshotText: truncateDriveSnapshot(nextFull),
      previousContentHash: 'old-hash',
      nextContentHash: 'new-hash',
    });
    expect(diff.changed).toBe(true);
    expect(diff.hunks).toEqual([DRIVE_BEYOND_SNAPSHOT_HUNK]);
    expect(diff.hunks.join(' ')).not.toContain('$48k');
  });

  it('does not escalate a tiny prefix edit because the full-text hash also changed', () => {
    const body = SOW_LINE.repeat(500);
    const previousFull = `Status is open\n${body}`;
    const nextFull = `Status is open.\n${body}`;
    const diff = diffDriveSnapshots({
      previousSnapshotText: truncateDriveSnapshot(previousFull),
      nextSnapshotText: truncateDriveSnapshot(nextFull),
      previousContentHash: 'old-hash',
      nextContentHash: 'new-hash',
    });
    expect(diff.changed).toBe(false);
    expect(diff.reason).toBe('tiny');
  });

  it('keeps later-half edits when a changed line is longer than 400 characters', () => {
    const prefix = 'A'.repeat(500);
    const diff = diffDriveText(`${prefix}OLD_VALUE`, `${prefix}NEW_VALUE`);
    expect(diff.changed).toBe(true);
    expect(diff.hunks.join(' ')).toContain('NEW_VALUE');
    expect(diff.hunks.join(' ')).not.toContain('OLD_VALUE');
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
  nextSnapshotText: string;
  previousContentHash: string;
  nextContentHash: string;
} {
  return {
    previousSnapshotText: truncateDriveSnapshot(previousFull),
    nextSnapshotText: truncateDriveSnapshot(nextFull),
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
      hunkEquals: [DRIVE_BEYOND_SNAPSHOT_HUNK],
      hunkExcludes: '$48k',
    },
    {
      name: '>20k delete-tail past the stored window',
      previousFull: `${long}\n${SIGNING_PARAGRAPH}`,
      nextFull: long,
      changed: true,
      reason: 'substantive',
      hunkEquals: [DRIVE_BEYOND_SNAPSHOT_HUNK],
      hunkExcludes: '$48k',
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
      name: '>20k whitespace-only in the stored window',
      previousFull: long,
      nextFull: long.replace('training, and', 'training,  and'),
      changed: false,
      reason: 'formatting',
    },
    {
      name: '>20k tiny prefix punctuation',
      previousFull: `Status is open\n${long}`,
      nextFull: `Status is open.\n${long}`,
      changed: false,
      reason: 'tiny',
    },
    {
      name: '>20k mid-window edit plus past-window append',
      previousFull: long.replace('implementation', 'a $12k implementation'),
      nextFull: `${long.replace('implementation', 'a $48k implementation')}\n${SIGNING_PARAGRAPH}`,
      changed: true,
      reason: 'substantive',
      hunkIncludes: '$48k',
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
    });
  }

  it('does not treat unlike truncated-vs-full comparison as the snapshot path', () => {
    const previousFull = longSow();
    const nextFull = `${previousFull}\n${SIGNING_PARAGRAPH}`;
    const unlike = diffDriveText(truncateDriveSnapshot(previousFull), nextFull);
    expect(unlike.changed).toBe(true);
    expect(unlike.hunks.join(' ')).toContain('$48k');
    const like = diffDriveSnapshots(snapshotArgs(previousFull, nextFull));
    expect(like.hunks).toEqual([DRIVE_BEYOND_SNAPSHOT_HUNK]);
    expect(like.hunks.join(' ')).not.toContain('$48k');
  });
});
