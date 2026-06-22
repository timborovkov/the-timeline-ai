import postgres from 'postgres';

export type PgClient = ReturnType<typeof postgres>;
export type PgClientOptions = postgres.Options<Record<string, postgres.PostgresType>>;

const silenceNotices = (): void => undefined;

export const PG_TIMEOUTS = {
  connectTimeoutSeconds: 10,
  idleTimeoutSeconds: 30,
  maxLifetimeSeconds: 60 * 30,
  lockTimeoutMs: 10_000,
  statementTimeoutMs: 120_000,
  idleInTransactionSessionTimeoutMs: 60_000,
  migratorLockTimeoutMs: 10_000,
  migratorStatementTimeoutMs: 10 * 60_000,
} as const;

type PgApplicationName =
  | 'timeline-web'
  | 'timeline-worker'
  | 'timeline-migrator'
  | 'timeline-migration-waiter'
  | 'timeline-reset'
  | 'timeline-script';

interface BuildPgClientOptionsInput {
  applicationName: PgApplicationName;
  max?: number;
  silenceOperationalNotices?: boolean;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  idleInTransactionSessionTimeoutMs?: number;
}

export function buildPgClientOptions(input: BuildPgClientOptionsInput): PgClientOptions {
  return {
    max: input.max ?? 10,
    connect_timeout: PG_TIMEOUTS.connectTimeoutSeconds,
    idle_timeout: PG_TIMEOUTS.idleTimeoutSeconds,
    max_lifetime: PG_TIMEOUTS.maxLifetimeSeconds,
    ...(input.silenceOperationalNotices ? { onnotice: silenceNotices } : {}),
    connection: {
      application_name: input.applicationName,
      lock_timeout: input.lockTimeoutMs ?? PG_TIMEOUTS.lockTimeoutMs,
      statement_timeout: input.statementTimeoutMs ?? PG_TIMEOUTS.statementTimeoutMs,
      idle_in_transaction_session_timeout:
        input.idleInTransactionSessionTimeoutMs ?? PG_TIMEOUTS.idleInTransactionSessionTimeoutMs,
    },
  };
}

export function createPgClient(url: string, input: BuildPgClientOptionsInput): PgClient {
  return postgres(url, buildPgClientOptions(input));
}
