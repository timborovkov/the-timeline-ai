import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Daytona, DaytonaNotFoundError, Image } from '@daytonaio/sdk';
import { childLogger, getEnv } from '@timeline/shared';

const log = childLogger('worker:document-ingestion:snapshot');

/**
 * Bump when the Image recipe changes without a sandbox-dir file change
 * (base image, workdir, remote paths, resources, chmod set, etc.).
 */
export const DOCUMENT_EXTRACT_SNAPSHOT_IMAGE_REVISION = '2';

export const DOCUMENT_EXTRACT_SNAPSHOT_PREFIX = 'timeline-document-extract';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Sandbox sources shipped next to the worker package (src/ or dist/). */
function defaultDocumentExtractSandboxDir(): string {
  return join(HERE, '..', '..', 'document-extract-sandbox');
}

function shouldHashSandboxFile(relativePath: string): boolean {
  const normalized = relativePath.split('\\').join('/');
  if (normalized.startsWith('.')) return false;
  if (normalized.endsWith('.md')) return false;
  return true;
}

async function listHashableSandboxFiles(sandboxDir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(sandboxDir, abs);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!shouldHashSandboxFile(rel)) continue;
      out.push(abs);
    }
  }

  const root = await stat(sandboxDir);
  if (!root.isDirectory()) {
    throw new Error(`document-extract sandbox dir is not a directory: ${sandboxDir}`);
  }
  await walk(sandboxDir);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/** Stable 12-char hex content hash of sandbox inputs + image revision. */
export async function hashDocumentExtractSandbox(
  sandboxDir: string = defaultDocumentExtractSandboxDir(),
): Promise<string> {
  const hash = createHash('sha256');
  hash.update(`image-revision:${DOCUMENT_EXTRACT_SNAPSHOT_IMAGE_REVISION}\n`);
  const files = await listHashableSandboxFiles(sandboxDir);
  if (files.length === 0) {
    throw new Error(`document-extract sandbox dir has no hashable files: ${sandboxDir}`);
  }
  for (const abs of files) {
    const rel = relative(sandboxDir, abs).split('\\').join('/');
    hash.update(rel);
    hash.update('\0');
    hash.update(await readFile(abs));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

export function documentExtractSnapshotName(contentHash: string): string {
  return `${DOCUMENT_EXTRACT_SNAPSHOT_PREFIX}-${contentHash}`;
}

/**
 * Resolve the Daytona snapshot name.
 *
 * - Explicit `DAYTONA_SNAPSHOT` (when not `auto` / `content-hash`) wins.
 * - Otherwise pin to `timeline-document-extract-<contentHash>` so deploys
 *   stay in lockstep with the sandbox directory in this commit.
 */
export async function resolveDocumentExtractSnapshotName(
  explicit: string | undefined,
  sandboxDir: string = defaultDocumentExtractSandboxDir(),
): Promise<string> {
  const trimmed = explicit?.trim();
  if (trimmed && trimmed !== 'auto' && trimmed !== 'content-hash') {
    return trimmed;
  }
  return documentExtractSnapshotName(await hashDocumentExtractSandbox(sandboxDir));
}

/** Image definition baked into the Daytona snapshot (must match sandbox scripts). */
function buildDocumentExtractSnapshotImage(
  sandboxDir: string = defaultDocumentExtractSandboxDir(),
): Image {
  return Image.debianSlim('3.12')
    .pipInstallFromRequirements(join(sandboxDir, 'requirements.txt'))
    .workdir('/opt/timeline')
    .addLocalFile(join(sandboxDir, 'extract_anydoc.py'), '/opt/timeline/extract_anydoc.py')
    .runCommands('chmod +x /opt/timeline/extract_anydoc.py');
}

export interface EnsureDocumentExtractSnapshotResult {
  name: string;
  created: boolean;
  contentHash: string;
}

export interface PruneDocumentExtractSnapshotsResult {
  currentName: string;
  kept: string[];
  deleted: string[];
  skippedInUse: string[];
}

export interface DocumentExtractSnapshotDaytonaConfig {
  apiKey: string;
  apiUrl?: string;
  target?: string;
}

/** Build a Daytona client without requiring full app `getEnv()` (CLI / CI). */
export function createDocumentExtractSnapshotDaytona(
  config: DocumentExtractSnapshotDaytonaConfig,
): Daytona {
  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    throw new Error('DAYTONA_API_KEY is required to manage document-extract snapshots');
  }
  const apiUrl = config.apiUrl?.trim();
  const target = config.target?.trim();
  return new Daytona({
    apiKey,
    apiUrl: apiUrl && apiUrl.length > 0 ? apiUrl : 'https://app.daytona.io/api',
    target: target && target.length > 0 ? target : 'us',
  });
}

function createDaytonaFromAppEnv(): Daytona {
  const env = getEnv();
  if (!env.DAYTONA_API_KEY) {
    throw new Error('DAYTONA_API_KEY is required to manage document-extract snapshots');
  }
  return createDocumentExtractSnapshotDaytona({
    apiKey: env.DAYTONA_API_KEY,
    apiUrl: env.DAYTONA_API_URL,
    target: env.DAYTONA_TARGET,
  });
}

async function waitUntilSnapshotGone(daytona: Daytona, name: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      await daytona.snapshot.get(name);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (err: unknown) {
      if (err instanceof DaytonaNotFoundError) return;
      throw err;
    }
  }
  throw new Error(`timed out waiting for Daytona snapshot "${name}" to disappear after delete`);
}

