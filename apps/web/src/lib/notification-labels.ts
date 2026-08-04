const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  object_changed: 'Object updated',
  task_due: 'Task due',
  board_item_due: 'Board item due',
  task_overdue: 'Task overdue',
  follow_up_overdue: 'Follow-up overdue',
  mention: 'Mention',
  agent_suggestion: 'Suggestion ready',
  connection_attention: 'Connection needs attention',
};

export function notificationKindLabel(kind: string): string {
  return NOTIFICATION_KIND_LABELS[kind] ?? kind.replaceAll('_', ' ');
}
