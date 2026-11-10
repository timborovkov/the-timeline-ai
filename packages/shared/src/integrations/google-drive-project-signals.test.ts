import { describe, expect, it } from 'bun:test';

import { diffDriveText } from '#src/integrations/google-drive-diff.js';
import { changedDriveProjectFields } from '#src/integrations/google-drive-project-signals.js';

describe('changedDriveProjectFields', () => {
  it('preserves owner, date, budget, and status changes from the real diff path', () => {
    const before =
      'Owner: Alex Morgan\nLaunch date: 20 November 2026\nStatus: Planning\nApproved budget: EUR 1200';
    const after =
      'Owner: Jamie Lee\nLaunch date: 27 November 2026\nStatus: Pilot approved\nApproved budget: EUR 1800';
    expect(changedDriveProjectFields(diffDriveText(before, after).hunks)).toEqual([
      'owner',
      'launch date',
      'status',
      'approved budget',
    ]);
  });

  it('does not promote cosmetic edits, unchanged context, or unpaired fields', () => {
    expect(
      changedDriveProjectFields([
        '- Owner: Alex Morgan',
        'Owner: ALEX MORGAN',
        '- Budget: EUR 1200',
        'Budget: EUR 1200',
        '- Status: Plannning',
        'Status: Planning',
        'Deadline: Friday',
        '- We should clarify the budget.',
        'We should explain the budget.',
      ]),
    ).toEqual([]);
  });

  it('does not pair ambiguous fields from different sections', () => {
    expect(changedDriveProjectFields(['- Owner: Alex', '- Owner: Jamie', 'Owner: Chris'])).toEqual(
      [],
    );
  });

  it('preserves short semantic changes such as numbers and negation', () => {
    expect(
      changedDriveProjectFields([
        '- Budget: EUR 1200',
        'Budget: EUR 1800',
        '- Status: approved',
        'Status: not approved',
      ]),
    ).toEqual(['budget', 'status']);
  });
});
