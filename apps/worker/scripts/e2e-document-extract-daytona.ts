/**
 * Live end-to-end smoke: create curated document → S3 put → finalize →
 * processDocumentExtractJob with real Daytona + (optional) vision IO.
 *
 * Usage:
 *   set -a; . ./.env; set +a
 *   NODE_OPTIONS=--conditions=development pnpm exec tsx apps/worker/scripts/e2e-document-extract-daytona.ts [pdf|docx|queue] [fixturePath]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDb, documentChunks, documentVersions, getDb } from '@timeline/db';
import {
  getDocumentsBucket,
  getObjectBuffer,
  getS3Client,
  llm,
  putObject,
  queue,
  withTeam,
} from '@timeline/shared';
import { eq } from 'drizzle-orm';

// Relative imports: this file lives under scripts/ (outside tsconfig rootDir),
// so the package `#src/*` map would resolve to dist/ and break knip/CI when
// dist is absent. Source-relative paths stay analyzable.
import {
  extractDocxForDocument,
  extractPdfForDocument,
} from '../src/document-ingestion/pdf-extraction.js';
import { processDocumentExtractJob } from '../src/workers/documentExtract.js';

const TEAM_ID = '20000000-0000-4000-8000-000000000001';
const OWNER_ID = '10000000-0000-4000-8000-000000000001';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PDF = join(HERE, '../test/fixtures/pdfs/text-based-dummy.pdf');

type Mode = 'pdf' | 'docx' | 'queue';

function parseArgs(): { mode: Mode; fixturePath: string } {
  const mode = (process.argv[2] ?? 'pdf') as Mode;
  if (mode !== 'pdf' && mode !== 'docx' && mode !== 'queue') {
    throw new Error(`unsupported mode ${mode}`);
  }
  const fixturePath = process.argv[3] ?? (mode === 'docx' ? '/tmp/dense-e2e.docx' : DEFAULT_PDF);
  return { mode, fixturePath };
}

function realExtractIO(stubEmbed: boolean) {
  return {
    async fetchBlob(objectKey: string, maxBytes: number) {
      return getObjectBuffer(getS3Client(), getDocumentsBucket(), objectKey, maxBytes);
    },
    async enqueueEmbed(data: queue.EmbedJobData) {
      if (stubEmbed) {
        console.log(JSON.stringify({ step: 'embed_enqueued_stub', ...data }));
        return;
      }
      await queue.enqueueEmbedJob(data);
    },
    requireEnv() {
      if (!process.env.OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY required for vision fallback');
      }
    },
    async extractFromMedia(input: {
      body: Buffer;
      mediaType: string;
      filename: string;
      pageImages?: Buffer[];
    }) {
      return llm.extractTextFromMedia(input);
    },
    async extractDocx(bodyBuf: Buffer) {
      const out = await extractDocxForDocument(bodyBuf);
      return { text: out.text };
    },
    async extractPdfSandbox(bodyBuf: Buffer) {
      return extractPdfForDocument(bodyBuf);
    },
  };
}

async function createAndUpload(input: {
  name: string;
  filename: string;
  contentType: string;
  body: Buffer;
}): Promise<{ documentId: string; versionId: string; objectKey: string }> {
  const db = getDb();
  const scope = withTeam(db, TEAM_ID, OWNER_ID);
  const created = await scope.documents.createDocument({
    name: input.name,
    folderId: null,
    filename: input.filename,
    contentType: input.contentType,
    visibility: 'team',
  });
  await putObject(getS3Client(), {
    bucket: getDocumentsBucket(),
    key: created.version.objectKey,
    body: input.body,
    contentType: input.contentType,
  });
  const finalized = await scope.documents.finalizeDocumentVersion({
    versionId: created.version.id,
    byteSize: input.body.byteLength,
    contentType: input.contentType,
  });
  return {
    documentId: finalized.document.id,
    versionId: finalized.version.id,
    objectKey: finalized.version.objectKey,
  };
}

async function waitForChunked(versionId: string, timeoutMs: number): Promise<void> {
  const db = getDb();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const [version] = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, versionId))
      .limit(1);
    if (version?.processingStatus === 'chunked' || version?.processingStatus === 'embedded') {
      return;
    }
    if (version?.processingStatus === 'failed') {
      throw new Error(`extract failed: ${version.processingError ?? 'unknown'}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for chunked status after ${String(timeoutMs)}ms`);
}

async function printSummary(versionId: string, result?: unknown): Promise<void> {
  const db = getDb();
  const [version] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId))
    .limit(1);
  const chunks = await db
    .select()
    .from(documentChunks)
    .where(eq(documentChunks.documentVersionId, versionId));
  console.log(
    JSON.stringify(
      {
        step: 'extract_done',
        result: result ?? null,
        processingStatus: version?.processingStatus,
        processingError: version?.processingError,
        extractionModelVersion: version?.extractionModelVersion,
        chunkCount: chunks.length,
        chunks: chunks.map((c) => ({
          index: c.chunkIndex,
          kind: c.representationKind,
          textPreview: c.text.slice(0, 160),
          tokenCount: c.tokenCount,
        })),
      },
      null,
      2,
    ),
  );
  if (version?.processingStatus !== 'chunked' && version?.processingStatus !== 'embedded') {
    throw new Error(
      `expected chunked/embedded, got ${version?.processingStatus ?? 'missing'}: ${version?.processingError ?? ''}`,
    );
  }
  if (chunks.length < 1) {
    throw new Error('expected at least one document_chunk');
  }
}

async function main(): Promise<void> {
  const { mode, fixturePath } = parseArgs();
  const body = readFileSync(fixturePath);
  const isDocx = mode === 'docx' || fixturePath.endsWith('.docx');
  const contentType = isDocx
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/pdf';
  const filename = isDocx ? 'daytona-e2e.docx' : 'daytona-e2e.pdf';

  const uploaded = await createAndUpload({
    name: `daytona-e2e-${mode}-${Date.now()}.${isDocx ? 'docx' : 'pdf'}`,
    filename,
    contentType,
    body,
  });
  console.log(
    JSON.stringify({
      step: 'finalized',
      mode,
      fixturePath,
      ...uploaded,
      byteSize: body.byteLength,
    }),
  );

  if (mode === 'queue') {
    // Leave version pending; enqueue for the extract-main consumer.
    await getDb()
      .update(documentVersions)
      .set({ processingStatus: 'pending', processingError: null })
      .where(eq(documentVersions.id, uploaded.versionId));
    await queue.enqueueDocumentExtractJob({
      documentVersionId: uploaded.versionId,
      teamId: TEAM_ID,
    });
    console.log(JSON.stringify({ step: 'enqueued', versionId: uploaded.versionId }));
    await waitForChunked(uploaded.versionId, 180_000);
    await printSummary(uploaded.versionId);
  } else {
    const db = getDb();
    const result = await processDocumentExtractJob(
      { db },
      { documentVersionId: uploaded.versionId, teamId: TEAM_ID },
      realExtractIO(true),
    );
    await printSummary(uploaded.versionId, result);
  }

  await queue.closeDocumentExtractQueue().catch(() => undefined);
  await queue.closeEmbedQueue().catch(() => undefined);
  await queue.closeRedisConnection().catch(() => undefined);
  await closeDb();
}

main().catch(async (err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  try {
    await queue.closeDocumentExtractQueue().catch(() => undefined);
    await queue.closeEmbedQueue().catch(() => undefined);
    await queue.closeRedisConnection().catch(() => undefined);
    await closeDb();
  } catch {
    // ignore
  }
  process.exit(1);
});
