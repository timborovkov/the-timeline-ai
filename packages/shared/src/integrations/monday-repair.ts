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
