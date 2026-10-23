/**
 * Copy a Qdrant collection onto a new on-disk + quantized collection without
 * re-embedding. Uses the same `--target-collection` / `requireExisting`
 * contract as reembed: the operator creates the destination (or passes
 * `--create-target`), then points are scrolled from the source and upserted
 * into the named target. The live `QDRANT_COLLECTION` is never rewritten.
 *
 * Pause embed workers (and any other Qdrant writers) before a live copy.
 * Live `--copy` requires `--writers-paused`, runs a second resync pass, and
 * `--verify` checks identity (ids + vector/payload fingerprints) in addition
 * to counts.
 *
 * Usage:
 *   pnpm --filter @timeline/worker qdrant-migrate-collection -- \
 *     --source-collection=events \
 *     --target-collection=events_ondisk \
 *     --create-target --copy --verify --writers-paused --all-teams
 *
 * Optional:
 *   --measure --team=<uuid> --user=<uuid> [--recall-sample=32] [--recall-k=10]
 *   --dry-run --page-size=64
 *
 * Then switch `QDRANT_COLLECTION=events_ondisk` and restart web + workers.
 * Refuses NODE_ENV=production, Railway production, and non-loopback
 * QDRANT_URL unless ALLOW_QDRANT_MIGRATE_REMOTE is set.
 */
import { loadEnvFile } from 'node:process';
import { pathToFileURL } from 'node:url';

import { qdrant } from '@timeline/shared';
import { getEnv } from '@timeline/shared/env';
import { TIMELINE_MODELS } from '@timeline/shared/llm';

type QdrantClient = qdrant.QdrantClient;
type QdrantClientOptions = qdrant.QdrantClientOptions;
type RecallAtKResult = qdrant.RecallAtKResult;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface QdrantMigrateArgs {
  sourceCollection: string;
  targetCollection: string;
  createTarget: boolean;
  copy: boolean;
  verify: boolean;
  measure: boolean;
  dryRun: boolean;
  writersPaused: boolean;
  pageSize: number;
  recallSample: number;
  recallK: number;
  teamId?: string;
  userId?: string;
  teamIds: string[];
  allTeams: boolean;
}

export interface QdrantMigrateDeps {
  createClient?: (opts: QdrantClientOptions) => QdrantClient;
  write?: (text: string) => void;
  setExitCode?: (code: number) => void;
  env?: NodeJS.ProcessEnv;
}

export class QdrantMigrateUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QdrantMigrateUsageError';
  }
}

