function payloadObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function suggestionTargetsObject(
  item: {
    targetId: string | null;
    targetKind: string;
    proposedPayload: unknown;
  },
  objectId: string,
  options: { boardItemIds?: ReadonlySet<string> } = {},
): boolean {
  if (item.targetId === objectId) return true;
  const payload = payloadObject(item.proposedPayload);
  if (item.targetKind === 'board_membership') return payload.entityId === objectId;
  if (item.targetKind !== 'board_item_update') return false;
  if (payload.entityId === objectId) return true;
  return typeof payload.boardItemId === 'string' && options.boardItemIds?.has(payload.boardItemId)
    ? true
    : false;
}
