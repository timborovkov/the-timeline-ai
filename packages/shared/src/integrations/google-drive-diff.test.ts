import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  diffDriveText,
  normalizeDriveTextForCompare,
  truncateDriveSnapshot,
} from '#src/integrations/google-drive-diff.js';

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
