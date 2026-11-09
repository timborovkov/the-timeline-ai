import type { SyncSelection, SyncTarget } from '#src/integrations/types.js';

export function exactTargetSelections(
  selections: SyncSelection[],
  target: SyncTarget,
): SyncSelection[] {
  return selections.filter(
    (selection) =>
      selection.kind === target.resourceType && selection.externalId === target.externalId,
  );
}
