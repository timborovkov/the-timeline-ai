export type BoardLayout = 'kanban' | 'list';

export function normalizeBoardView(value: string | string[] | null | undefined): BoardLayout {
  const v = Array.isArray(value) ? value[0] : value;
  return v === 'list' || v === 'table' ? 'list' : 'kanban';
}

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
