import { createHash } from 'node:crypto';
import {
  type Db,
  websiteSources,
  documents,
  documentVersions,
  documentChunks,
  rawEvents,
} from '@timeline/db';
import { and, eq, sql } from 'drizzle-orm';
import { assertTeamWriteCapacity } from '#src/billing/capacity.js';
import { chunkText } from '#src/chunk.js';
import { buildDocumentObjectKey } from '#src/documents/object-key.js';
import { getDocumentsBucket, getS3Client } from '#src/s3/client.js';
import { putObject } from '#src/s3/objects.js';
import type { WebsiteSubject } from '#src/onboarding/first-run.js';
import type { WebsiteScanPage } from '#src/onboarding/website-scan.js';
import type { TeamRole } from '#src/team-scope.js';

export function createWebsiteSourceHandlers({
  db,
  teamId,
  userId,
  ensureMember,
}: {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (minRole?: TeamRole) => Promise<TeamRole>;
}) {
  return {
    async getWebsiteCrawlId(scanId: string): Promise<string | null> {
      await ensureMember();
      const [source] = await db
        .select({ crawlId: websiteSources.crawlId })
        .from(websiteSources)
        .where(and(eq(websiteSources.teamId, teamId), eq(websiteSources.id, scanId)))
        .limit(1);
      return source?.crawlId ?? null;
    },
    async saveWebsiteCrawlId(input: {
      scanId: string;
      url: string;
      websiteSubject: WebsiteSubject;
      crawlId: string;
    }): Promise<void> {
      await ensureMember();
      await db
        .insert(websiteSources)
        .values({
          id: input.scanId,
          teamId,
          url: input.url,
          websiteSubject: input.websiteSubject,
          crawlId: input.crawlId,
        })
        .onConflictDoNothing();
    },
    async getWebsiteScanPages(scanId: string): Promise<WebsiteScanPage[] | null> {
      await ensureMember();
      const [source] = await db
        .select()
        .from(websiteSources)
        .where(and(eq(websiteSources.teamId, teamId), eq(websiteSources.id, scanId)))
        .limit(1);
      return source?.pages ?? null;
    },
    async saveWebsiteScanPages(input: {
      scanId: string;
      url: string;
      websiteSubject: WebsiteSubject;
      pages: WebsiteScanPage[];
    }): Promise<WebsiteScanPage[]> {
      await ensureMember();
      await db
        .insert(websiteSources)
        .values({
          id: input.scanId,
          teamId,
          url: input.url,
          websiteSubject: input.websiteSubject,
          pages: input.pages,
        })
        .onConflictDoNothing();
      const [source] = await db
        .select()
        .from(websiteSources)
        .where(and(eq(websiteSources.teamId, teamId), eq(websiteSources.id, input.scanId)))
        .limit(1);
      if (!source) throw new Error('Website source not found');
      if (source.pages) return source.pages;
      const [saved] = await db
        .update(websiteSources)
        .set({ pages: input.pages })
        .where(
          and(
            eq(websiteSources.teamId, teamId),
            eq(websiteSources.id, input.scanId),
            sql`${websiteSources.pages} IS NULL`,
          ),
        )
        .returning();
      if (saved?.pages) return saved.pages;
      const [current] = await db
        .select()
        .from(websiteSources)
        .where(and(eq(websiteSources.teamId, teamId), eq(websiteSources.id, input.scanId)))
        .limit(1);
      if (!current?.pages) throw new Error('Website snapshot unavailable');
      return current.pages;
    },
    async saveWebsitePageDocument(input: {
      scanId: string;
      eventId: string;
      page: WebsiteScanPage;
    }): Promise<{ documentId: string; chunkIds: string[] }> {
      await ensureMember();
      // The source event and immutable crawl cache must both belong to this team.
      const [source] = await db
        .select()
        .from(websiteSources)
        .where(and(eq(websiteSources.teamId, teamId), eq(websiteSources.id, input.scanId)))
        .limit(1);
      const page = source?.pages?.find((p) => p.url === input.page.url);
      if (!page) throw new Error('Website page not found');
      const [event] = await db
        .select({ id: rawEvents.id })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.teamId, teamId),
            eq(rawEvents.id, input.eventId),
            sql`${rawEvents.sourceMetadata}->>'websiteScanId' = ${input.scanId}`,
          ),
        )
        .limit(1);
      if (!event) throw new Error('Website event not found');
      const body = Buffer.from(page.text, 'utf8');
      const chunks = chunkText(page.text);
      const stored = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${teamId}, 1))`);
        const [existing] = await tx
          .select({
            documentId: documents.id,
            versionId: documentVersions.id,
            objectKey: documentVersions.objectKey,
          })
          .from(documents)
          .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
          .where(
            and(
              eq(documents.teamId, teamId),
              eq(documents.sourceRawEventId, input.eventId),
              eq(documentVersions.version, 1),
              eq(documentVersions.sourceEventId, input.eventId),
            ),
          )
          .limit(1);
        if (existing) return existing;
        await assertTeamWriteCapacity({
          db: tx as unknown as Db,
          teamId,
          additionalDocuments: 1,
          additionalBytes: body.length,
          additionalChunks: chunks.length,
        });
        const [doc] = await tx
          .insert(documents)
          .values({
            teamId,
            fileKind: 'captured',
            name: `${page.title}.md`,
            ownerUserId: userId,
            visibility: 'team',
            sourceRawEventId: input.eventId,
            metadata: { source: 'web', pageUrl: page.url, websiteScanId: input.scanId },
          })
          .returning();
        if (!doc) throw new Error('Failed to save website document');
        const objectKey = buildDocumentObjectKey({
          teamId,
          documentId: doc.id,
          version: 1,
          filename: 'page.md',
        });
        const [version] = await tx
          .insert(documentVersions)
          .values({
            teamId,
            documentId: doc.id,
            version: 1,
            objectKey,
            byteSize: body.length,
            contentType: 'text/markdown',
            checksumSha256: createHash('sha256').update(body).digest('hex'),
            uploadedByUserId: userId,
            sourceEventId: input.eventId,
            processingStatus: 'pending',
          })
          .returning();
        if (!version) throw new Error('Failed to save website version');
        return { documentId: doc.id, versionId: version.id, objectKey };
      });
      // Retried writes contain the same cached bytes at the same versioned key.
      await putObject(getS3Client(), {
        bucket: getDocumentsBucket(),
        key: stored.objectKey,
        body,
        contentType: 'text/markdown',
      });
      await db.transaction(async (tx) => {
        if (chunks.length)
          await tx
            .insert(documentChunks)
            .values(
              chunks.map((chunk) => ({
                teamId,
                documentId: stored.documentId,
                documentVersionId: stored.versionId,
                chunkIndex: chunk.index,
                text: chunk.text,
                tokenCount: chunk.tokenCount,
              })),
            )
            .onConflictDoNothing();
        await tx
          .update(documentVersions)
          .set({ processingStatus: 'chunked' })
          .where(
            and(
              eq(documentVersions.teamId, teamId),
              eq(documentVersions.id, stored.versionId),
              eq(documentVersions.processingStatus, 'pending'),
            ),
          );
        await tx
          .update(documents)
          .set({ currentVersionId: stored.versionId })
          .where(
            and(
              eq(documents.teamId, teamId),
              eq(documents.id, stored.documentId),
              sql`${documents.currentVersionId} IS NULL`,
            ),
          );
      });
      const rows = await db
        .select({ id: documentChunks.id })
        .from(documentChunks)
        .where(
          and(
            eq(documentChunks.teamId, teamId),
            eq(documentChunks.documentVersionId, stored.versionId),
          ),
        );
      return { documentId: stored.documentId, chunkIds: rows.map((r) => r.id) };
    },
  };
}
