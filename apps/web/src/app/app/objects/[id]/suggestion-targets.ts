function payloadObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

interface SuggestionTargetItem {
  targetId: string | null;
  targetKind: string;
  proposedPayload: unknown;
  resultId?: string | null;
}

function normalizedLocalRef(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

function localRefTargetsObject(
  ref: unknown,
  objectId: string,
  items: readonly SuggestionTargetItem[],
): boolean {
  const normalizedRef = normalizedLocalRef(ref);
  if (!normalizedRef) return false;
  return items.some((item) => {
    const payload = payloadObject(item.proposedPayload);
    return (
      normalizedLocalRef(payload.localRef) === normalizedRef &&
      (item.targetId === objectId || item.resultId === objectId)
    );
  });
}

export function suggestionTargetsObject(
  item: SuggestionTargetItem,
  objectId: string,
  options: {
    boardItemIds?: ReadonlySet<string>;
    siblingItems?: readonly SuggestionTargetItem[];
  } = {},
): boolean {
  if (item.targetId === objectId) return true;
  const payload = payloadObject(item.proposedPayload);
  if (item.targetKind === 'object_relationship') {
    return (
      payload.fromEntityId === objectId ||
      payload.toEntityId === objectId ||
      localRefTargetsObject(payload.fromRef, objectId, options.siblingItems ?? []) ||
      localRefTargetsObject(payload.toRef, objectId, options.siblingItems ?? [])
    );
  }
  if (item.targetKind === 'board_membership') return payload.entityId === objectId;
  if (item.targetKind !== 'board_item_update') return false;
  if (payload.entityId === objectId) return true;
  return typeof payload.boardItemId === 'string' && options.boardItemIds?.has(payload.boardItemId)
    ? true
    : false;
}
