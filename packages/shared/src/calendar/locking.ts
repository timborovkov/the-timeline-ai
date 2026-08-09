export type CalendarRecurrenceEditMode = 'single' | 'series' | 'this_and_future';

export function calendarEventMutationLockKey(teamId: string, eventId: string): string {
  return `calendar-event-mutation:${teamId}:${eventId}`;
}

export function calendarEventMutationTargetId(
  eventId: string,
  recurringParentId: string | null,
  recurrenceEditMode?: CalendarRecurrenceEditMode,
): string {
  const effectiveMode = recurrenceEditMode ?? (recurringParentId ? 'single' : 'series');
  return recurringParentId && effectiveMode !== 'single' ? recurringParentId : eventId;
}
