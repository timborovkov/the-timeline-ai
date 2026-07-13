import { describe, expect, it } from 'vitest';

import { classifyMondayBoardResponse } from '#src/integrations/monday-repair.js';

// Monday may return HTTP 200 while omitting deleted or inaccessible boards.
// Repair must treat those omissions as unverified so apply mode cannot silently
// leave stale helper-board selections and webhook rows behind.
describe('classifyMondayBoardResponse', () => {
  it('reports every requested board that Monday omitted', () => {
    expect(
      classifyMondayBoardResponse(
        ['parent-1', 'helper-1', 'deleted-1'],
        [
          { id: 'parent-1', type: 'board' },
          { id: 'helper-1', type: 'sub_items_board' },
        ],
      ),
    ).toEqual({
      helperBoardIds: ['helper-1'],
      missingBoardIds: ['deleted-1'],
    });
  });
});
