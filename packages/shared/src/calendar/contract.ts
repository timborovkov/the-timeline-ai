export const CALENDAR_AVAILABILITIES = ['busy', 'free', 'tentative'] as const;
export type CalendarShowAs = (typeof CALENDAR_AVAILABILITIES)[number];

export const RECURRENCE_EDIT_SCOPES = ['single', 'this_and_future', 'series'] as const;
export type CalendarRecurrenceEditMode = (typeof RECURRENCE_EDIT_SCOPES)[number];
