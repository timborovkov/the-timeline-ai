import { z } from 'zod';

import { OBJECT_TYPES } from '#src/objects/types.js';
import { TASK_CATEGORIES } from '#src/task-categories/types.js';

const boundedCount = z.number().int().min(0).max(1_000_000_000);
const boundedIdentifier = z.string().min(1).max(160);

export const PUBLIC_ATTRIBUTION_SOURCES = [
  'google',
  'linkedin',
  'reddit',
  'github',
  'product_hunt',
  'newsletter',
  'x',
  'facebook',
  'instagram',
  'youtube',
  'tiktok',
  'partner',
  'other',
] as const;
export const PUBLIC_ATTRIBUTION_MEDIA = [
  'cpc',
  'paid_social',
  'social',
  'email',
  'referral',
  'organic',
  'creator',
  'partner',
  'other',
] as const;
export const PUBLIC_ATTRIBUTION_CAMPAIGNS = [
  'launch',
  'beta',
  'waitlist',
  'brand',
  'other',
] as const;

export type PublicAttributionSource = (typeof PUBLIC_ATTRIBUTION_SOURCES)[number];
export type PublicAttributionMedium = (typeof PUBLIC_ATTRIBUTION_MEDIA)[number];
export type PublicAttributionCampaign = (typeof PUBLIC_ATTRIBUTION_CAMPAIGNS)[number];

export const ANALYTICS_COUNT_BUCKETS = [
  'zero',
  'one',
  'two_to_five',
  'six_to_twenty',
  'twenty_one_plus',
] as const;
export const CAPTURE_DURATION_BUCKETS = ['under_1m', '1m_to_5m', '5m_to_15m', '15m_plus'] as const;

export const PUBLIC_ANALYTICS_SURFACES = [
  'home',
  'how_it_works',
  'integrations',
  'integration_slack',
  'integration_github',
  'integration_linear',
  'integration_google_drive',
  'integration_monday',
  'integration_sentry',
  'guide_search_slack_google_drive',
  'guide_weekly_engineering_updates',
  'guide_sentry_incidents',
  'solution_client_project_handoffs',
  'solution_weekly_project_updates',
  'solution_crm_context_team_activity',
  'help',
  'help_capture',
  'help_work',
  'help_documents',
  'help_boards',
  'help_integrations',
  'help_agents',
  'help_objects',
  'trust',
  'privacy',
  'terms',
  'cookies',
] as const;

export const APP_ANALYTICS_SURFACES = [
  'home',
  'timeline',
  'work',
  'tasks',
  'approvals',
  'boards',
  'board_detail',
  'objects',
  'object_detail',
  'documents',
  'document_detail',
  'meetings',
  'meeting_detail',
  'calendar',
  'chat',
  'search',
  'sources',
  'inbox',
  'digests',
  'personal_connections',
  'personal_mcp',
  'team_overview',
  'team_audit',
  'team_integrations',
  'team_jobs',
  'team_mcp',
  'team_share',
  'team_reconciliation',
  'team_slack',
  'team_telegram',
] as const;

export type PublicSurface = (typeof PUBLIC_ANALYTICS_SURFACES)[number];
export type AppSurface = (typeof APP_ANALYTICS_SURFACES)[number];

export type AnalyticsActor =
  | { kind: 'user'; userId: string; teamId?: string }
  | { kind: 'team'; teamId: string };

const analyticsActorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('user'),
      userId: boundedIdentifier,
      teamId: boundedIdentifier.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('team'), teamId: boundedIdentifier }).strict(),
]);

