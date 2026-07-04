import { PGlite } from '@electric-sql/pglite';
import {
  type Db,
  documentVersions,
  documents,
  rawEvents,
  reconciliationEvidence,
} from '@timeline/db';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyDbMigrations } from '#src/test/pglite.js';
import {
  harvestIntegrationDocument,
  type IntegrationDocumentHarvestIO,
} from '#src/workers/integrationSync.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333';

type TestDb = ReturnType<typeof drizzle>;

function fakeIO(): IntegrationDocumentHarvestIO {
  return {
    getDocumentsBucket: () => 'documents',
    putDocumentObject: vi.fn().mockResolvedValue(undefined),
    enqueueDocumentExtractJob: vi.fn().mockResolvedValue(undefined),
  };
}

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'integration-harvest', 'Integration Harvest');

    INSERT INTO users (id, email)
    VALUES ('${USER_ID}', 'integration-harvest@example.com');

    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
}

async function loadDocuments(db: TestDb) {
  return db.select().from(documents).orderBy(asc(documents.createdAt), asc(documents.id));
}

async function loadVersions(db: TestDb) {
  return db
    .select()
    .from(documentVersions)
    .orderBy(asc(documentVersions.version), asc(documentVersions.id));
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

async function harvest(
  db: TestDb,
  io: IntegrationDocumentHarvestIO,
  input: { filename?: string; body?: Buffer } = {},
) {
  return harvestIntegrationDocument({
    db: db as never as Db,
    integration: {
      id: INTEGRATION_ID,
      teamId: TEAM_ID,
      provider: 'monday',
    },
    harvestUserId: USER_ID,
    document: {
      filename: input.filename ?? 'Roadmap.pdf',
      contentType: 'application/pdf',
      body: input.body ?? Buffer.from('%PDF roadmap v1'),
      externalId: 'monday-doc-1',
      metadata: { board_id: 'board-1' },
    },
    io,
  });
}

describe('integration document harvest', () => {
  let pg: PGlite;
  let db: TestDb;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  }, 60_000);

  afterEach(async () => {
    await pg.close();
  });

  it('creates a provider-backed document, uploads bytes, finalizes the version, and queues extraction', async () => {
    const io = fakeIO();

    const result = await harvest(db, io);

    const [document] = await loadDocuments(db);
    expect(result.documentId).toBe(document?.id);
    expect(document).toMatchObject({
      teamId: TEAM_ID,
      ownerUserId: USER_ID,
      name: 'Roadmap.pdf',
      fileKind: 'document',
      visibility: 'team',
    });
    expect(document?.metadata).toMatchObject({
      integration_id: INTEGRATION_ID,
      integration_provider: 'monday',
      integration_external_id: 'monday-doc-1',
      board_id: 'board-1',
    });

    const [version] = await loadVersions(db);
    if (!version || !document) throw new Error('harvest did not create document/version rows');
    expect(version).toMatchObject({
      documentId: document.id,
      version: 1,
      byteSize: Buffer.byteLength('%PDF roadmap v1'),
      contentType: 'application/pdf',
      processingStatus: 'pending',
      uploadedByUserId: USER_ID,
    });
    expect(version.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(version.sourceEventId).toEqual(expect.any(String));
    expect(document.currentVersionId).toBe(version.id);
    expect(result.versionId).toBe(version.id);

    expect(io.putDocumentObject).toHaveBeenCalledWith({
      bucket: 'documents',
      key: version.objectKey,
      body: Buffer.from('%PDF roadmap v1'),
      contentType: 'application/pdf',
    });
    expect(io.enqueueDocumentExtractJob).toHaveBeenCalledWith({
      documentVersionId: version.id,
      teamId: TEAM_ID,
    });

    const sourceEventId = version.sourceEventId;
    if (!sourceEventId) throw new Error('missing source event id');
    const eventRows = await db.select().from(rawEvents).where(eq(rawEvents.id, sourceEventId));
    const event = eventRows[0];
    if (!event) throw new Error('missing document upload event');
    expect(event).toMatchObject({
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'document',
      visibility: 'team',
      contentText: 'Uploaded Roadmap.pdf',
    });
    const metadata = asRecord(event.sourceMetadata, 'source metadata');
    expect(metadata.action).toBe('upload');
    expect(metadata.document_id).toBe(document.id);
    expect(metadata.document_version_id).toBe(version.id);
    expect(metadata.integration_id).toBe(INTEGRATION_ID);
    expect(metadata.integration_provider).toBe('monday');
    expect(metadata.integration_external_id).toBe('monday-doc-1');
    expect(metadata.source_payload_ref).toBe(`s3://documents/${version.objectKey}`);
    expect(metadata.payload_digest).toBe(`sha256:${version.checksumSha256}`);
    expect(metadata).not.toHaveProperty('source_payload_digest');
    expect(metadata.source_snapshot_kind).toBe('integration_harvest_document');
    expect(metadata.source_snapshot_version).toBe('integration-document-source-snapshot-2026-07');
    expect(asRecord(metadata.source_snapshot, 'source snapshot')).toMatchObject({
      provider: 'monday',
      integrationId: INTEGRATION_ID,
      externalObjectId: 'monday-doc-1',
      filename: 'Roadmap.pdf',
      contentType: 'application/pdf',
      byteSize: Buffer.byteLength('%PDF roadmap v1'),
      checksumSha256: version.checksumSha256,
      objectKey: version.objectKey,
      metadata: { board_id: 'board-1' },
    });
    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, sourceEventId));
    expect(evidence).toMatchObject({
      rawEventId: sourceEventId,
      source: 'document',
      provider: 'document',
      sourcePayloadRef: `s3://documents/${version.objectKey}`,
      payloadDigest: `sha256:${version.checksumSha256}`,
      replayState: 'full',
    });
  });

  it('re-harvests the same provider id as a new version of the existing document', async () => {
    const io = fakeIO();

    const first = await harvest(db, io);
    const second = await harvest(db, io, {
      filename: 'Roadmap-v2.pdf',
      body: Buffer.from('%PDF roadmap v2 with more detail'),
    });

    expect(second.documentId).toBe(first.documentId);
    expect(second.versionId).not.toBe(first.versionId);

    const documentRows = await loadDocuments(db);
    expect(documentRows).toHaveLength(1);
    const versions = await loadVersions(db);
    expect(versions.map((version) => version.version)).toEqual([1, 2]);
    expect(documentRows[0]?.currentVersionId).toBe(versions[1]?.id);
    expect(versions[1]).toMatchObject({
      documentId: first.documentId,
      byteSize: Buffer.byteLength('%PDF roadmap v2 with more detail'),
      contentType: 'application/pdf',
      processingStatus: 'pending',
      uploadedByUserId: USER_ID,
    });
    expect(versions[1]?.objectKey).toContain('/v2/');

    expect(io.putDocumentObject).toHaveBeenCalledTimes(2);
    expect(io.enqueueDocumentExtractJob).toHaveBeenNthCalledWith(1, {
      documentVersionId: first.versionId,
      teamId: TEAM_ID,
    });
    expect(io.enqueueDocumentExtractJob).toHaveBeenNthCalledWith(2, {
      documentVersionId: second.versionId,
      teamId: TEAM_ID,
    });

    const eventRows = await db.select().from(rawEvents).orderBy(asc(rawEvents.createdAt));
    expect(eventRows.map((event) => event.contentText)).toEqual([
      'Uploaded Roadmap.pdf',
      'Uploaded new version (v2) of Roadmap.pdf',
    ]);
  });
});
