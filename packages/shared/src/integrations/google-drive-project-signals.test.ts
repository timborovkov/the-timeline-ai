import { describe, expect, it } from 'bun:test';

import { changedDriveProjectFields } from '#src/integrations/google-drive-project-signals.js';

describe('changedDriveProjectFields', () => {
  it('preserves owner, date, budget, and status changes from the real diff path', () => {
    const before =
      'Owner: Alex Morgan\nLaunch date: 20 November 2026\nStatus: Planning\nApproved budget: EUR 1200';
    const after =
      'Owner: Jamie Lee\nLaunch date: 27 November 2026\nStatus: Pilot approved\nApproved budget: EUR 1800';
    expect(changedDriveProjectFields(before, after)).toEqual([
      'owner',
      'launch date',
      'status',
      'approved budget',
    ]);
  });

  it('does not promote cosmetic edits, unchanged context, or unpaired fields', () => {
    expect(
      changedDriveProjectFields(
        'Owner: Alex Morgan\nBudget: EUR 1200\nStatus: Plannning\nWe should clarify the budget.',
        'Owner: ALEX MORGAN\nBudget: EUR 1200\nStatus: Planning\nDeadline: Friday\nWe should explain the budget.',
      ),
    ).toEqual([]);
  });

  it('does not pair ambiguous fields even when one occurrence is unchanged', () => {
    expect(
      changedDriveProjectFields('Owner: Alex\nOwner: Jamie', 'Owner: Chris\nOwner: Jamie'),
    ).toEqual([]);
  });

  it('preserves short semantic changes such as numbers and negation', () => {
    expect(
      changedDriveProjectFields(
        'Budget: EUR 1200\nStatus: approved',
        'Budget: EUR 1800\nStatus: not approved',
      ),
    ).toEqual(['budget', 'status']);
  });
});
