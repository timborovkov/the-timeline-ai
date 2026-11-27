export const MEETING_PLATFORMS = ['meet', 'teams', 'zoom'] as const;
export type MeetingPlatform = (typeof MEETING_PLATFORMS)[number];
