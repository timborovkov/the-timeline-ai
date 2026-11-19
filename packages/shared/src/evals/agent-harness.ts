import { createHash } from 'node:crypto';

import { documentChunks, documents, documentVersions, rawEvents } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { askAgent } from '#src/agent/ask.js';
import type { AskAgentDeps } from '#src/agent/ask.js';
import { artifactRefCitation } from '#src/citation.js';
import type { AgentCase } from '#src/evals/agent-cases.js';
import type { AgentObservation } from '#src/evals/agent-report.js';
import { requireValue } from '#src/evals/benchmark.js';
import { buildSearchHit } from '#src/test/agent-eval-harness.js';
import { createResettablePGliteTestDb } from '#src/test/pglite.js';

const TEAM = '11111111-1111-4111-8111-111111111111';
const FOREIGN = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export function evidenceId(caseId: string, index: number) {
  const hex = createHash('sha256').update(`${caseId}:${index}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
/** Sequential only: reset the isolated in-memory database before every case. */
export async function createAgentHarness() {
  const store = await createResettablePGliteTestDb(async (pg) => {
    await pg.exec(`
      INSERT INTO teams (id,slug,name) VALUES ('${TEAM}','benchmark','Synthetic benchmark'),('${FOREIGN}','foreign','Foreign synthetic workspace');
      INSERT INTO users (id,email,name) VALUES ('${USER}','eval@example.test','Evaluator'),('${OTHER}','other@example.test','Other user');
      INSERT INTO team_members (team_id,user_id,role) VALUES ('${TEAM}','${USER}','owner'),('${TEAM}','${OTHER}','member'),('${FOREIGN}','${OTHER}','owner');
    `);
  });
  const db = drizzle(store.pg);
  return {
    close: () => store.close(),
    async run(
      row: AgentCase,
      modelDeps: Pick<AskAgentDeps, 'model'> = {},
      surface: 'web' | 'slack' | 'telegram' = 'web',
    ): Promise<AgentObservation> {
      await store.reset();
      const ids = row.evidence.map((_, index) => evidenceId(row.id, index));
      const documentId = evidenceId(`${row.id}:document`, 0);
      const documentFixture = row.evidence.filter((item) => item.documentVersion !== undefined);
      if (documentFixture.length)
        await db.insert(documents).values({
          id: documentId,
          teamId: TEAM,
          name: 'Lab Safety Manual',
          ownerUserId: USER,
          visibility: 'team',
          fileKind: 'document',
        });
      const citations: string[] = [];
      for (const [index, item] of row.evidence.entries()) {
        const id = requireValue(ids[index]);
        if (item.documentVersion !== undefined) {
          const versionId = evidenceId(`${row.id}:version`, index);
          await db.insert(documentVersions).values({
            id: versionId,
            teamId: TEAM,
            documentId,
            version: item.documentVersion,
            objectKey: `synthetic/${versionId}`,
            processingStatus: 'embedded',
            createdAt: new Date(item.occurredAt),
          });
          await db.insert(documentChunks).values({
            id,
            teamId: TEAM,
            documentId,
            documentVersionId: versionId,
            chunkIndex: 0,
            text: item.text,
            tokenCount: 20,
          });
          if (
            item.documentVersion ===
            Math.max(...documentFixture.map((entry) => entry.documentVersion ?? 0))
          )
            await db
              .update(documents)
              .set({ currentVersionId: versionId })
              .where(eq(documents.id, documentId));
          citations.push(
            artifactRefCitation({
              kind: 'document_chunk',
              id,
              documentId,
              version: item.documentVersion,
              chunkId: id,
            }),
          );
          continue;
        }
        citations.push(artifactRefCitation({ kind: 'timeline_event', id }));
        await db.insert(rawEvents).values({
          id,
          teamId: item.access === 'foreign' ? FOREIGN : TEAM,
          authorUserId: OTHER,
          visibilityOwnerUserId: OTHER,
          source: 'web',
          contentText: item.text,
          occurredAt: new Date(item.occurredAt),
          visibility:
            item.access === 'private'
              ? 'private'
              : item.access === 'restricted'
                ? 'specific_users'
                : 'team',
          visibilityUserIds: item.access === 'restricted' ? [OTHER] : null,
        });
      }
      let retrievalCalls = 0;
      const tools: string[] = [];
      const toolErrors: string[] = [];
      let groundedAnswer: string | undefined;
      let observedProviderUsd: number | null = null;
      const result = await askAgent(
        {
          db: db as never,
          teamId: TEAM,
          userId: USER,
          deliverySurface: surface,
          question: row.question,
          maxSteps: 6,
          toolMode: 'read_only',
        },
        {
          ...modelDeps,
          includeMcpTools: false,
          currentDate: new Date('2026-11-14T12:00:00Z'),
          abortSignal: AbortSignal.timeout(120000),
          sanitizeError: () => new Error('Synthetic benchmark dependency failure'),
          onToolError: (_error, context) => {
            toolErrors.push(context.tool);
          },
          onTurnObservability: (observation) => {
            tools.push(...observation.toolObservations.map((item) => item.tool));
          },
          onEvaluation: (evaluation) => {
            groundedAnswer = evaluation.groundedAnswer;
            observedProviderUsd = evaluation.observedProviderUsd;
          },
          teamScopeDeps: {
            embed: () =>
              Promise.resolve({ vector: [0.1, 0.2, 0.3], model: 'synthetic-controlled-retrieval' }),
            qdrantSearch: () => {
              retrievalCalls++;
              if (row.failure !== 'none' && row.failure !== 'partial')
                return Promise.reject(new Error(`Synthetic retrieval ${row.failure}`));
              return Promise.resolve(
                row.evidence.map((item, index) =>
                  buildSearchHit({
                    teamId: item.access === 'foreign' ? FOREIGN : TEAM,
                    eventId: requireValue(ids[index]),
                    score: 0.99 - index * 0.01,
                    source: item.documentVersion === undefined ? 'web' : 'document',
                    authorUserId: OTHER,
                    visibilityOwnerUserId: OTHER,
                    occurredAt: item.occurredAt,
                    overrides: {
                      ...(item.documentVersion === undefined
                        ? {}
                        : {
                            source_kind: 'doc_chunk',
                            document_id: documentId,
                            document_version_id: evidenceId(`${row.id}:version`, index),
                            document_chunk_id: requireValue(ids[index]),
                            file_kind: 'document',
                            owner_user_id: USER,
                          }),
                      visibility:
                        item.access === 'private'
                          ? 'private'
                          : item.access === 'restricted'
                            ? 'specific_users'
                            : 'team',
                      visibility_user_ids: item.access === 'restricted' ? [OTHER] : null,
                    },
                  }),
                ),
              );
            },
          },
        },
      );
      return {
        answer: result.ok ? (groundedAnswer ?? result.answer) : '',
        deliveredAnswer: result.ok ? result.answer : '',
        surface,
        observedProviderUsd,
        executionSuccess: result.ok,
        truncated: result.ok && result.truncated,
        tools,
        toolErrors,
        retrievalCalls,
        evidenceIds: ids,
        evidenceCitations: citations,
        ...(result.ok && result.requestedModelId
          ? { requestedModelId: result.requestedModelId }
          : {}),
        ...(result.ok && result.responseModelId ? { responseModelId: result.responseModelId } : {}),
      };
    },
  };
}
