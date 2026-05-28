import postgres from 'postgres';

const silenceNotices = (): void => undefined;

export function postgresResetStatements(): string[] {
  return [
    `SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()`,
    'DROP SCHEMA IF EXISTS public CASCADE',
    'DROP SCHEMA IF EXISTS drizzle CASCADE',
    'CREATE SCHEMA public',
    'GRANT ALL ON SCHEMA public TO public',
    'GRANT ALL ON SCHEMA public TO CURRENT_USER',
  ];
}

export async function resetPostgresSchema(url = process.env.DATABASE_URL): Promise<void> {
  if (!url) throw new Error('DATABASE_URL is required');

  const client = postgres(url, { max: 1, onnotice: silenceNotices });
  try {
    for (const statement of postgresResetStatements()) {
      await client.unsafe(statement);
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}
