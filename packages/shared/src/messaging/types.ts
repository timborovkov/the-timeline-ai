import type { dailyDigests, messageDeliveries } from '@timeline/db';

export type MessageIntent =
  | 'team_invite'
  | 'support_request'
  | 'welcome'
  | 'email_verification'
  | 'daily_digest'
  | 'connection_attention'
  | 'billing_usage_alert';

export type MessageChannel = 'email' | 'in_app_digest' | 'slack' | 'telegram';

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

export type DailyDigestSectionTitle =
  | 'Highlights'
  | 'Status'
  | 'Completed'
  | 'In progress'
  | 'Decisions'
  | 'Risks'
  | 'Follow-ups'
  /** @deprecated Stored on older payloads; renderers remap this to Status. */
  | 'Product status';

export interface DailyDigestSection {
  title: DailyDigestSectionTitle;
  /** Narrative paragraph for this section. Preferred over `items` for new digests. */
  body?: string;
  /** Legacy bullet inventory. Rendered only when `body` is absent. */
  items: string[];
}

export interface DailyDigestActivity {
  newMoments: number;
  newProposals: number;
  pendingApprovals?: number;
  newTasks: number;
  completedTasks: number;
  newProjects: number;
  newObjectsByType: Record<string, number>;
}

export interface DailyDigestTask {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  href: string;
}

export interface DailyDigestCalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  href: string;
  repeating?: boolean;
  occurrenceCount?: number;
}

export interface DailyDigestObject {
  id: string;
  title: string;
  type: string;
  href: string;
}

export interface DailyDigestPayload {
  teamName: string;
  userName: string | null;
  timezone?: string;
  windowStart: string;
  windowEnd: string;
  summary: string;
  sections?: DailyDigestSection[];
  pendingApprovals: number;
  eventCount: number;
  momentCount?: number;
  activity?: DailyDigestActivity;
  sourceDistribution: Record<string, number>;
  objectChangesByType: Record<string, number>;
  newTeamMembers: { userId: string; label: string; createdAt: string }[];
  /** Tasks created during this digest window. */
  tasks: DailyDigestTask[];
  /** Tasks marked done or cancelled during this digest window. */
  completedTasks?: DailyDigestTask[];
  /** Non-task, non-decision objects created during this digest window. */
  newObjects?: DailyDigestObject[];
  /** Calendar events whose start falls inside this digest window. */
  windowCalendar?: DailyDigestCalendarEvent[];
  upcomingCalendar: DailyDigestCalendarEvent[];
  links: DailyDigestLink[];
}

export interface DailyDigestMessageInput {
  to: string;
  digestUrl: string;
  payload: DailyDigestPayload;
}

export interface ConnectionAttentionMessageInput {
  to: string;
  teamName: string;
  summary: string;
  actionUrl: string;
}

export type BillingUsageAlertKind =
  | 'spend_cap_50'
  | 'spend_cap_75'
  | 'spend_cap_90'
  | 'spend_cap_100'
  | 'free_near_limit'
  | 'free_exhausted';

export interface BillingUsageAlertMessageInput {
  to: string;
  ownerName: string | null;
  teamName: string;
  kind: BillingUsageAlertKind;
  periodYm: string;
  planName: string;
  detailLine: string;
  usageUrl: string;
  billingUrl: string;
}

export interface MessageInputByIntent {
  team_invite: TeamInviteMessageInput;
  support_request: SupportRequestMessageInput;
  welcome: WelcomeMessageInput;
  email_verification: EmailVerificationMessageInput;
  daily_digest: DailyDigestMessageInput;
  connection_attention: ConnectionAttentionMessageInput;
  billing_usage_alert: BillingUsageAlertMessageInput;
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
  /** When `ok` is false, false means retries cannot help (e.g. Postmark inactive). */
  retryable?: boolean;
  skipped?: boolean;
  skippedStatus?: MessageDeliveryStatus;
}
