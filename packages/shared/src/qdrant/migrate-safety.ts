/**
 * Storage-layout copy never runs against production. Deploying the new
 * collection create body does not rewrite an existing collection; this
 * guard is the extra belt for the operator script that would write points.
 */
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
}
