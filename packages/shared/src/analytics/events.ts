interface EventMetadata {
  owner: 'product';
  trigger: string;
  pii: 'none';
  retention: string;
}

export interface ProductEventPayloads {
  team_created: {
    teamId: string;
    userId: string;
    source: 'signup' | 'oauth';
  };
  invite_accepted: {
    teamId: string;
    userId: string;
    role: 'admin' | 'member';
    source: 'signup' | 'accept_invite';
  };
  capture_created: {
    teamId: string;
    userId: string;
    rawEventId: string;
    captureType: 'text' | 'audio';
    visibility: 'team' | 'private';
    durationSec?: number;
  };
  integration_connected: {
    teamId: string;
    userId: string;
    integrationId?: string;
    providerConnectionId?: string;
    provider:
      | 'google_drive'
      | 'linear'
      | 'github'
      | 'monday'
      | 'slack'
      | 'sentry'
      | 'telegram'
      | 'mcp';
  };
  document_uploaded: {
    teamId: string;
    userId: string;
    documentId: string;
    versionId: string;
    byteSize: number;
    contentType: string;
    visibility: 'team' | 'private' | 'specific_users';
  };
  meeting_bot_scheduled: {
    teamId: string;
    userId: string;
    meetingId: string;
    platform: 'meet' | 'teams' | 'zoom';
    visibility: 'team' | 'private' | 'specific_users';
  };
  meeting_finalized: {
    teamId: string;
    userId: string | null;
    meetingId: string;
    minutes: number;
    actionItems: number;
  };
  chat_message_sent: {
    teamId: string;
    userId: string;
    sessionId: string | null;
    persisted: boolean;
    messageCount: number;
  };
  agent_answer_generated: {
    teamId: string;
    userId: string;
    sessionId: string | null;
    persisted: boolean;
    modelId: string;
    requestedModelId?: string;
    fallbackModelIds?: string[];
    toolCount: number;
    promptVersion: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  object_created: {
    teamId: string;
    userId: string;
    objectId: string;
    objectType: string;
    hasParent: boolean;
  };
  onboarding_step_completed: {
    teamId: string;
    userId: string;
    step:
      | 'first_note'
      | 'telegram'
      | 'slack'
      | 'email_forwarding'
      | 'first_document'
      | 'first_integration';
    source: 'manual' | 'automatic';
  };
  team_export_requested: {
    teamId: string;
    userId: string;
    exportId: string;
  };
}

export type ProductEventName = keyof ProductEventPayloads;

export const PRODUCT_EVENT_METADATA: Record<ProductEventName, EventMetadata> = {
  team_created: {
    owner: 'product',
    trigger: 'A user creates a default team during signup or OAuth onboarding.',
    pii: 'none',
    retention: 'PostHog project default retention.',
  },
  invite_accepted: {
    owner: 'product',
    trigger: 'A user joins a team through an invite.',
    pii: 'none',
    retention: 'PostHog project default retention.',
  },
  capture_created: {
    owner: 'product',
    trigger: 'A user creates a text or audio timeline capture.',
    pii: 'none',
    retention: 'PostHog project default retention.',
  },
  integration_connected: {
    owner: 'product',
    trigger: 'A team connects a first-party or MCP integration.',
    pii: 'none',
    retention: 'PostHog project default retention.',
  },
  document_uploaded: {
    owner: 'product',
    trigger: 'A document version upload is finalized and queued for extraction.',
    pii: 'none',
    retention: 'PostHog project default retention.',
  },
  meeting_bot_scheduled: {
    owner: 'product',
    trigger: 'A user schedules a consent-gated silent meeting bot.',
    pii: 'none',
    retention: 'PostHog project default retention.',
  },
  meeting_finalized: {
    owner: 'product',
    trigger: 'The worker finalizes a meeting transcript into a timeline event.',
    pii: 'none',
    retention: 'PostHog project default retention.',
  },
  chat_message_sent: {
    owner: 'product',
    trigger: 'The chat endpoint accepts a valid user message request.',
    pii: 'none',
    retention: 'PostHog project default retention.',
  },
  agent_answer_generated: {
    owner: 'product',
    trigger: 'The agent finishes a streamed answer.',
    pii: 'none',
    retention: 'PostHog project default retention.',
  },
  object_created: {
    owner: 'product',
    trigger: 'A user manually creates a workspace object.',
    pii: 'none',
    retention: 'PostHog project default retention.',
  },
  onboarding_step_completed: {
    owner: 'product',
    trigger: 'A user manually or automatically completes an onboarding step.',
    pii: 'none',
    retention: 'PostHog project default retention.',
  },
  team_export_requested: {
    owner: 'product',
    trigger: 'An admin queues a full team export.',
    pii: 'none',
    retention: 'PostHog project default retention.',
  },
};

export const FEATURE_FLAGS = {
  onboardingChecklistV2: {
    key: 'onboarding-checklist-v2',
    owner: 'product',
    cleanup: 'Remove after the Phase 13 onboarding checklist experiment is resolved.',
  },
} as const;

export type FeatureFlagName = keyof typeof FEATURE_FLAGS;
export type FeatureFlagKey = (typeof FEATURE_FLAGS)[FeatureFlagName]['key'];
