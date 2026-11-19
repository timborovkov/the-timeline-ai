export function notificationHref(notification: {
  kind: string;
  entityId: string | null;
  agentSuggestionId?: string | null;
  payload?: Record<string, unknown> | null;
}): string {
  if (
    notification.kind === 'calendar_reminder' &&
    typeof notification.payload?.event_id === 'string'
  ) {
    const params = new URLSearchParams({ event: notification.payload.event_id });
    if (typeof notification.payload.start_at === 'string')
      params.set('date', notification.payload.start_at.slice(0, 10));
    return `/app/calendar?${params.toString()}`;
  }
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
