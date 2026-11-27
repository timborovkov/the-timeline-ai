export const EVENT_VISIBILITIES = ['private', 'team', 'specific_users'] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export const FULL_MEMBER_ROLES = ['owner', 'admin', 'member'] as const;
export type TeamRole = (typeof FULL_MEMBER_ROLES)[number];

export function isFullMemberRole(role: string | null | undefined): role is TeamRole {
  return FULL_MEMBER_ROLES.some((fullRole) => fullRole === role);
}
