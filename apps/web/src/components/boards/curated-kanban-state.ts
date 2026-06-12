export type CuratedKanbanSaveState = 'idle' | 'saving' | 'saved';

export function curatedKanbanSaveState(
  savingCount: number,
  batchFailed: boolean,
): CuratedKanbanSaveState {
  if (savingCount > 0) return 'saving';
  return batchFailed ? 'idle' : 'saved';
}
