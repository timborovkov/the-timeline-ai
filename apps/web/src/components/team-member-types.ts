export interface TeamMemberInfo {
  id: string;
  name: string | null;
  email: string | null;
}

export interface TeamMemberRow {
  userId: string;
  role: string;
}

export interface TeamInviteRow {
  id: string;
  email: string;
  role: string;
  token: string;
  expiresAt: Date;
  lastSentAt: Date | null;
  sendStatus: string;
  sendError: string | null;
  invitedByUserId: string;
}

export interface RemovedTeamMemberRow {
  userId: string;
  role: string;
  removedAt: Date | null;
}

export type TeamMemberMap = Map<string, TeamMemberInfo>;
