export type BoardLayout = 'kanban' | 'table' | 'list';

export function boardViewHref(
  boardId: string,
  view: BoardLayout,
  itemId: string | null,
  extraParams: Record<string, string> = {},
): string {
  const params = new URLSearchParams({ ...extraParams, view });
  if (itemId) params.set('item', itemId);
  return `/app/boards/${boardId}?${params.toString()}`;
}
