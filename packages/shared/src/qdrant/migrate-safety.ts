/**
 * Storage-layout copy never runs against production. Deploying the new
 * collection create body does not rewrite an existing collection; this
 * guard is the extra belt for the operator script that would write points.
 *
 * The caller process env is not enough: a developer shell can still point
 * `QDRANT_URL` at a remote cluster. Loopback is allowed; any other host
 * needs an explicit isolated-cluster acknowledgement.
 */

export const QDRANT_MIGRATE_REMOTE_ACK = 'I_UNDERSTAND_THIS_TARGETS_AN_ISOLATED_QDRANT';

function parseQdrantHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error('QDRANT_URL must be a valid URL for collection migration');
  }
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export function assertQdrantMigrateAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing Qdrant collection migration with NODE_ENV=production');
  }
  const railwayEnv = (env.RAILWAY_ENVIRONMENT_NAME ?? env.RAILWAY_ENVIRONMENT ?? '')
    .trim()
    .toLowerCase();
  if (railwayEnv === 'production') {
    throw new Error('Refusing Qdrant collection migration against Railway production');
  }

  const qdrantUrl = env.QDRANT_URL?.trim();
  if (!qdrantUrl) {
    throw new Error(
      'QDRANT_URL is required for collection migration; the guard checks the Qdrant target, not only the caller process env',
    );
  }
  const host = parseQdrantHost(qdrantUrl);
  if (!isLoopbackHost(host) && env.ALLOW_QDRANT_MIGRATE_REMOTE !== QDRANT_MIGRATE_REMOTE_ACK) {
    throw new Error(
      `Refusing non-loopback Qdrant host "${host}". Set ALLOW_QDRANT_MIGRATE_REMOTE=${QDRANT_MIGRATE_REMOTE_ACK} only for an isolated staging cluster.`,
    );
  }
}
