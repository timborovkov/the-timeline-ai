import { diffDriveText } from '#src/integrations/google-drive-diff.js';

const PROJECT_FIELD =
  /^(owner|assignee|status|deadline|due date|launch date|budget|approved budget):\s*(.+)$/i;

/**
 * A model's relevance veto must not discard a witnessed project-state change.
 * Only paired, unambiguous whole-line fields qualify; context mentioning a
 * budget, an unchanged field, and cosmetic value edits do not override it.
 */
export function changedDriveProjectFields(hunks: readonly string[]): string[] {
  const previous = new Map<string, string[]>();
  const next = new Map<string, string[]>();
  for (const hunk of hunks) {
    const removed = hunk.startsWith('- ');
    const match = PROJECT_FIELD.exec(removed ? hunk.slice(2) : hunk);
    const label = match?.[1];
    const matchedValue = match?.[2];
    if (!label || !matchedValue) continue;
    const key = label.toLowerCase();
    const value = matchedValue.trim();
    const fields = removed ? previous : next;
    fields.set(key, [...(fields.get(key) ?? []), value]);
  }
  const changed: string[] = [];
  for (const [field, oldValues] of previous) {
    const newValues = next.get(field);
    if (oldValues.length !== 1 || newValues?.length !== 1) continue;
    const oldValue = oldValues[0];
    const newValue = newValues[0];
    if (
      oldValue !== undefined &&
      newValue !== undefined &&
      diffDriveText(oldValue, newValue).changed
    ) {
      changed.push(field);
    }
  }
  return changed;
}