const PRODUCT_EVENT_SCHEMAS = {
  account_registered: z
    .object({
      source: z.enum(['credentials', 'github']),
      joinedViaInvite: z.boolean(),
      attributionSource: z.enum(PUBLIC_ATTRIBUTION_SOURCES).optional(),
      attributionMedium: z.enum(PUBLIC_ATTRIBUTION_MEDIA).optional(),
      attributionCampaign: z.enum(PUBLIC_ATTRIBUTION_CAMPAIGNS).optional(),
    })
    .strict(),
  authentication_succeeded: z.object({ method: z.enum(['credentials', 'github']) }).strict(),
  team_created: z
    .object({ source: z.enum(['signup', 'oauth', 'manual', 'invite_fallback']) })
    .strict(),
  invite_accepted: z
    .object({
      role: z.enum(['admin', 'member']),
      source: z.enum(['signup', 'accept_invite']),
    })
    .strict(),
  capture_created: z
    .object({
      captureType: z.enum(['text', 'audio']),
      visibility: z.enum(['team', 'private']),
      durationBucket: z.enum(CAPTURE_DURATION_BUCKETS).optional(),
    })
    .strict(),
  integration_connected: z
    .object({
      provider: z.enum([
        'google_drive',
        'linear',
        'github',
        'monday',
        'slack',
        'sentry',
        'telegram',
        'mcp',
      ]),
    })
    .strict(),
  document_uploaded: z
    .object({
      sizeBucket: z.enum(['under_1mb', '1mb_to_10mb', '10mb_to_50mb', '50mb_plus']),
      contentType: z.enum(['pdf', 'word', 'spreadsheet', 'presentation', 'text', 'image', 'other']),
      visibility: z.enum(['team', 'private', 'specific_users']),
    })
    .strict(),
  document_action_completed: z
    .object({
      action: z.enum(['folder_create', 'folder_delete', 'document_rename', 'document_delete']),
    })
    .strict(),
  meeting_bot_scheduled: z
    .object({
      platform: z.enum(['meet', 'teams', 'zoom']),
      visibility: z.enum(['team', 'private', 'specific_users']),
    })
    .strict(),
  meeting_finalized: z
    .object({
      durationBucket: z.enum(['under_15m', '15m_to_30m', '30m_to_60m', '60m_plus']),
      actionItemCountBucket: z.enum(ANALYTICS_COUNT_BUCKETS),
    })
    .strict(),
  chat_message_sent: z
    .object({ persisted: z.boolean(), messageCountBucket: z.enum(ANALYTICS_COUNT_BUCKETS) })
    .strict(),
  agent_answer_generated: z
    .object({
      persisted: z.boolean(),
      modelId: boundedIdentifier,
      requestedModelId: boundedIdentifier.optional(),
      fallbackModelIds: z.array(boundedIdentifier).max(10).optional(),
      toolCountBucket: z.enum(ANALYTICS_COUNT_BUCKETS),
      promptVersion: boundedIdentifier,
      inputTokens: boundedCount.optional(),
      outputTokens: boundedCount.optional(),
      totalTokens: boundedCount.optional(),
    })
    .strict(),
  board_action_completed: z
    .object({
      action: z.enum(['create', 'update', 'delete', 'item_add', 'item_update', 'item_remove']),
    })
    .strict(),
  calendar_action_completed: z
    .object({
      action: z.enum(['create', 'update', 'delete', 'subscription_create', 'subscription_delete']),
    })
    .strict(),
  team_management_action_completed: z
    .object({
      action: z.enum([
        'invite_create',
        'invite_revoke',
        'member_role_change',
        'member_remove',
        'settings_update',
      ]),
    })
    .strict(),
  integration_management_action_completed: z
    .object({
      action: z.enum([
        'connect',
        'activate',
        'deactivate',
        'disconnect',
        'sync_request',
        'webhook_create',
        'webhook_rotate',
        'webhook_revoke',
        'mcp_server_add',
        'mcp_server_remove',
        'mcp_key_mint',
        'mcp_key_revoke',
      ]),
      kind: z.enum(['native', 'custom_ingest_webhook', 'mcp_inbound', 'mcp_outbound']),
      provider: z
        .enum(['google_drive', 'linear', 'github', 'monday', 'slack', 'sentry', 'telegram', 'mcp'])
        .optional(),
    })
    .strict(),
  search_performed: z
    .object({
      surface: z.enum(['global', 'objects', 'board_add']),
      hasFilters: z.boolean(),
      resultCountBucket: z.enum(['zero', 'one_to_ten', 'eleven_to_fifty', 'fifty_one_plus']),
    })
    .strict(),
  object_created: z
    .object({
      objectType: z.enum([...OBJECT_TYPES, 'link']),
      hasParent: z.boolean(),
    })
    .strict(),
  object_action_completed: z
    .object({ action: z.enum(['update', 'archive', 'unarchive', 'bulk_archive']) })
    .strict(),
  task_category_changed: z
    .object({
      mode: z.enum(['automatic', 'manual']),
      category: z.enum(TASK_CATEGORIES).optional(),
    })
    .strict(),
  task_project_changed: z.object({ hasProject: z.boolean() }).strict(),
  approval_decision_submitted: z
    .object({
      decision: z.enum(['accepted', 'rejected', 'revised']),
      itemCountBucket: z.enum(ANALYTICS_COUNT_BUCKETS),
      isBulk: z.boolean(),
    })
    .strict(),
  onboarding_step_completed: z
    .object({
      step: z.enum([
        'first_note',
        'invite_teammate',
        'telegram',
        'slack',
        'email_forwarding',
        'first_document',
        'first_ask',
        'first_meeting',
        'review_proposal',
        'daily_digest',
        'first_integration',
      ]),
      source: z.enum(['manual', 'automatic']),
    })
    .strict(),
  team_export_requested: z.object({}).strict(),
} as const;

