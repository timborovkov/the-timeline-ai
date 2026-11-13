/** This command is deliberately unavailable against remote or production stores. */
export function assertDevelopmentResetEnvironment(env: Record<string, string | undefined>): void {
  if (
    !['development', 'test'].includes(env.NODE_ENV ?? '') ||
    env.ENGINE_DEV_RESET_ALLOWED !== 'true'
  )
    throw new Error(
      'Development reset requires NODE_ENV=development/test and ENGINE_DEV_RESET_ALLOWED=true',
    );
  if (env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID || env.VERCEL_ENV === 'production')
    throw new Error('Development reset is disabled on hosted environments');
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'QDRANT_URL']) {
    const value = env[key];
    if (!value) throw new Error(`${key} is required for a complete reset`);
    const host = new URL(value).hostname;
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'redis', 'qdrant', 'db'].includes(host))
      throw new Error(`${key} must identify local development infrastructure`);
  }
}
