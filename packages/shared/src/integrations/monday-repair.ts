export interface MondayBoardClassification {
  id: string;
  type?: string | null;
}

export function classifyMondayBoardResponse(
  requestedBoardIds: string[],
  returnedBoards: MondayBoardClassification[],
): { helperBoardIds: string[]; missingBoardIds: string[] } {
  const returnedIds = new Set(returnedBoards.map((board) => board.id));
  return {
    helperBoardIds: returnedBoards
      .filter((board) => board.type === 'sub_items_board')
      .map((board) => board.id),
    missingBoardIds: requestedBoardIds.filter((boardId) => !returnedIds.has(boardId)),
  };
}

export interface MondayHelperRepairFollowupState {
  integrationId: string;
  helperBoardIds: string[];
  backfillQueued: boolean;
  webhooksReconciled: boolean;
}

export type MondayHelperRepairFollowupStep =
  | { status: 'ok' | 'already_complete' }
  | { status: 'failed'; error: string };

export interface MondayHelperRepairFollowupResult {
  integrationId: string;
  backfill: MondayHelperRepairFollowupStep;
  webhooks: MondayHelperRepairFollowupStep;
}

function mondayHelperRepairError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

export async function runMondayHelperRepairFollowups(input: {
  followups: MondayHelperRepairFollowupState[];
  enqueueBackfill(integrationId: string): Promise<void>;
  reconcileWebhooks(integrationId: string): Promise<void>;
  markFollowup(
    integrationId: string,
    patch: { backfillQueued?: boolean; webhooksReconciled?: boolean },
  ): Promise<void>;
}): Promise<MondayHelperRepairFollowupResult[]> {
  const results: MondayHelperRepairFollowupResult[] = [];
  for (const followup of input.followups) {
    let backfill: MondayHelperRepairFollowupStep = { status: 'already_complete' };
    if (!followup.backfillQueued) {
      try {
        await input.enqueueBackfill(followup.integrationId);
        await input.markFollowup(followup.integrationId, { backfillQueued: true });
        backfill = { status: 'ok' };
      } catch (error) {
        backfill = { status: 'failed', error: mondayHelperRepairError(error) };
      }
    }

    let webhooks: MondayHelperRepairFollowupStep = { status: 'already_complete' };
    if (!followup.webhooksReconciled) {
      try {
        await input.reconcileWebhooks(followup.integrationId);
        await input.markFollowup(followup.integrationId, { webhooksReconciled: true });
        webhooks = { status: 'ok' };
      } catch (error) {
        webhooks = { status: 'failed', error: mondayHelperRepairError(error) };
      }
    }
    results.push({ integrationId: followup.integrationId, backfill, webhooks });
  }
  return results;
}
