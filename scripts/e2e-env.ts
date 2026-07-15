import { spawnSync } from 'node:child_process';

type Env = NodeJS.ProcessEnv;
type PublishedPortLookup = (container: string, containerPort: number) => string | null;

const DEFAULT_DOCKER_INSPECT_TIMEOUT_MS = 5_000;

interface BuildE2eEnvOptions {
  publishedPort?: PublishedPortLookup;
  dockerInspectTimeoutMs?: number;
}

function publishedPort(
  container: string,
  containerPort: number,
  timeoutMs = DEFAULT_DOCKER_INSPECT_TIMEOUT_MS,
): string | null {
  const result = spawnSync(
    'docker',
    [
      'inspect',
      container,
      '--format',
      `{{(index (index .NetworkSettings.Ports "${containerPort}/tcp") 0).HostPort}}`,
    ],
    { encoding: 'utf8', timeout: normalizeTimeoutMs(timeoutMs) },
  );
  if (result.status !== 0) return null;
  const port = result.stdout.trim();
  return /^\d+$/.test(port) ? port : null;
}

function normalizeTimeoutMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_DOCKER_INSPECT_TIMEOUT_MS;
  return Math.trunc(value);
}

function localUrl(port: string, protocol = 'http'): string {
  return `${protocol}://localhost:${port}`;
}

function withDevelopmentCondition(input: string | undefined): string {
  const parts = input?.split(/\s+/).filter(Boolean) ?? [];
  if (!parts.includes('--conditions=development')) parts.push('--conditions=development');
  return parts.join(' ');
}

export function buildE2eEnv(input: Env = process.env, options: BuildE2eEnvOptions = {}): Env {
  const env = { ...input };
  delete env.NO_COLOR;

  const useDockerPorts = env.E2E_USE_DOCKER_PORTS !== '0';
  const lookupPort =
    options.publishedPort ??
    ((container, port) => publishedPort(container, port, options.dockerInspectTimeoutMs));
  const postgresPort = useDockerPorts ? lookupPort('timeline-e2e-postgres-1', 5432) : null;
  const redisPort = useDockerPorts ? lookupPort('timeline-e2e-redis-1', 6379) : null;
  const rustfsPort = useDockerPorts ? lookupPort('timeline-e2e-rustfs-1', 9000) : null;
  const qdrantPort = useDockerPorts ? lookupPort('timeline-e2e-qdrant-1', 6333) : null;

  env.DATABASE_URL ??= postgresPort
    ? `postgres://timeline:timeline_dev@localhost:${postgresPort}/timeline`
    : 'postgres://timeline:timeline_dev@localhost:5432/timeline';
  env.AUTH_SECRET ??= 'e2e-auth-secret-at-least-sixteen-characters';
  env.SECRETS_ENCRYPTION_KEY ??= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  env.REDIS_URL ??= redisPort ? localUrl(redisPort, 'redis') : 'redis://localhost:6379';
  env.S3_ENDPOINT ??= rustfsPort ? localUrl(rustfsPort) : 'http://localhost:9000';
  env.S3_PUBLIC_ENDPOINT ??= env.S3_ENDPOINT;
  env.S3_REGION ??= 'us-east-1';
  env.S3_ACCESS_KEY_ID ??= 'timeline';
  env.S3_SECRET_ACCESS_KEY ??= 'timeline_dev_secret';
  env.S3_FORCE_PATH_STYLE ??= 'true';
  env.S3_BUCKET_DOCUMENTS ??= 'timeline-documents';
  env.S3_BUCKET_EXPORTS ??= 'timeline-exports';
  env.E2E_DETERMINISTIC_CHAT ??= '1';
  env.E2E_DETERMINISTIC_EMBEDDINGS ??= 'true';
  env.E2E_DETERMINISTIC_SLACK_API ??= '1';
  env.OPENROUTER_API_KEY ??= 'e2e-deterministic-chat';
  env.QDRANT_URL ??= qdrantPort ? localUrl(qdrantPort) : 'http://qdrant.e2e.invalid';
  env.QDRANT_API_KEY ??= 'dev_qdrant_key';
  env.NODE_OPTIONS = withDevelopmentCondition(env.NODE_OPTIONS);
  return env;
}
