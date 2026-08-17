import { type queue } from '@timeline/shared';

const REMOTE_DEV_OVERRIDE = 'I_UNDERSTAND_THIS_SEEDS_KNOWN_DEV_CREDENTIALS';

export const DEMO_VECTOR_SOURCE_MINIMUMS = {
  rawEvents: 2500,
  facts: 20,
  documentChunks: 15,
  meetingChunks: 8,
} as const;

export const DEMO_VECTOR_ID_FAMILIES = {
  rawEvents: {
    northstarPrefix: '91000000-',
    corpusPrefix: '92000000-',
    northstarExact: 4,
    corpusMinimum: 2500,
  },
  facts: {
    northstarPrefix: 'c3000000-',
    corpusPrefix: 'c4000000-',
    northstarExact: 5,
    corpusMinimum: 20,
  },
  documentChunks: {
    northstarPrefix: '44000000-',
    corpusPrefix: '45000000-',
    northstarExact: 1,
    corpusMinimum: 15,
  },
  meetingChunks: {
    northstarPrefix: '55000000-',
    corpusPrefix: '56000000-',
    northstarExact: 1,
    corpusMinimum: 8,
  },
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

function assertVectorIdFamily(
  kind: keyof typeof DEMO_VECTOR_ID_FAMILIES,
  ids: readonly string[],
): void {
  const family = DEMO_VECTOR_ID_FAMILIES[kind];
  const unexpected = ids.filter(
    (id) => !id.startsWith(family.northstarPrefix) && !id.startsWith(family.corpusPrefix),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Demo vector source set includes unexpected ${kind} ids: ${unexpected.slice(0, 5).join(', ')}`,
    );
  }
  const northstar = ids.filter((id) => id.startsWith(family.northstarPrefix)).length;
  const corpus = ids.filter((id) => id.startsWith(family.corpusPrefix)).length;
  if (northstar !== family.northstarExact) {
    throw new Error(
      `Demo vector source set is incomplete: ${kind} expected exactly ${String(family.northstarExact)} Northstar ids, found ${String(northstar)}.`,
    );
  }
  if (corpus < family.corpusMinimum) {
    throw new Error(
      `Demo vector source set is incomplete: ${kind} expected at least ${String(family.corpusMinimum)} corpus ids, found ${String(corpus)}. Rerun pnpm dev:seed and inspect the deterministic fixture rows.`,
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
  assertVectorIdFamily(
    'rawEvents',
    rows.rawEvents.map((row) => row.id),
  );
  assertVectorIdFamily(
    'facts',
    rows.facts.map((row) => row.id),
  );
  assertVectorIdFamily(
    'documentChunks',
    rows.documentChunks.map((row) => row.id),
  );
  assertVectorIdFamily(
    'meetingChunks',
    rows.meetingChunks.map((row) => row.id),
  );
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
