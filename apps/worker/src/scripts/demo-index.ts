import { existsSync, readFileSync } from 'node:fs';

import {
  closeDb,
  documentChunks,
  documents,
  documentVersions,
  facts,
  getDb,
  meetings,
  meetingTranscriptChunks,
  rawEvents,
} from '@timeline/db';
import { getEnv, qdrant } from '@timeline/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import {
  assertDemoVectorIndexEnvironment,
  assertExpectedDemoVectorSources,
  buildDemoVectorJobs,
  type DemoVectorRows,
} from '#src/scripts/demo-index-contract.js';
import { processEmbedJob } from '#src/workers/embed.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Args {
  teamId: string;
  fixtureVersion: string;
}

loadDotEnv(process.env.TIMELINE_ENV_FILE);

function parseArgs(): Args {
  let teamId: string | undefined;
  let fixtureVersion: string | undefined;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--team=')) teamId = arg.slice('--team='.length);
    if (arg.startsWith('--fixture-version=')) {
      fixtureVersion = arg.slice('--fixture-version='.length);
    }
  }
  if (!teamId || !UUID_RE.test(teamId) || !fixtureVersion?.trim()) {
    throw new Error('Usage: demo-index --team=<uuid> --fixture-version=<version>');
  }
  return { teamId, fixtureVersion };
}

function assertVectorEnvironment(): void {
  const env = getEnv();
  assertDemoVectorIndexEnvironment({
    nodeEnv: env.NODE_ENV,
    openRouterApiKey: env.OPENROUTER_API_KEY,
    qdrantUrl: env.QDRANT_URL,
    allowDevSeed: process.env.ALLOW_DEV_SEED,
  });
}

async function readDemoVectorRows(args: Args): Promise<DemoVectorRows> {
  const db = getDb();
  const [eventRows, factRows, documentChunkRows, meetingChunkRows] = await Promise.all([
    db
      .select({ id: rawEvents.id })
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.teamId, args.teamId),
          sql`${rawEvents.sourceMetadata} ->> 'fixture_version' = ${args.fixtureVersion}`,
        ),
      )
      .orderBy(asc(rawEvents.id)),
    db
      .select({ id: facts.id, rawEventId: facts.rawEventId })
      .from(facts)
      .where(and(eq(facts.teamId, args.teamId), eq(facts.modelVersion, args.fixtureVersion)))
      .orderBy(asc(facts.id)),
    db
      .select({ id: documentChunks.id, versionId: documentChunks.documentVersionId })
      .from(documentChunks)
      .innerJoin(documents, eq(documents.id, documentChunks.documentId))
      .where(
        and(
          eq(documentChunks.teamId, args.teamId),
          sql`${documents.metadata} ->> 'fixture_version' = ${args.fixtureVersion}`,
        ),
      )
      .orderBy(asc(documentChunks.id)),
    db
      .select({ id: meetingTranscriptChunks.id })
      .from(meetingTranscriptChunks)
      .innerJoin(meetings, eq(meetings.id, meetingTranscriptChunks.meetingId))
      .where(
        and(
          eq(meetingTranscriptChunks.teamId, args.teamId),
          sql`${meetings.metadata} ->> 'fixture_version' = ${args.fixtureVersion}`,
        ),
      )
      .orderBy(asc(meetingTranscriptChunks.id)),
  ]);
  return {
    rawEvents: eventRows,
    facts: factRows,
    documentChunks: documentChunkRows,
    meetingChunks: meetingChunkRows,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  assertVectorEnvironment();
  const db = getDb();
  try {
    const rows = await readDemoVectorRows(args);
    assertExpectedDemoVectorSources(rows);
    const pointIds: string[] = [];
    const models = new Set<string>();
    for (const job of buildDemoVectorJobs(args.teamId, rows)) {
      const result = await processEmbedJob({ db }, job);
      if (
        result.skipped ||
        !('pointIds' in result) ||
        result.pointIds.length === 0 ||
        typeof result.model !== 'string' ||
        !result.model
      ) {
        throw new Error(`Demo embedding unexpectedly skipped ${JSON.stringify(job)}`);
      }
      pointIds.push(...result.pointIds);
      models.add(result.model);
    }
    if (models.size !== 1) {
      throw new Error(`Demo embeddings used inconsistent models: ${[...models].join(', ')}`);
    }
    const model = [...models][0];
    if (!model) throw new Error('Demo embedding provider returned no model identifier');

    const available = await qdrant.getQdrantClient().pointsExist(pointIds);
    const missing = pointIds.filter((id) => !available.has(id));
    if (missing.length > 0) {
      throw new Error(
        `Qdrant did not confirm ${String(missing.length)} demo point(s) after upsert: ${missing.join(', ')}`,
      );
    }

    const versionIds = [...new Set(rows.documentChunks.map((row) => row.versionId))];
    await db
      .update(documentVersions)
      .set({ processingStatus: 'embedded', processingError: null, embeddingModelVersion: model })
      .where(
        and(eq(documentVersions.teamId, args.teamId), inArray(documentVersions.id, versionIds)),
      );
    console.log(
      `[demo:index] indexed and confirmed ${String(pointIds.length)} points with ${model}`,
    );
  } finally {
    await closeDb();
  }
}

function loadDotEnv(path: string | undefined): void {
  if (!path || !existsSync(path)) return;
  const body = readFileSync(path, 'utf8');
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || process.env[key] !== undefined) continue;
    const value = (rawValue ?? '').trim();
    process.env[key] =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value;
  }
}

main().catch((error: unknown) => {
  console.error('[demo:index] failed', error);
  process.exit(1);
});
