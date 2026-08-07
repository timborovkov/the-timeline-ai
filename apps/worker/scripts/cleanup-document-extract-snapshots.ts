/**
 * Prune old content-hashed document-extract snapshots after CI publishes the current one.
 *
 * Usage:
 *   pnpm --filter @timeline/worker cleanup-document-extract-snapshots
 *   pnpm --filter @timeline/worker cleanup-document-extract-snapshots -- --retain=3
 *
 * Only exact `timeline-document-extract-<12-char-hex>` names are eligible.
 * The current snapshot and newest rollback snapshots are retained, and any
 * snapshot referenced by a Daytona sandbox is skipped.
 */
// Relative imports: this file lives under scripts/ (outside tsconfig rootDir),
// so the package `#src/*` map would resolve to dist/ when present.
import {
  createDocumentExtractSnapshotDaytona,
  pruneDocumentExtractSnapshots,
  resolveDocumentExtractSnapshotName,
} from '../src/document-ingestion/document-extract-snapshot.js';

function retentionFromArgs(args: string[]): number {
  const value = args.find((arg) => arg.startsWith('--retain='))?.slice('--retain='.length);
  if (value === undefined) return 3;
  const retain = Number(value);
  if (!Number.isInteger(retain) || retain < 1) {
    throw new Error('--retain must be a positive integer');
  }
  return retain;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const apiKey = process.env.DAYTONA_API_KEY?.trim();
  if (!apiKey) throw new Error('DAYTONA_API_KEY is required');

  const daytona = createDocumentExtractSnapshotDaytona({
    apiKey,
    apiUrl: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET,
  });
  const currentName = await resolveDocumentExtractSnapshotName(
    process.env.DAYTONA_SNAPSHOT?.trim() || undefined,
  );
  const result = await pruneDocumentExtractSnapshots({
    currentName,
    retain: retentionFromArgs(args),
    daytona,
  });

  console.log(`Current snapshot: ${result.currentName}`);
  console.log(`Retained snapshots: ${result.kept.join(', ')}`);
  console.log(`Deleted snapshots: ${result.deleted.join(', ') || 'none'}`);
  console.log(`Skipped snapshots in use: ${result.skippedInUse.join(', ') || 'none'}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
