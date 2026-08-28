import {
  TIMELINE_AI_PRIVACY_POLICY_VERSION,
  TIMELINE_MODELS,
  type ModelPrivacyMode,
  type RetainedNoTrainingDisclosureSource,
  type TimelineModelConfig,
  type TimelineModelRole,
} from '@timeline/shared/llm';

export const TRUST_AI_PRIVACY_LABELS = {
  zdr_required: 'ZDR required',
  retained_no_training_exception: 'Retained, no-training quality exception',
} as const satisfies Record<ModelPrivacyMode, string>;

type PublicTranscriptionModel = Pick<
  TimelineModelConfig,
  'id' | 'privacyMode' | 'retainedNoTrainingDisclosure'
>;

export interface PublicTranscriptionPrivacyClaims {
  model: string;
  privacyMode: ModelPrivacyMode;
  privacyLabel: string;
  routeSelection: string;
  privacySummary: string;
  privacyZdrRoleList: string;
  trustSignalValue: string;
  trustSignalDetail: string;
  trustIntro: string;
  trustDataPath: string;
  trustDetail: string;
  trustChecklist: string;
  privacyDetail: string;
  privacyProviderPurpose: string;
  privacyRetentionDetail: string;
  termsDetail: string;
  retentionSources: readonly RetainedNoTrainingDisclosureSource[];
}

/**
 * Generates every public transcription statement from the code-owned model
 * classification. Retained routes must carry their own evidence metadata;
 * ZDR routes reject that metadata so an approved migration cannot keep stale
 * provider-retention copy.
 */
export function buildPublicTranscriptionPrivacyClaims(
  model: PublicTranscriptionModel,
): PublicTranscriptionPrivacyClaims {
  if (model.privacyMode === 'zdr_required') {
    if (model.retainedNoTrainingDisclosure) {
      throw new Error(
        `ZDR transcription model ${model.id} must not carry retained-route disclosure`,
      );
    }

    return {
      model: model.id,
      privacyMode: model.privacyMode,
      privacyLabel: TRUST_AI_PRIVACY_LABELS[model.privacyMode],
      routeSelection:
        'Quality-approved speech-to-text with a required ZDR route and no weaker-retention fallback.',
      privacySummary: `Non-meeting voice transcription uses ${model.id} after passing the documented broad-multilingual quality gate. It requires an eligible ZDR endpoint and fails closed instead of using a weaker-retention route.`,
      privacyZdrRoleList:
        'generation, extraction, summarization, media text extraction, embeddings, and non-meeting voice transcription',
      trustSignalValue: 'ZDR for every AI role',
      trustSignalDetail:
        'Every code-owned AI role, including voice-note transcription, requires eligible ZDR routing and fails closed.',
      trustIntro:
        'Core AI roles, including non-meeting voice transcription, require zero-data-retention routes.',
      trustDataPath:
        'Only the content needed for a feature leaves Timeline. Every AI role requires an eligible ZDR route and stops rather than request weaker retention.',
      trustDetail: `Voice-note transcription uses ${model.id} after passing the documented broad-multilingual quality gate. It requires an eligible ZDR endpoint and cannot fall back to weaker retention.`,
      trustChecklist: 'Voice-note transcription is pinned to a quality-approved ZDR route',
      privacyDetail: `Non-meeting voice-note transcription uses ${model.id} after passing the documented broad-multilingual quality gate. It requires an eligible ZDR endpoint, carries the supported no-collection and cache-disable controls, and fails closed instead of using weaker retention.`,
      privacyProviderPurpose:
        'Zero-data-retention-required routing for generation, extraction, media processing, embeddings, and non-meeting voice-note transcription; and non-content usage metadata.',
      privacyRetentionDetail: `${model.id} is classified as ZDR required. Timeline requires an eligible zero-data-retention endpoint and fails rather than use a weaker-retention transcription route.`,
      termsDetail: `Non-meeting voice transcription uses ${model.id} as a quality-approved ZDR route after passing the documented broad-multilingual quality gate. It may not downgrade to weaker retention during an outage.`,
      retentionSources: [],
    };
  }

  const disclosure = model.retainedNoTrainingDisclosure;
  if (!disclosure) {
    throw new Error(
      `Retained transcription model ${model.id} requires provider-specific public disclosure`,
    );
  }
  const retentionDisclosure = `${disclosure.openRouter.label} ${disclosure.openRouter.statement}; ${disclosure.upstream.label} ${disclosure.upstream.statement}.`;

  return {
    model: model.id,
    privacyMode: model.privacyMode,
    privacyLabel: TRUST_AI_PRIVACY_LABELS[model.privacyMode],
    routeSelection:
      'Quality baseline while multilingual ZDR candidates are evaluated against a non-inferiority gate.',
    privacySummary: `Non-meeting voice transcription currently uses ${model.id} as a disclosed quality exception while multilingual ZDR candidates are evaluated. ${retentionDisclosure}`,
    privacyZdrRoleList:
      'generation, extraction, summarization, media text extraction, and embeddings',
    trustSignalValue: 'ZDR by role',
    trustSignalDetail:
      'Core AI roles fail closed on ZDR; voice transcription is a disclosed quality exception.',
    trustIntro:
      'Core AI roles require zero-data-retention routes. Non-meeting voice transcription is currently a retained, no-training quality exception, published below instead of hidden behind a blanket claim.',
    trustDataPath:
      'Only the content needed for a feature leaves Timeline. ZDR-required roles stop rather than request a weaker route. Voice-note transcription remains a clearly disclosed retained, no-training quality exception while alternatives are tested.',
    trustDetail: `Voice-note transcription currently uses ${model.id} while multilingual ZDR candidates face a strict quality gate. ${retentionDisclosure} This does not weaken ZDR requirements for any other role.`,
    trustChecklist: 'The voice-transcription retention exception is explicit and quality-gated',
    privacyDetail: `Non-meeting voice-note transcription currently uses ${model.id} as a quality-preserving exception. ${retentionDisclosure} Timeline will move this role to ZDR only if a reproducible broad-multilingual evaluation shows no material quality, reliability, format, or latency regression. This exception does not permit any ZDR-required role to downgrade during an outage.`,
    privacyProviderPurpose:
      'Zero-data-retention-required routing for generation, extraction, media processing, and embeddings; a disclosed retained, no-training exception for non-meeting voice-note transcription; and non-content usage metadata.',
    privacyRetentionDetail: `The current quality exception uses ${model.id}. ${retentionDisclosure}`,
    termsDetail: `Non-meeting voice transcription currently uses ${model.id} as the retained, no-training quality exception described in the Privacy Policy. A ZDR replacement will be adopted only after it passes the documented broad-multilingual quality gate.`,
    retentionSources: [disclosure.openRouter, disclosure.upstream],
  };
}