export function parseArgs(argv = process.argv.slice(2)): QdrantMigrateArgs {
  let sourceCollection: string | undefined;
  let targetCollection: string | undefined;
  let createTarget = false;
  let copy = false;
  let verify = false;
  let measure = false;
  let dryRun = false;
  let writersPaused = false;
  let pageSize = 64;
  let recallSample = 32;
  let recallK = 10;
  let teamId: string | undefined;
  let userId: string | undefined;
  const teamIds: string[] = [];
  let allTeams = false;

  for (const arg of argv) {
    if (arg === '--') continue;
    else if (arg.startsWith('--source-collection=')) {
      sourceCollection = arg.slice('--source-collection='.length).trim();
    } else if (arg.startsWith('--target-collection=')) {
      targetCollection = arg.slice('--target-collection='.length).trim();
    } else if (arg === '--create-target') createTarget = true;
    else if (arg === '--copy') copy = true;
    else if (arg === '--verify') verify = true;
    else if (arg === '--measure') measure = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--writers-paused') writersPaused = true;
    else if (arg === '--all-teams') allTeams = true;
    else if (arg.startsWith('--page-size=')) {
      pageSize = parsePositiveInt(arg.slice('--page-size='.length), '--page-size');
    } else if (arg.startsWith('--recall-sample=')) {
      recallSample = parsePositiveInt(arg.slice('--recall-sample='.length), '--recall-sample');
    } else if (arg.startsWith('--recall-k=')) {
      recallK = parsePositiveInt(arg.slice('--recall-k='.length), '--recall-k');
    } else if (arg.startsWith('--team=')) {
      teamId = arg.slice('--team='.length).trim();
      if (teamId) teamIds.push(teamId);
    } else if (arg.startsWith('--user=')) {
      userId = arg.slice('--user='.length).trim();
    } else {
      throw new QdrantMigrateUsageError(`Unknown argument: ${arg}`);
    }
  }

  if (!sourceCollection) throw new QdrantMigrateUsageError('Missing --source-collection=<name>');
  if (!targetCollection) throw new QdrantMigrateUsageError('Missing --target-collection=<name>');
  if (sourceCollection === targetCollection) {
    throw new QdrantMigrateUsageError('--source-collection and --target-collection must differ');
  }
  if (!createTarget && !copy && !verify && !measure) {
    throw new QdrantMigrateUsageError(
      'Specify at least one of --create-target, --copy, --verify, --measure',
    );
  }
  if (copy && !dryRun && !writersPaused) {
    throw new QdrantMigrateUsageError(
      'Live --copy requires --writers-paused after pausing embed workers so upserts during the copy are not lost',
    );
  }
  if ((copy || verify) && !allTeams && teamIds.length === 0) {
    throw new QdrantMigrateUsageError(
      'copy/verify requires --team=<uuid> (repeatable) or --all-teams',
    );
  }
  if (measure) {
    if (!teamId || !UUID_RE.test(teamId)) {
      throw new QdrantMigrateUsageError('--measure requires --team=<uuid>');
    }
    if (!userId || !UUID_RE.test(userId)) {
      throw new QdrantMigrateUsageError('--measure requires --user=<uuid>');
    }
  }

  const args: QdrantMigrateArgs = {
    sourceCollection,
    targetCollection,
    createTarget,
    copy,
    verify,
    measure,
    dryRun,
    writersPaused,
    pageSize,
    recallSample,
    recallK,
    teamIds: qdrant.normalizeTeamIds(teamIds),
    allTeams,
  };
  if (teamId) args.teamId = teamId;
  if (userId) args.userId = userId;
  return args;
}

function parsePositiveInt(raw: string, flag: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new QdrantMigrateUsageError(`${flag} must be a positive integer`);
  }
  return value;
}

export function usage(): string {
  return (
    'Usage: qdrant-migrate-collection --source-collection=<name> --target-collection=<name>\n' +
    '       [--create-target] [--copy] [--verify] [--writers-paused]\n' +
    '       [--all-teams | --team=<uuid> ...]\n' +
    '       [--measure --team=<uuid> --user=<uuid>]\n' +
    '       [--dry-run] [--page-size=64] [--recall-sample=32] [--recall-k=10]'
  );
}

function recallHasNoData(recall: Record<string, unknown>): boolean {
  return Object.values(recall).some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    return (entry as RecallAtKResult).status === 'no_data';
  });
}

