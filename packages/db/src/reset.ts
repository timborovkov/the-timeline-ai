import postgres from 'postgres';

const silenceNotices = (): void => undefined;

export async function resetPostgresSchema(url = process.env.DATABASE_URL): Promise<void> {
  if (!url) throw new Error('DATABASE_URL is required');

  const client = postgres(url, { max: 1, onnotice: silenceNotices });
  try {
    await client.unsafe(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
    `);
    await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await client.unsafe('CREATE SCHEMA public');
    await client.unsafe('GRANT ALL ON SCHEMA public TO public');
    await client.unsafe('GRANT ALL ON SCHEMA public TO CURRENT_USER');
  } finally {
    await client.end({ timeout: 5 });
  }
}