export type ProductEventName = keyof typeof PRODUCT_EVENT_SCHEMAS;
export type ProductEventPayloads = {
  [Name in ProductEventName]: z.infer<(typeof PRODUCT_EVENT_SCHEMAS)[Name]>;
};

export interface ProductEventMetadata {
  owner: 'product';
  purpose: string;
  trigger: string;
  dataClass: 'pseudonymous_product_usage';
  legalBasis: 'legitimate_interests_review_pending';
  retention: '90_days_target_provider_setting_unverified';
}

function metadata(purpose: string, trigger: string): ProductEventMetadata {
  return {
    owner: 'product',
    purpose,
    trigger,
    dataClass: 'pseudonymous_product_usage',
    legalBasis: 'legitimate_interests_review_pending',
    retention: '90_days_target_provider_setting_unverified',
  };
}

export const PRODUCT_EVENT_METADATA: Record<ProductEventName, ProductEventMetadata> = {
  account_registered: metadata('Measure account acquisition.', 'An account is created.'),
  authentication_succeeded: metadata(
    'Measure successful authentication.',
    'Auth.js completes a sign-in.',
  ),
  team_created: metadata('Measure workspace activation.', 'A user creates a team.'),
  invite_accepted: metadata(
    'Measure collaborative adoption.',
    'A user joins a team through an invite.',
  ),
  capture_created: metadata(
    'Measure capture feature adoption.',
    'A user creates a text or audio capture.',
  ),
  integration_connected: metadata(
    'Measure integration adoption.',
    'A team connects a supported integration.',
  ),
  document_uploaded: metadata(
    'Measure document feature adoption.',
    'A document upload is finalized and queued.',
  ),
  document_action_completed: metadata(
    'Measure document-drive workflow adoption.',
    'A folder or document mutation succeeds.',
  ),
  meeting_bot_scheduled: metadata(
    'Measure meeting capture adoption.',
    'A user schedules a consent-gated meeting bot.',
  ),
  meeting_finalized: metadata(
    'Measure completed meeting processing.',
    'A worker finalizes a meeting transcript.',
  ),
  chat_message_sent: metadata(
    'Measure agent entry usage.',
    'The chat endpoint accepts a valid user message.',
  ),
  agent_answer_generated: metadata(
    'Measure agent value and cost drivers.',
    'The agent finishes a streamed answer.',
  ),
  board_action_completed: metadata(
    'Measure board workflow adoption.',
    'A board or board-item mutation succeeds.',
  ),
  calendar_action_completed: metadata(
    'Measure calendar workflow adoption.',
    'A calendar event or subscription mutation succeeds.',
  ),
  team_management_action_completed: metadata(
    'Measure collaborative administration.',
    'A team-management mutation succeeds.',
  ),
  integration_management_action_completed: metadata(
    'Measure integration lifecycle use.',
    'A native, webhook, or MCP management action succeeds.',
  ),
  search_performed: metadata(
    'Measure content-free search adoption.',
    'A server-side search returns a result set.',
  ),
  object_created: metadata(
    'Measure workspace-object adoption.',
    'A user manually creates an object.',
  ),
  object_action_completed: metadata(
    'Measure workspace-object lifecycle adoption.',
    'A content-free object lifecycle mutation changes canonical state.',
  ),
  task_category_changed: metadata(
    'Measure task-classification use.',
    'A teammate changes task categorization.',
  ),
  task_project_changed: metadata(
    'Measure task-project organization.',
    'A teammate changes a task project.',
  ),
  approval_decision_submitted: metadata(
    'Measure review workflow adoption.',
    'A reviewer submits an approval decision.',
  ),
  onboarding_step_completed: metadata(
    'Measure onboarding progression.',
    'A user completes an onboarding step.',
  ),
  team_export_requested: metadata('Measure export feature use.', 'An admin queues a team export.'),
};