export const PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS = buildPublicTranscriptionPrivacyClaims(
  TIMELINE_MODELS.transcription,
);

interface TrustAiRouteDefinition {
  job: string;
  roles: readonly [TimelineModelRole, ...TimelineModelRole[]];
  selection: string;
}

function projectTrustAiRoute(definition: TrustAiRouteDefinition) {
  const models = definition.roles.map((role) => TIMELINE_MODELS[role]);
  const privacyModes = new Set(models.map((model) => model.privacyMode));
  if (privacyModes.size !== 1) {
    throw new Error(`Public AI route ${definition.job} combines incompatible privacy classes`);
  }

  return {
    ...definition,
    model: [...new Set(models.map((model) => model.id))].join(' + '),
    privacyMode: TIMELINE_MODELS[definition.roles[0]].privacyMode,
  };
}

/**
 * One code-owned source for the model routes shown on the human Trust page and
 * emitted in llms-full.txt. A model pin change must update public registry
 * dates in the same change, but it cannot silently make the two surfaces drift.
 */
const TRUST_AI_ROUTE_DEFINITIONS = [
  {
    job: 'Generation, extraction, summaries, classification, and agent answers',
    roles: ['extraction', 'structuredFallback', 'agent', 'summarization', 'taskCategorization'],
    selection: 'Quality-first long-context text models; weaker-retention fallback is prohibited.',
  },
  {
    job: 'Images, files, audio, and video text extraction',
    roles: ['vision'],
    selection: 'Multimodal extraction with a required ZDR route.',
  },
  {
    job: 'Semantic search vectors',
    roles: ['embedding'],
    selection: 'The established retrieval model; changing it would require a measured re-index.',
  },
  {
    job: 'Non-meeting voice-note speech-to-text',
    roles: ['transcription'],
    selection: PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.routeSelection,
  },
] as const satisfies readonly TrustAiRouteDefinition[];

export const TRUST_AI_ROUTES = TRUST_AI_ROUTE_DEFINITIONS.map(projectTrustAiRoute);

export const TRUST_AI_MODEL_ITEMS = TRUST_AI_ROUTES.map(
  (route) =>
    `${route.job}: ${route.model}. ${TRUST_AI_PRIVACY_LABELS[route.privacyMode]}. ${route.selection}`,
);

export const TRUST_AI_PRIVACY_SUMMARY = `Hosted Timeline sends necessary feature input through OpenRouter under privacy policy ${TIMELINE_AI_PRIVACY_POLICY_VERSION}. Text, multimodal, and embedding roles require eligible zero-data-retention endpoints and fail closed instead of falling back to weaker retention. Their supported requests carry no-collection, ZDR, and cache-disable controls. OpenRouter may choose among eligible ZDR upstreams. ${PUBLIC_TRANSCRIPTION_PRIVACY_CLAIMS.privacySummary} Timeline does not train or fine-tune models on Customer Content. Deployment policy also requires the matching key/account attestation with prompt logging, input/output sharing, Broadcast, and persistent response caching disabled; the deployed account evidence remains pending and must be captured before that configuration is described as verified.`;
