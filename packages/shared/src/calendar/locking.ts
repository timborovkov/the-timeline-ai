export function calendarEventMutationLockKey(teamId: string, eventId: string): string {
  return `calendar-event-mutation:${teamId}:${eventId}`;
}