export function validateAnalyticsActor(actor: unknown): AnalyticsActor {
  const parsed = analyticsActorSchema.parse(actor);
  if (parsed.kind === 'team') return parsed;
  return parsed.teamId === undefined
    ? { kind: 'user', userId: parsed.userId }
    : { kind: 'user', userId: parsed.userId, teamId: parsed.teamId };
}

export function validateProductEventProperties<Name extends ProductEventName>(
  event: Name,
  properties: unknown,
): ProductEventPayloads[Name] {
  return PRODUCT_EVENT_SCHEMAS[event].parse(properties) as ProductEventPayloads[Name];
}

export function validatePersonlessSurface(stream: 'public', surface: unknown): PublicSurface;
export function validatePersonlessSurface(stream: 'app', surface: unknown): AppSurface;
export function validatePersonlessSurface(
  stream: 'public' | 'app',
  surface: unknown,
): PublicSurface | AppSurface {
  return stream === 'public'
    ? z.enum(PUBLIC_ANALYTICS_SURFACES).parse(surface)
    : z.enum(APP_ANALYTICS_SURFACES).parse(surface);
}

export function bucketDocumentSize(
  byteSize: number,
): ProductEventPayloads['document_uploaded']['sizeBucket'] {
  if (byteSize < 1_000_000) return 'under_1mb';
  if (byteSize < 10_000_000) return '1mb_to_10mb';
  if (byteSize < 50_000_000) return '10mb_to_50mb';
  return '50mb_plus';
}

export function classifyDocumentContentType(
  contentType: string,
): ProductEventPayloads['document_uploaded']['contentType'] {
  const normalized = contentType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  if (normalized === 'application/pdf') return 'pdf';
  if (normalized.includes('word') || normalized.includes('officedocument.wordprocessingml')) {
    return 'word';
  }
  if (
    normalized.includes('spreadsheet') ||
    normalized.includes('excel') ||
    normalized === 'text/csv'
  ) {
    return 'spreadsheet';
  }
  if (normalized.includes('presentation') || normalized.includes('powerpoint')) {
    return 'presentation';
  }
  if (normalized.startsWith('text/')) return 'text';
  if (normalized.startsWith('image/')) return 'image';
  return 'other';
}

export function bucketMeetingDuration(
  minutes: number,
): ProductEventPayloads['meeting_finalized']['durationBucket'] {
  if (minutes < 15) return 'under_15m';
  if (minutes < 30) return '15m_to_30m';
  if (minutes < 60) return '30m_to_60m';
  return '60m_plus';
}

export function bucketCaptureDuration(
  seconds: number,
): ProductEventPayloads['capture_created']['durationBucket'] {
  if (seconds < 60) return 'under_1m';
  if (seconds < 300) return '1m_to_5m';
  if (seconds < 900) return '5m_to_15m';
  return '15m_plus';
}

export function bucketAnalyticsCount(count: number): (typeof ANALYTICS_COUNT_BUCKETS)[number] {
  if (count < 1) return 'zero';
  if (count === 1) return 'one';
  if (count <= 5) return 'two_to_five';
  if (count <= 20) return 'six_to_twenty';
  return 'twenty_one_plus';
}

export function bucketSearchResultCount(
  count: number,
): ProductEventPayloads['search_performed']['resultCountBucket'] {
  if (count < 1) return 'zero';
  if (count <= 10) return 'one_to_ten';
  if (count <= 50) return 'eleven_to_fifty';
  return 'fifty_one_plus';
}