async function createSnapshot(
  daytona: Daytona,
  name: string,
  sandboxDir: string,
  onLogs?: (chunk: string) => void,
): Promise<void> {
  const image = buildDocumentExtractSnapshotImage(sandboxDir);
  await daytona.snapshot.create(
    {
      name,
      image,
      resources: { cpu: 1, memory: 2, disk: 3 },
    },
    onLogs ? { onLogs } : undefined,
  );
}

/**
 * Ensure the content-hashed (or explicit) snapshot exists.
 * Does not rebuild when the named snapshot is already present.
 */
export async function ensureDocumentExtractSnapshot(options?: {
  /** Same semantics as DAYTONA_SNAPSHOT (`auto` / unset → content hash). */
  explicitName?: string;
  sandboxDir?: string;
  force?: boolean;
  onLogs?: (chunk: string) => void;
  daytona?: Daytona;
}): Promise<EnsureDocumentExtractSnapshotResult> {
  const sandboxDir = options?.sandboxDir ?? defaultDocumentExtractSandboxDir();
  const contentHash = await hashDocumentExtractSandbox(sandboxDir);
  const snapshotName = await resolveDocumentExtractSnapshotName(options?.explicitName, sandboxDir);
  const daytona = options?.daytona ?? createDaytonaFromAppEnv();
  const force = options?.force === true;
  let existing: Awaited<ReturnType<Daytona['snapshot']['get']>> | null = null;

  try {
    existing = await daytona.snapshot.get(snapshotName);
  } catch (err: unknown) {
    if (!(err instanceof DaytonaNotFoundError)) throw err;
  }

  if (!force && existing) {
    log.info({ snapshot: snapshotName, contentHash }, 'document-extract snapshot already present');
    return { name: snapshotName, created: false, contentHash };
  }

  if (force && existing) {
    log.info(
      { snapshot: snapshotName },
      'deleting existing document-extract snapshot before force create',
    );
    await daytona.snapshot.delete(existing);
    await waitUntilSnapshotGone(daytona, snapshotName);
  }

  log.info(
    { snapshot: snapshotName, contentHash, force },
    'creating document-extract Daytona snapshot',
  );
  try {
    await createSnapshot(daytona, snapshotName, sandboxDir, options?.onLogs);
  } catch (err: unknown) {
    // Concurrent ensure (multi-replica first boot): treat "already exists" as success.
    try {
      await daytona.snapshot.get(snapshotName);
      log.info(
        { snapshot: snapshotName, contentHash },
        'document-extract snapshot appeared during create race',
      );
      return { name: snapshotName, created: false, contentHash };
    } catch {
      throw err;
    }
  }

  return { name: snapshotName, created: true, contentHash };
}

/** Delete unused old content-hashed snapshots while preserving a rollback window. */
export async function pruneDocumentExtractSnapshots(options: {
  currentName: string;
  retain: number;
  daytona: Daytona;
}): Promise<PruneDocumentExtractSnapshotsResult> {
  const { currentName, retain, daytona } = options;
  const hashedNamePattern = new RegExp(`^${DOCUMENT_EXTRACT_SNAPSHOT_PREFIX}-[a-f0-9]{12}$`);
  if (!hashedNamePattern.test(currentName)) {
    throw new Error(`refusing to prune with non-hashed current snapshot: ${currentName}`);
  }
  if (!Number.isInteger(retain) || retain < 1) {
    throw new Error('snapshot retention must be a positive integer');
  }

  const snapshots: Awaited<ReturnType<Daytona['snapshot']['list']>>['items'] = [];
  let pageNumber = 1;
  let totalPages: number;
  do {
    const page = await daytona.snapshot.list(pageNumber, 100);
    snapshots.push(...page.items);
    totalPages = page.totalPages;
    pageNumber += 1;
  } while (pageNumber <= totalPages);

  const hashedSnapshots = snapshots
    .filter((snapshot) => hashedNamePattern.test(snapshot.name))
    .sort((a, b) => {
      const createdDelta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return createdDelta || a.name.localeCompare(b.name);
    });
  if (!hashedSnapshots.some((snapshot) => snapshot.name === currentName)) {
    throw new Error(`current snapshot was not returned by Daytona: ${currentName}`);
  }
  const protectedNames = new Set([currentName]);
  for (const snapshot of hashedSnapshots) {
    if (protectedNames.size >= retain) break;
    protectedNames.add(snapshot.name);
  }

  const deleted: string[] = [];
  const skippedInUse: string[] = [];
  for (const snapshot of hashedSnapshots) {
    if (protectedNames.has(snapshot.name)) continue;
    let inUse = false;
    for await (const _sandbox of daytona.list({ snapshots: [snapshot.name] })) {
      inUse = true;
      break;
    }
    if (inUse) {
      skippedInUse.push(snapshot.name);
      continue;
    }
    await daytona.snapshot.delete(snapshot);
    deleted.push(snapshot.name);
  }

  return {
    currentName,
    kept: hashedSnapshots
      .filter((snapshot) => protectedNames.has(snapshot.name))
      .map((snapshot) => snapshot.name),
    deleted,
    skippedInUse,
  };
}
