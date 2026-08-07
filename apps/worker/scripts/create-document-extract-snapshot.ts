/**
 * Ensure (or force-rebuild) the Daytona snapshot used by document-extract.
 *
 * Snapshot names default to a content hash of `document-extract-sandbox/**`
 * plus the Image recipe revision:
 *   timeline-document-extract-<12-char-sha256>
 *
 * Usage:
 *   set -a; . ./.env; set +a
 *   pnpm --filter @timeline/worker create-document-extract-snapshot
 *   pnpm --filter @timeline/worker create-document-extract-snapshot -- --force
 *   pnpm --filter @timeline/worker create-document-extract-snapshot -- --print-name-only
 *
 * Env:
 *   DAYTONA_API_KEY (required unless --print-name-only)
 *   DAYTONA_API_URL (default https://app.daytona.io/api)
 *   DAYTONA_TARGET (default us)
 *   DAYTONA_SNAPSHOT (optional pin; unset / auto / content-hash → hashed name)
 */
// Relative imports: this file lives under scripts/ (outside tsconfig rootDir),
// so the package `#src/*` map would resolve to dist/ when present.
import {
  createDocumentExtractSnapshotDaytona,
  ensureDocumentExtractSnapshot,
  resolveDocumentExtractSnapshotName,
} from '../src/document-ingestion/document-extract-snapshot.js';

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function main(): Promise<void> {
  // pnpm sometimes forwards a bare `--` before script flags.
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const force = hasFlag(args, '--force');
  const printNameOnly = hasFlag(args, '--print-name-only');
  const explicitName = process.env.DAYTONA_SNAPSHOT?.trim() || undefined;

  if (printNameOnly) {
    const name = await resolveDocumentExtractSnapshotName(explicitName);
    process.stdout.write(`${name}\n`);
    return;
  }

  const apiKey = process.env.DAYTONA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('DAYTONA_API_KEY is required');
  }

  const daytona = createDocumentExtractSnapshotDaytona({
    apiKey,
    apiUrl: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET,
  });

  const result = await ensureDocumentExtractSnapshot({
    explicitName,
    force,
    daytona,
    onLogs: (chunk: string) => {
      process.stdout.write(chunk);
    },
  });

  const line = `DAYTONA_SNAPSHOT=${result.name}`;
  console.log(
    `\n${result.created ? 'Snapshot created' : force ? 'Snapshot rebuilt' : 'Snapshot already present'}: ${result.name}`,
  );
  console.log(`contentHash=${result.contentHash}`);
  console.log(line);

  const githubOutput = process.env.GITHUB_OUTPUT?.trim();
  if (githubOutput) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(githubOutput, `snapshot_name=${result.name}\n`);
    appendFileSync(githubOutput, `content_hash=${result.contentHash}\n`);
    appendFileSync(githubOutput, `created=${result.created ? 'true' : 'false'}\n`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
