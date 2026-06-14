import type { dailyDigests, messageDeliveries } from '@timeline/db';

export type MessageIntent =
  | 'team_invite'
  | 'support_request'
  | 'welcome'
  | 'email_verification'
  | 'daily_digest';

export type MessageChannel = 'email' | 'in_app_digest';

export type MessageDeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface RenderedMessage {
  intent: MessageIntent;
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  previewText?: string;
  replyTo?: string;
  metadata?: Record<string, string>;
}

export interface TeamInviteMessageInput {
  to: string;
  inviterName: string;
  teamName: string;
  role: 'admin' | 'member';
  inviteUrl: string;
  expiresAt: Date;
}

export interface SupportRequestMessageInput {
  supportEmail: string;
  requestId: string;
  requestType: 'technical_support' | 'sales' | 'billing' | 'security' | 'other';
  name: string;
  email: string;
  message: string;
  currentPage: string | null;
  userId: string | null;
  teamId: string | null;
  teamName: string | null;
}

export interface WelcomeMessageInput {
  to: string;
  name: string | null;
  dashboardUrl: string;
  teamName: string;
}

export interface EmailVerificationMessageInput {
  to: string;
  verificationUrl: string;
  expiresAt: Date;
}

export interface DailyDigestLink {
  label: string;
  href: string;
}

export interface DailyDigestPayload {
  teamName: string;
  userName: string | null;
  windowStart: string;
  windowEnd: string;
  summary: string;
  pendingApprovals: number;
  eventCount: number;
  sourceDistribution: Record<string, number>;
  objectChangesByType: Record<string, number>;
  newTeamMembers: { userId: string; label: string; createdAt: string }[];
  tasks: { id: string; title: string; status: string; dueAt: string | null; href: string }[];
  upcomingCalendar: {
    id: string;
    title: string;
    startAt: string;
    endAt: string;
    href: string;
  }[];
  links: DailyDigestLink[];
}

export interface DailyDigestMessageInput {
  to: string;
  digestUrl: string;
  payload: DailyDigestPayload;
}

export interface MessageInputByIntent {
  team_invite: TeamInviteMessageInput;
  support_request: SupportRequestMessageInput;
  welcome: WelcomeMessageInput;
  email_verification: EmailVerificationMessageInput;
  daily_digest: DailyDigestMessageInput;
}

export type MessageInput<TIntent extends MessageIntent = MessageIntent> =
  MessageInputByIntent[TIntent];

export type MessageDeliveryRow = typeof messageDeliveries.$inferSelect;
export type DailyDigestRow = typeof dailyDigests.$inferSelect;

export interface SendMessageResult {
  ok: boolean;
  deliveryId?: string;
  providerMessageId?: string;
  error?: string;
  skipped?: boolean;
}
