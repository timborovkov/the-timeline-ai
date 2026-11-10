import { diffDriveText } from '#src/integrations/google-drive-diff.js';

const PROJECT_FIELD =
  /^(owner|assignee|status|deadline|due date|launch date|budget|approved budget):\s*(.+)$/i;

/**
 * A model's relevance veto must not discard a witnessed project-state change.
 * Only paired, unambiguous whole-line fields qualify; context mentioning a
 * budget, an unchanged field, and cosmetic value edits do not override it.
 */
function projectFields(text: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  for (const line of text.split('\n')) {
    const match = PROJECT_FIELD.exec(line);
    const label = match?.[1];
    const matchedValue = match?.[2];
    if (!label || !matchedValue) continue;
    const key = label.toLowerCase();
    fields.set(key, [...(fields.get(key) ?? []), matchedValue.trim()]);
  }
  return fields;
}

export function changedDriveProjectFields(previousText: string, nextText: string): string[] {
  const previous = projectFields(previousText);
  const next = projectFields(nextText);
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
