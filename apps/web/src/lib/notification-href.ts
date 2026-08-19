export function notificationHref(notification: {
  kind: string;
  entityId: string | null;
  agentSuggestionId?: string | null;
  payload?: Record<string, unknown> | null;
}): string {
  if (notification.entityId) {
    const noteId = notification.payload?.note_id;
    if (notification.kind === 'mention' && typeof noteId === 'string' && noteId) {
      return `/app/objects/${notification.entityId}?comment=${noteId}#comment-${noteId}`;
    }
    return `/app/objects/${notification.entityId}`;
  }
  if (notification.agentSuggestionId) return '/app/approvals';
  return '/app/inbox';
}
