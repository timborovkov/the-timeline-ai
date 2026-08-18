import { PGlite } from '@electric-sql/pglite';
import { type Db, documentChunks, documents, documentVersions } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  listRelatedCuratedDocumentChunks,
  namesMentionedInText,
  relatedDocumentChunkCitation,
} from '#src/documents/related-chunks.js';
import { applyDbMigrations } from '#src/test/pglite.js';

type AnyDb = Db;

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEAM = '22222222-2222-2222-2222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function seedTeam(pg: PGlite): Promise<void> {
  await pg.exec(`INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 't', 'Test Team');`);
  await pg.exec(`INSERT INTO teams (id, slug, name) VALUES ('${OTHER_TEAM}', 'o', 'Other');`);
  await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_A}', 'a@test.local');`);
  await pg.exec(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_A}', 'owner');`,
  );
}

async function insertChunkedDocument(
  db: AnyDb,
  input: {
    teamId: string;
    name: string;
    text: string;
    fileKind?: 'document' | 'captured';
    visibility?: 'team' | 'private';
  },
): Promise<{ documentId: string; chunkId: string; version: number }> {
  const [document] = await db
    .insert(documents)
    .values({
      teamId: input.teamId,
      ownerUserId: USER_A,
      name: input.name,
      fileKind: input.fileKind ?? 'document',
      visibility: input.visibility ?? 'team',
    })
    .returning({ id: documents.id });
  if (!document) throw new Error('failed to insert document');
  const [version] = await db
    .insert(documentVersions)
    .values({
      teamId: input.teamId,
      documentId: document.id,
      version: 1,
      objectKey: `${input.teamId}/${document.id}/v1/${input.name}`,
      contentType: 'application/pdf',
    })
    .returning({ id: documentVersions.id });
  if (!version) throw new Error('failed to insert version');
  await db
    .update(documents)
    .set({ currentVersionId: version.id })
    .where(eq(documents.id, document.id));
  const [chunk] = await db
    .insert(documentChunks)
    .values({
      teamId: input.teamId,
      documentId: document.id,
      documentVersionId: version.id,
      chunkIndex: 0,
      text: input.text,
      tokenCount: 12,
    })
    .returning({ id: documentChunks.id });
  if (!chunk) throw new Error('failed to insert chunk');
  return { documentId: document.id, chunkId: chunk.id, version: 1 };
}

let pg: PGlite;
let db: AnyDb;

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  await seedTeam(pg);
  db = drizzle(pg) as unknown as AnyDb;
});

afterEach(async () => {
  await pg.close();
});

describe('listRelatedCuratedDocumentChunks', () => {
  it('returns team-visible curated chunks that mention the hub name', async () => {
    const hit = await insertChunkedDocument(db, {
      teamId: TEAM_ID,
      name: 'Acme MSA.pdf',
      text: 'Payment terms for Acme Labs are net 30.',
    });
    await insertChunkedDocument(db, {
      teamId: TEAM_ID,
      name: 'Unrelated handbook.pdf',
      text: 'Office wifi password is posted on the fridge.',
    });
    await insertChunkedDocument(db, {
      teamId: TEAM_ID,
      name: 'acme-whiteboard.png',
      text: 'Acme whiteboard photo',
      fileKind: 'captured',
    });
    await insertChunkedDocument(db, {
      teamId: TEAM_ID,
      name: 'Private Acme notes.pdf',
      text: 'Secret Acme pricing',
      visibility: 'private',
    });

    const rows = await listRelatedCuratedDocumentChunks({
      db,
      teamId: TEAM_ID,
      names: ['Acme Labs'],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        documentId: hit.documentId,
        chunkId: hit.chunkId,
        documentName: 'Acme MSA.pdf',
        version: 1,
      }),
    ]);
    const first = rows[0];
    expect(first).toBeDefined();
    if (!first) throw new Error('expected related document chunk');
    expect(relatedDocumentChunkCitation(first)).toBe(
      `[doc:${hit.documentId}#v1:chunk:${hit.chunkId}]`,
    );
  });

  it('does not leak another team document', async () => {
    await insertChunkedDocument(db, {
      teamId: OTHER_TEAM,
      name: 'Acme MSA.pdf',
      text: 'Payment terms for Acme Labs are net 30.',
    });

    await expect(
      listRelatedCuratedDocumentChunks({
        db,
        teamId: TEAM_ID,
        names: ['Acme Labs'],
      }),
    ).resolves.toEqual([]);
  });
});

describe('namesMentionedInText', () => {
  it('keeps only names that appear as whole tokens', () => {
    expect(
      namesMentionedInText('Follow the Acme Labs MSA payment terms', ['Acme Labs', 'DFK', 'API']),
    ).toEqual(['Acme Labs']);
  });
});