export async function runQdrantMigrateCollection(
  args: QdrantMigrateArgs,
  deps: QdrantMigrateDeps = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  qdrant.assertQdrantMigrateAllowed(env);
  if (args.copy && !args.dryRun && !args.writersPaused) {
    throw new QdrantMigrateUsageError(
      'Live --copy requires --writers-paused after pausing embed workers so upserts during the copy are not lost',
    );
  }
  const write = deps.write ?? console.log;
  const setExitCode = deps.setExitCode ?? ((code: number) => (process.exitCode = code));
  const createClient = deps.createClient ?? qdrant.createQdrantClient;
  const parsedEnv = getEnv();
  const quantization = qdrant.qdrantQuantizationFromEnv(parsedEnv);
  const vectorSize = TIMELINE_MODELS.embedding.embeddingDimensions;
  const createBody = qdrant.qdrantCollectionCreateBody(vectorSize, quantization.kind);

  const report: Record<string, unknown> = {
    mode: 'qdrant_storage_layout_copy',
    dryRun: args.dryRun,
    sourceCollection: args.sourceCollection,
    targetCollection: args.targetCollection,
    createBody,
    searchQuantization: {
      rescore: quantization.rescore,
      oversampling: quantization.oversampling,
      kind: quantization.kind,
    },
  };

  const source = createClient({
    collection: args.sourceCollection,
    requireExisting: true,
  });

  if (args.createTarget) {
    if (args.dryRun) {
      report.targetCreated = 'dry-run';
    } else {
      const targetForCreate = createClient({
        collection: args.targetCollection,
        requireExisting: false,
      });
      await targetForCreate.ensureCollection();
      report.targetCreated = true;
    }
  }

  const target = createClient({
    collection: args.targetCollection,
    requireExisting: true,
  });

  if (!args.dryRun) {
    const info = await target.collectionInfo();
    qdrant.assertCollectionMatchesCreateBody(info, createBody);
    report.targetLayout = 'ok';
  }

  let copyTeamIds = args.teamIds;
  let verifyTeamIds = args.teamIds;
  if (args.copy || args.verify) {
    if (args.allTeams) {
      const sourceTeams = await qdrant.listCollectionTeamIds(source, { pageSize: args.pageSize });
      if (args.copy && sourceTeams.length === 0) {
        throw new QdrantMigrateUsageError(
          'Source collection has no team_id payload values to copy',
        );
      }
      copyTeamIds = sourceTeams;
      if (args.verify && !args.dryRun) {
        const targetTeams = await qdrant.listCollectionTeamIds(target, {
          pageSize: args.pageSize,
        });
        verifyTeamIds = qdrant.unionTeamIds(sourceTeams, targetTeams);
        if (verifyTeamIds.length === 0) {
          throw new QdrantMigrateUsageError(
            'No team_id payload values to verify in source or target',
          );
        }
      } else {
        verifyTeamIds = sourceTeams;
      }
    } else {
      copyTeamIds = qdrant.requireTeamIds(args.teamIds);
      verifyTeamIds = copyTeamIds;
    }
    report.teamIds = args.verify ? verifyTeamIds : copyTeamIds;
    if (args.copy) report.copyTeamIds = copyTeamIds;
    if (args.verify) report.verifyTeamIds = verifyTeamIds;
  }

  if (args.copy) {
    report.copy = await qdrant.copyCollectionPoints({
      source,
      target,
      teamIds: copyTeamIds,
      pageSize: args.pageSize,
      dryRun: args.dryRun,
    });
  }

  if (args.verify) {
    if (args.dryRun) {
      report.verify = 'dry-run';
    } else {
      const counts = await qdrant.verifyCollectionCounts(source, target, verifyTeamIds);
      const identity = await qdrant.verifyCollectionIdentity(source, target, {
        pageSize: args.pageSize,
        teamIds: verifyTeamIds,
      });
      const matched = counts.matched && identity.matched;
      report.verify = { ...counts, identity, matched };
      if (!matched) setExitCode(1);
    }
  }

  if (args.measure && args.teamId && args.userId) {
    if (args.dryRun) {
      // Dry-run must not PATCH optimizer/HNSW thresholds or require a target
      // that --create-target has not actually created.
      report.ram = 'dry-run';
      report.recall = 'dry-run';
    } else {
      const measureOpts = {
        teamId: args.teamId,
        userId: args.userId,
        sampleSize: args.recallSample,
        k: args.recallK,
        prepareIndex: false as const,
      };
      await qdrant.waitForQuantizedIndex(source);
      await qdrant.waitForQuantizedIndex(target);
      const ram: Record<string, unknown> = {
        source: await qdrant.measureCollectionRam(source),
        target: await qdrant.measureCollectionRam(target),
      };
      const recall: Record<string, unknown> = {
        source: await qdrant.measureQuantizedRecall(source, measureOpts),
        target: await qdrant.measureQuantizedRecall(target, measureOpts),
      };
      report.ram = ram;
      report.recall = recall;
      if (recallHasNoData(recall)) setExitCode(1);
    }
  }

  write(`${JSON.stringify(report, null, 2)}\n`);
}

function loadOptionalEnvFile(): void {
  const envFile = process.env.TIMELINE_ENV_FILE;
  if (envFile?.trim()) loadEnvFile(envFile);
}

async function main(): Promise<void> {
  loadOptionalEnvFile();
  let args: QdrantMigrateArgs;
  try {
    args = parseArgs();
  } catch (err) {
    if (err instanceof QdrantMigrateUsageError) {
      console.error(`[qdrant-migrate-collection] ${err.message}`);
      console.error(usage());
      process.exit(2);
    }
    throw err;
  }
  await runQdrantMigrateCollection(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error('[qdrant-migrate-collection] failed', err);
    process.exit(1);
  });
}
