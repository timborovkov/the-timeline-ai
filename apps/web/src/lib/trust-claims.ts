import { TIMELINE_MODELS } from '@timeline/shared/llm';

/**
 * One code-owned source for the model routes shown on the human Trust page and
 * emitted in llms-full.txt. A model pin change must update public registry
 * dates in the same change, but it cannot silently make the two surfaces drift.
 */
export const TRUST_AI_ROUTES = [
  {
    job: 'Generation, extraction, summaries, and agent answers',
    model: `${TIMELINE_MODELS.agent.id} + ${TIMELINE_MODELS.structuredFallback.id}`,
  },
  { job: 'Images, files, audio, and video text extraction', model: TIMELINE_MODELS.vision.id },
  { job: 'Semantic search vectors', model: TIMELINE_MODELS.embedding.id },
  { job: 'Speech-to-text', model: TIMELINE_MODELS.transcription.id },
] as const;

export const TRUST_AI_MODEL_ITEMS = TRUST_AI_ROUTES.map((route) => `${route.job}: ${route.model}.`);

export const TRUST_AI_PRIVACY_SUMMARY =
  "Hosted Timeline sends necessary feature input through OpenRouter. Hosted AI may be enabled only after an operator confirms a zero-data-retention guardrail covering every model group Timeline uses is bound to the production key and content logging and sharing are off. Chat, media, and embedding requests also carry no-collection and ZDR filters; the live canary checks that the speech model remains in OpenRouter's ZDR registry. OpenRouter and the selected endpoint process content transiently; non-content usage metadata may still be retained.";
