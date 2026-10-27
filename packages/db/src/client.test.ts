import { expect } from '@timeline/test-support';
import { vi, freshModuleUrl } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import type * as TestModule1 from '#src/index.js';

import { buildPgClientOptions, PG_TIMEOUTS } from '#src/client.js';
const ENV_BACKUP = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  vi.resetModules();
});

describe('postgres client guardrails', () => {
  it('builds guarded defaults for application pools', () => {
    const options = buildPgClientOptions({ applicationName: 'timeline-web' });

    expect(options).toMatchObject({
      max: 10,
      connect_timeout: PG_TIMEOUTS.connectTimeoutSeconds,
      idle_timeout: PG_TIMEOUTS.idleTimeoutSeconds,
      max_lifetime: PG_TIMEOUTS.maxLifetimeSeconds,
      connection: {
        application_name: 'timeline-web',
        lock_timeout: PG_TIMEOUTS.lockTimeoutMs,
        statement_timeout: PG_TIMEOUTS.statementTimeoutMs,
        idle_in_transaction_session_timeout: PG_TIMEOUTS.idleInTransactionSessionTimeoutMs,
      },
    });
  });

  it('allows migrator pools to use a single connection and longer statements', () => {
    const options = buildPgClientOptions({
      applicationName: 'timeline-migrator',
      max: 1,
      silenceOperationalNotices: true,
      lockTimeoutMs: PG_TIMEOUTS.migratorLockTimeoutMs,
      statementTimeoutMs: PG_TIMEOUTS.migratorStatementTimeoutMs,
    });

    expect(options.max).toBe(1);
    expect(options.onnotice).toEqual(expect.any(Function));
    expect(options.connection).toMatchObject({
      application_name: 'timeline-migrator',
      lock_timeout: PG_TIMEOUTS.migratorLockTimeoutMs,
      statement_timeout: PG_TIMEOUTS.migratorStatementTimeoutMs,
      idle_in_transaction_session_timeout: PG_TIMEOUTS.idleInTransactionSessionTimeoutMs,
    });
  });

  it('labels app pools from the Railway service name', async () => {
    process.env.RAILWAY_SERVICE_NAME = 'timeline-worker-production';

    const { resolveAppApplicationName } = await (import(
      freshModuleUrl(import.meta.resolve('#src/index.js'))
    ) as Promise<typeof TestModule1>);

    expect(resolveAppApplicationName()).toBe('timeline-worker');
  });
});
