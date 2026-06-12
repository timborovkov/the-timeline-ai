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

  it('matches relationship suggestions by either endpoint id', () => {
    expect(
      suggestionTargetsObject(
        {
          targetId: null,
          targetKind: 'object_relationship',
          proposedPayload: {
            fromEntityId: 'object-1',
            toEntityId: 'object-2',
            kind: 'related',
          },
        },
        'object-2',
      ),
    ).toBe(true);
  });

  it('matches relationship local refs through accepted sibling create results', () => {
    const siblingItems = [
      {
        targetId: null,
        resultId: 'object-1',
        targetKind: 'object',
        proposedPayload: {
          type: 'person',
          canonicalName: 'John Doe',
          localRef: 'John-Doe',
        },
      },
      {
        targetId: null,
        resultId: 'object-2',
        targetKind: 'object',
        proposedPayload: {
          type: 'company',
          canonicalName: 'Acme Corporation',
          localRef: 'acme',
        },
      },
    ];

    expect(
      suggestionTargetsObject(
        {
          targetId: null,
          targetKind: 'object_relationship',
          proposedPayload: {
            fromRef: 'john-doe',
            toRef: 'acme',
            kind: 'related',
          },
        },
        'object-2',
        { siblingItems },
      ),
    ).toBe(true);
  });

  it('matches mixed relationship payloads with one existing endpoint and one local ref', () => {
    expect(
      suggestionTargetsObject(
        {
          targetId: null,
          targetKind: 'object_relationship',
          proposedPayload: {
            fromEntityId: 'object-1',
            toRef: 'acme',
            kind: 'related',
          },
        },
        'object-1',
        {
          siblingItems: [
            {
              targetId: null,
              resultId: null,
              targetKind: 'object',
              proposedPayload: {
                type: 'company',
                canonicalName: 'Acme Corporation',
                localRef: 'acme',
              },
            },
          ],
        },
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
