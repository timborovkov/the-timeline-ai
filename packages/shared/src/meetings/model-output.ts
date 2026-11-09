export function normalizeMeetingSummaryOutput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  return { ...row, action_items: row.action_items ?? row.actionItems };
}
