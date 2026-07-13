import { describe, expect, it, vi } from 'vitest';

import {
  classifyMondayBoardResponse,
  runMondayHelperRepairFollowups,
} from '#src/integrations/monday-repair.js';

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

describe('runMondayHelperRepairFollowups', () => {
  it('retains a failed backfill while independently completing webhook reconciliation', async () => {
    const enqueueBackfill = vi.fn().mockRejectedValue(new Error('redis unavailable'));
    const reconcileWebhooks = vi.fn().mockResolvedValue(undefined);
    const markFollowup = vi.fn().mockResolvedValue(undefined);

    const results = await runMondayHelperRepairFollowups({
      followups: [
        {
          integrationId: 'integration-1',
          helperBoardIds: ['helper-1'],
          backfillQueued: false,
          webhooksReconciled: false,
        },
      ],
      enqueueBackfill,
      reconcileWebhooks,
      markFollowup,
    });

    expect(enqueueBackfill).toHaveBeenCalledWith('integration-1');
    expect(reconcileWebhooks).toHaveBeenCalledWith('integration-1');
    expect(markFollowup).toHaveBeenCalledTimes(1);
    expect(markFollowup).toHaveBeenCalledWith('integration-1', {
      webhooksReconciled: true,
    });
    expect(results).toEqual([
      {
        integrationId: 'integration-1',
        backfill: { status: 'failed', error: 'redis unavailable' },
        webhooks: { status: 'ok' },
      },
    ]);
  });

  it('skips follow-ups already recorded as complete', async () => {
    const enqueueBackfill = vi.fn();
    const reconcileWebhooks = vi.fn();
    const markFollowup = vi.fn();

    const results = await runMondayHelperRepairFollowups({
      followups: [
        {
          integrationId: 'integration-1',
          helperBoardIds: ['helper-1'],
          backfillQueued: true,
          webhooksReconciled: false,
        },
      ],
      enqueueBackfill,
      reconcileWebhooks,
      markFollowup,
    });

    expect(enqueueBackfill).not.toHaveBeenCalled();
    expect(reconcileWebhooks).toHaveBeenCalledWith('integration-1');
    expect(markFollowup).toHaveBeenCalledWith('integration-1', {
      webhooksReconciled: true,
    });
    expect(results[0]?.backfill).toEqual({ status: 'already_complete' });
  });
});
