import { type queue } from '@timeline/shared';

const REMOTE_DEV_OVERRIDE = 'I_UNDERSTAND_THIS_SEEDS_KNOWN_DEV_CREDENTIALS';

export const DEMO_VECTOR_SOURCE_MINIMUMS = {
  rawEvents: 2500,
  facts: 20,
  documentChunks: 15,
  meetingChunks: 8,
} as const;

export interface DemoVectorRows {
  rawEvents: { id: string }[];
  facts: { id: string; rawEventId: string }[];
  documentChunks: { id: string; versionId: string }[];
  meetingChunks: { id: string }[];
}

export function assertDemoVectorIndexEnvironment(input: {
  nodeEnv: string | undefined;
  openRouterApiKey: string | undefined;
  qdrantUrl: string | undefined;
  allowDevSeed: string | undefined;
}): void {
  if (input.nodeEnv === 'production') {
    throw new Error('Refusing to index demo fixture vectors with NODE_ENV=production');
  }
  if (!input.openRouterApiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is required to create genuine demo embeddings; configure a development key and rerun pnpm demo:seed',
    );
  }
  if (!input.qdrantUrl) {
    throw new Error(
      'QDRANT_URL is required to index demo vectors; start local Qdrant or configure an acknowledged isolated development stack',
    );
  }
  let host: string;
  try {
    host = new URL(input.qdrantUrl).hostname.toLowerCase();
  } catch {
    throw new Error('QDRANT_URL must be a valid URL for demo vector indexing');
  }
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (!local && input.allowDevSeed !== REMOTE_DEV_OVERRIDE) {
    throw new Error(
      `Refusing to use non-local Qdrant host "${host}". Set ALLOW_DEV_SEED=${REMOTE_DEV_OVERRIDE} only for an isolated development stack.`,
    );
  }
}

export function assertExpectedDemoVectorSources(rows: DemoVectorRows): void {
  for (const [kind, minimum] of Object.entries(DEMO_VECTOR_SOURCE_MINIMUMS)) {
    const actual = rows[kind as keyof DemoVectorRows].length;
    if (actual < minimum) {
      throw new Error(
        `Demo vector source set is incomplete: ${kind} expected at least ${String(minimum)}, found ${String(actual)}. Rerun pnpm dev:seed and inspect the deterministic fixture rows.`,
      );
    }
  }
}

export function buildDemoVectorJobs(teamId: string, rows: DemoVectorRows): queue.EmbedJobData[] {
  return [
    ...rows.rawEvents.map(
      ({ id }): queue.EmbedRawEventJobData => ({ scope: 'raw_event', rawEventId: id, teamId }),
    ),
    ...rows.facts.map(
      ({ id, rawEventId }): queue.EmbedFactJobData => ({
        scope: 'fact',
        factId: id,
        rawEventId,
        teamId,
      }),
    ),
    ...rows.documentChunks.map(
      ({ id }): queue.EmbedDocChunkJobData => ({
        scope: 'doc_chunk',
        documentChunkId: id,
        teamId,
      }),
    ),
    ...rows.meetingChunks.map(
      ({ id }): queue.EmbedMeetingChunkJobData => ({
        scope: 'meeting_chunk',
        meetingChunkId: id,
        teamId,
      }),
    ),
  ];
}
