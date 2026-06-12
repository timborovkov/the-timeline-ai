import { describe, expect, it } from 'vitest';

import { suggestionTargetsObject } from '@/app/app/objects/[id]/suggestion-targets';

describe('suggestionTargetsObject', () => {
  it('matches object suggestions by target id', () => {
    expect(
      suggestionTargetsObject(
        {
          targetId: 'object-1',
          targetKind: 'object',
          proposedPayload: {},
        },
        'object-1',
      ),
    ).toBe(true);
  });

  it('matches board membership suggestions by proposed entity id', () => {
    expect(
      suggestionTargetsObject(
        {
          targetId: null,
          targetKind: 'board_membership',
          proposedPayload: { boardId: 'board-1', entityId: 'object-1' },
        },
        'object-1',
      ),
    ).toBe(true);
  });

  it('does not match unrelated board suggestions', () => {
    expect(
      suggestionTargetsObject(
        {
          targetId: null,
          targetKind: 'board_membership',
          proposedPayload: { boardId: 'board-1', entityId: 'object-2' },
        },
        'object-1',
      ),
    ).toBe(false);
  });

  it('matches board item update suggestions by the object board item id', () => {
    expect(
      suggestionTargetsObject(
        {
          targetId: null,
          targetKind: 'board_item_update',
          proposedPayload: { boardItemId: 'board-item-1', field: 'priority', newValue: 2 },
        },
        'object-1',
        { boardItemIds: new Set(['board-item-1']) },
      ),
    ).toBe(true);
  });
});
