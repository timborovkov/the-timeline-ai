import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATION_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../drizzle/0064_chat_message_sequence.sql',
);

describe('chat message sequence migration', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE TABLE chat_messages (
        id uuid PRIMARY KEY,
        session_id uuid NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE INDEX chat_messages_session_created_idx
      ON chat_messages (session_id, created_at);

      INSERT INTO chat_messages (id, session_id, created_at) VALUES
        (
          '22222222-2222-4222-8222-222222222222',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          '2026-01-02T00:00:00.000Z'
        ),
        (
          '11111111-1111-4111-8111-111111111111',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          '2026-01-01T00:00:00.000Z'
        );
    `);
    const statements = readFileSync(MIGRATION_PATH, 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) await pg.exec(statement);
  });

  afterAll(async () => {
    await pg.close();
  });

  it('backfills existing rows chronologically and advances the insert sequence', async () => {
    const existing = await pg.query<{ id: string; sequence: string }>(`
      SELECT id, sequence::text
      FROM chat_messages
      ORDER BY sequence
    `);
    expect(existing.rows).toEqual([
      { id: '11111111-1111-4111-8111-111111111111', sequence: '1' },
      { id: '22222222-2222-4222-8222-222222222222', sequence: '2' },
    ]);

    await pg.exec(`
      INSERT INTO chat_messages (id, session_id, created_at)
      VALUES (
        '33333333-3333-4333-8333-333333333333',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '2026-01-03T00:00:00.000Z'
      );
    `);
    const inserted = await pg.query<{ sequence: string }>(`
      SELECT sequence::text
      FROM chat_messages
      WHERE id = '33333333-3333-4333-8333-333333333333'
    `);
    expect(inserted.rows).toEqual([{ sequence: '3' }]);
  });
});
