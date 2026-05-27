import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTeamExportArchive } from './index.js';

type AnyDb = Db;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../db/drizzle');

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const OWNER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TEAM_EVENT_ID = '22222222-2222-2222-2222-222222222222';
const PRIVATE_EVENT_ID = '33333333-3333-3333-3333-333333333333';
const DOC_ID = '44444444-4444-4444-4444-444444444444';
const PRIVATE_DOC_ID = '55555555-5555-5555-5555-555555555555';
const FOLDER_ID = '77777777-7777-7777-7777-777777777777';
const PRIVATE_FOLDER_ID = '88888888-8888-8888-8888-888888888888';
const MEETING_ID = '99999999-0000-0000-0000-000000000001';
const PRIVATE_MEETING_ID = '99999999-0000-0000-0000-000000000002';
const CALENDAR_EVENT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRIVATE_CALENDAR_EVENT_ID = 'aaaaaaaa-0000-0000-0000-000000000002';

async function applyMigrations(pg: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'SELECT 1;');
    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }
}

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 't', 'Test Team');
    INSERT INTO users (id, email) VALUES
      ('${OWNER_ID}', 'owner@test.local'),
      ('${OTHER_ID}', 'other@test.local');
    INSERT INTO team_members (team_id, user_id, role) VALUES
      ('${TEAM_ID}', '${OWNER_ID}', 'owner'),
      ('${TEAM_ID}', '${OTHER_ID}', 'member');

    INSERT INTO raw_events (
      id, team_id, author_user_id, source, content_text, content_audio_url,
      visibility, source_metadata
    ) VALUES
      (
        '${TEAM_EVENT_ID}', '${TEAM_ID}', '${OWNER_ID}', 'email', 'visible event',
        'audio/team.ogg', 'team',
        '{"attachments":[{"filename":"deck.pdf","bucket":"attachments","key":"email/deck.pdf","size_bytes":10,"content_type":"application/pdf"}]}'::jsonb
      ),
      (
        '${PRIVATE_EVENT_ID}', '${TEAM_ID}', '${OTHER_ID}', 'web', 'hidden event',
        null, 'private', '{}'::jsonb
      );

    INSERT INTO facts (team_id, raw_event_id, statement, confidence, model_version) VALUES
      ('${TEAM_ID}', '${TEAM_EVENT_ID}', 'visible fact', 0.9, 'test'),
      ('${TEAM_ID}', '${PRIVATE_EVENT_ID}', 'hidden fact', 0.9, 'test');

    INSERT INTO documents (id, team_id, name, owner_user_id, visibility) VALUES
      ('${DOC_ID}', '${TEAM_ID}', 'Visible.pdf', '${OWNER_ID}', 'team'),
      ('${PRIVATE_DOC_ID}', '${TEAM_ID}', 'Private.pdf', '${OTHER_ID}', 'private');
    INSERT INTO document_versions (team_id, document_id, version, object_key, uploaded_by_user_id)
      VALUES
        ('${TEAM_ID}', '${DOC_ID}', 1, 'docs/visible.pdf', '${OWNER_ID}'),
        ('${TEAM_ID}', '${PRIVATE_DOC_ID}', 1, 'docs/private.pdf', '${OTHER_ID}');

    INSERT INTO folders (id, team_id, name, owner_user_id, visibility) VALUES
      ('${FOLDER_ID}', '${TEAM_ID}', 'Visible folder', '${OWNER_ID}', 'team'),
      ('${PRIVATE_FOLDER_ID}', '${TEAM_ID}', 'Private folder', '${OTHER_ID}', 'private');

    INSERT INTO meetings (
      id, team_id, created_by_user_id, platform, meeting_url, title, default_visibility
    ) VALUES
      (
        '${MEETING_ID}', '${TEAM_ID}', '${OWNER_ID}', 'meet',
        'https://meet.test/visible', 'Visible meeting', 'team'
      ),
      (
        '${PRIVATE_MEETING_ID}', '${TEAM_ID}', '${OTHER_ID}', 'meet',
        'https://meet.test/private', 'Private meeting', 'private'
      );

    INSERT INTO calendar_events (
      id, team_id, created_by_user_id, title, start_at, end_at, visibility
    ) VALUES
      (
        '${CALENDAR_EVENT_ID}', '${TEAM_ID}', '${OWNER_ID}', 'Visible calendar',
        '2026-05-27T10:00:00.000Z', '2026-05-27T11:00:00.000Z', 'team'
      ),
      (
        '${PRIVATE_CALENDAR_EVENT_ID}', '${TEAM_ID}', '${OTHER_ID}', 'Private calendar',
        '2026-05-27T12:00:00.000Z', '2026-05-27T13:00:00.000Z', 'private'
      );

    INSERT INTO integrations (
      team_id, connected_by_user_id, provider, display_name, external_account_id,
      auth_secret_ciphertext, auth_secret_iv, auth_secret_tag
    ) VALUES (
      '${TEAM_ID}', '${OWNER_ID}', 'github', 'GitHub', 'installation-1',
      decode('aaaa', 'hex'), decode('bbbbbbbbbbbbbbbbbbbbbbbb', 'hex'), decode('cccccccccccccccccccccccccccccccc', 'hex')
    );
    INSERT INTO mcp_servers (
      team_id, added_by_user_id, name, url, auth_type,
      auth_config_ciphertext, auth_config_iv, auth_config_tag
    ) VALUES (
      '${TEAM_ID}', '${OWNER_ID}', 'MCP', 'https://mcp.test', 'bearer',
      decode('dddd', 'hex'), decode('eeeeeeeeeeeeeeeeeeeeeeee', 'hex'), decode('ffffffffffffffffffffffffffffffff', 'hex')
    );
  `);
}

function parseJsonl<T = Record<string, unknown>>(body: string): T[] {
  return body
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function zipText(zip: JSZip, name: string): Promise<string> {
  const file = zip.file(name);
  if (!file) throw new Error(`Missing ${name}`);
  return file.async('string');
}

describe('team export archive', () => {
  let pg: PGlite;
  let db: AnyDb;

  beforeEach(async () => {
    pg = new PGlite();
    await applyMigrations(pg);
    db = drizzle(pg) as unknown as AnyDb;
    await seed(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('exports visible data, redacts secrets, and records omitted private rows', async () => {
    const signed: string[] = [];
    const result = await buildTeamExportArchive({
      db,
      teamExportId: '66666666-6666-6666-6666-666666666666',
      teamId: TEAM_ID,
      requestedByUserId: OWNER_ID,
      buckets: {
        attachments: 'attachments',
        audio: 'audio',
        documents: 'documents',
      },
      signFileUrl(input) {
        signed.push(`${input.bucket}/${input.key}/${input.ttlSec}`);
        return Promise.resolve(`https://signed.test/${input.bucket}/${input.key}`);
      },
      now: new Date('2026-05-27T00:00:00.000Z'),
    });

    const zip = await JSZip.loadAsync(result.archive);
    const rawEvents = parseJsonl(await zipText(zip, 'raw_events.jsonl'));
    expect(rawEvents).toHaveLength(1);
    expect(rawEvents[0]?.id).toBe(TEAM_EVENT_ID);

    const facts = parseJsonl(await zipText(zip, 'facts.jsonl'));
    expect(facts.map((row) => row.statement)).toEqual(['visible fact']);

    const docs = parseJsonl(await zipText(zip, 'documents.jsonl'));
    expect(docs.map((row) => row.id)).toEqual([DOC_ID]);

    const folders = parseJsonl(await zipText(zip, 'folders.jsonl'));
    expect(folders.map((row) => row.id)).toEqual([FOLDER_ID]);

    const meetings = parseJsonl(await zipText(zip, 'meetings.jsonl'));
    expect(meetings.map((row) => row.id)).toEqual([MEETING_ID]);

    const calendarEvents = parseJsonl(await zipText(zip, 'calendar_events.jsonl'));
    expect(calendarEvents.map((row) => row.id)).toEqual([CALENDAR_EVENT_ID]);

    const fileRows = parseJsonl(await zipText(zip, 'files.jsonl'));
    expect(fileRows.map((row) => row.kind)).toEqual([
      'document_version',
      'raw_event_audio',
      'email_attachment',
    ]);
    expect(signed).toHaveLength(3);
    expect(result.signedFileCount).toBe(3);

    const integrations = parseJsonl(await zipText(zip, 'integrations.jsonl'));
    const serializedIntegrations = JSON.stringify(integrations);
    expect(serializedIntegrations).not.toContain('authSecretCiphertext');
    expect(serializedIntegrations).not.toContain('authConfigCiphertext');
    expect(integrations.filter((row) => row.secrets_omitted === true)).toHaveLength(2);

    const manifest = JSON.parse(await zipText(zip, 'manifest.json')) as {
      omissions: Record<string, number>;
    };
    expect(manifest.omissions.raw_events).toBe(1);
    expect(manifest.omissions.facts).toBe(1);
    expect(manifest.omissions.folders).toBe(1);
    expect(manifest.omissions.documents).toBe(1);
    expect(manifest.omissions.document_versions).toBe(1);
    expect(manifest.omissions.meetings).toBe(1);
    expect(manifest.omissions.calendar_events).toBe(1);
    expect(manifest.omissions.integration_secrets).toBe(2);
  });
});
