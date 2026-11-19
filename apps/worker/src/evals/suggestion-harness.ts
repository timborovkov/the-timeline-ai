import { createHash } from 'node:crypto';

import { conversationReviews, entities, rawEvents, teams, type Db } from '@timeline/db';
import { handleInbound } from '@timeline/shared/email';
import { getEnv } from '@timeline/shared/env';
import { chatStructured, TIMELINE_MODELS } from '@timeline/shared/llm';
import { planReconciliation } from '@timeline/shared/reconciliation/planner';
import { withTeam } from '@timeline/shared/team-scope';
import { createResettablePGliteTestDb } from '@timeline/shared/test/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { PROJECT, TASK, type SuggestionCase } from '#src/evals/suggestion-cases.js';
import type { SuggestionObservation } from '#src/evals/suggestion-report.js';
import { processSuggestionJobForTests } from '#src/workers/suggestions.js';

const TEAM = '11111111-1111-4111-8111-111111111111';
const FOREIGN = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export function suggestionEventId(id: string, index: number) {
  const hex = createHash('sha256').update(`${id}:${index}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
type IO = NonNullable<Parameters<typeof processSuggestionJobForTests>[2]>;
/** Isolated migrated database; production proposal and visibility logic, sequential use only. */
export async function createSuggestionHarness(
  options: { auditCommunication?: IO['chatStructured'] } = {},
) {
  const store = await createResettablePGliteTestDb(async (pg) => {
    await pg.exec(`
      INSERT INTO teams (id,slug,name) VALUES ('${TEAM}','suggestion-eval','Synthetic suggestion benchmark'),('${FOREIGN}','foreign-eval','Foreign synthetic workspace');
      INSERT INTO users (id,email,name) VALUES ('${USER}','eval@example.test','Evaluator'),('${OTHER}','other@example.test','Other');
      INSERT INTO team_members (team_id,user_id,role) VALUES ('${TEAM}','${USER}','owner'),('${TEAM}','${OTHER}','member'),('${FOREIGN}','${OTHER}','owner');
    `);
  });
  const db = drizzle(store.pg);
  return {
    close: () => store.close(),
    async run(
      row: SuggestionCase,
      model: IO['chatStructured'] = chatStructured,
    ): Promise<SuggestionObservation> {
      await store.reset();
      const started = performance.now();
      const stages = ['seeded'];
      const executionErrors: string[] = [];
      let modelCalls = 0;
      let unauthorizedDisclosure = false;
      await db.insert(entities).values({
        id: PROJECT,
        teamId: TEAM,
        type: 'project',
        canonicalName: 'Northstar rollout',
        aliases: row.projectAliases ?? [],
        status: 'active',
      });
      if (row.existingTask)
        await db.insert(entities).values({
          id: TASK,
          teamId: TEAM,
          type: 'task',
          canonicalName: row.existingTask.name,
          status: row.existingTask.status,
        });
      for (const task of row.taskFixtures ?? [])
        await db.insert(entities).values({
          id: task.id,
          teamId: TEAM,
          type: 'task',
          canonicalName: task.name,
          status: task.status,
          aliases: task.aliases ?? [],
          metadata: task.metadata ?? {},
        });
      const initial = JSON.stringify(await db.select().from(entities));
      const ids = row.forwardedSubject
        ? []
        : row.events.map((_, index) => suggestionEventId(row.id, index));
      const metadata =
        row.eventMetadata ??
        (row.source === 'slack'
          ? { slack_workspace_id: 'W_EVAL', slack_channel_id: 'C_EVAL' }
          : row.source === 'telegram'
            ? { tg_chat_id: 'eval-chat' }
            : {});
      if (row.forwardedSubject) {
        await db.update(teams).set({ inboundEmail: 'eval@inbound.test' }).where(eq(teams.id, TEAM));
        for (const [index, text] of row.events.entries()) {
          const result = await handleInbound(
            {
              db: db as unknown as Db,
              inboundDomain: 'inbound.test',
              extract: { enqueueExtract: () => Promise.resolve() },
              embed: { enqueueEmbed: () => Promise.resolve() },
              suggestions: {
                enqueueSuggestion: ({ rawEventId }) => {
                  ids.push(rawEventId);
                  return Promise.resolve();
                },
              },
            },
            {
              providerId: `${row.id}-${index}`,
              sentAt: '2026-06-01T09:00:00Z',
              subject: row.forwardedSubject,
              from: 'eval@example.test',
              fromName: 'Evaluator',
              fromAddress: { email: 'eval@example.test', name: 'Evaluator' },
              toAddresses: [{ email: 'eval@inbound.test', name: 'Synthetic workspace' }],
              ccAddresses: [],
              bccAddresses: [],
              text,
              html: '',
              headers: [{ name: 'Message-ID', value: `<${row.id}-${index}@example.test>` }],
              attachments: [],
              receivedFor: [],
              authentication: null,
              attachmentsDropped: [],
            },
          );
          if (!result.ok || result.inserted !== 1) executionErrors.push('EmailCaptureFailed');
        }
        if (ids.length !== row.events.length) executionErrors.push('EmailSuggestionNotQueued');
        stages.push('email-captured');
      }
      for (const [index, text] of (row.forwardedSubject
        ? []
        : [...row.events, ...(row.privateContext ? [row.privateContext] : [])]
      ).entries()) {
        const privateEvent = index === row.events.length;
        await db.insert(rawEvents).values({
          id: suggestionEventId(row.id, index),
          teamId: TEAM,
          authorUserId: privateEvent ? OTHER : USER,
          source: row.source,
          contentText: text,
          occurredAt: new Date(Date.UTC(2026, 5, 1, 9, privateEvent ? -1 : index)),
          visibility: privateEvent ? 'private' : (row.eventVisibility ?? 'team'),
          visibilityOwnerUserId: privateEvent || row.eventVisibility === 'private' ? OTHER : null,
          sourceMetadata: metadata,
        });
      }
      const queued: Parameters<typeof processSuggestionJobForTests>[1][] = [];
      const io: IO = {
        ...(options.auditCommunication ? { auditCommunication: options.auditCommunication } : {}),
        getEnv: () => ({
          ...getEnv(),
          OPENROUTER_API_KEY: 'synthetic-harness',
          TASK_CATEGORY_CLASSIFICATION_ENABLED: false,
        }),
        modelId: TIMELINE_MODELS.extraction.id,
        ...(model === chatStructured ? { planReconciliation } : {}),
        taskCategoryClassificationEnabled: false,
        evidencePackMode: 'off',
        takeIngestProcessingSlot: () => Promise.resolve({ allowed: true, retryAfterMs: 0 }),
        enqueueSuggestionJob: (data) => {
          queued.push(data);
          return Promise.resolve({ enqueued: true, jobId: 'synthetic' });
        },
        chatStructured: async (input) => {
          modelCalls++;
          stages.push('model-called');
          if (
            row.prohibited?.some((value) =>
              input.prompt.toLowerCase().includes(value.toLowerCase()),
            )
          )
            unauthorizedDisclosure = true;
          try {
            const result = await model(input);
            input.schema.parse(result.object);
            return result;
          } catch (error) {
            // Worker fallback may swallow provider errors: retain failure independently of output.
            executionErrors.push(error instanceof Error ? error.name : 'ModelError');
            throw error;
          }
        },
      };
      try {
        const anchor = ids.at(-1);
        if (!anchor) throw new Error('Missing fixture anchor');
        if (row.githubJobExternalId) {
          const githubJob = {
            scope: 'github_task_proposal' as const,
            teamId: TEAM,
            integrationId: '66666666-6666-4666-8666-666666666666',
            externalObjectId: row.githubJobExternalId,
          };
          await processSuggestionJobForTests({ db: db as unknown as Db }, githubJob, io);
          if (row.replay)
            await processSuggestionJobForTests({ db: db as unknown as Db }, githubJob, io);
        }
        for (const rawEventId of row.githubJobExternalId ? [] : ids) {
          await processSuggestionJobForTests(
            { db: db as unknown as Db },
            { rawEventId, teamId: TEAM },
            io,
          );
        }
        stages.push('events-dispatched');
        // Drain the worker's real scheduled review, advancing only the synthetic quiet window.
        const job = queued.at(-1);
        if (job && 'scope' in job && job.scope === 'conversation_review') {
          await db
            .update(conversationReviews)
            .set({ quietUntil: new Date('2020-01-01') })
            .where(eq(conversationReviews.id, job.conversationReviewId));
          await processSuggestionJobForTests({ db: db as unknown as Db }, job, io);
          if (row.replay) await processSuggestionJobForTests({ db: db as unknown as Db }, job, io);
        } else if (row.replay && !row.githubJobExternalId) {
          await processSuggestionJobForTests(
            { db: db as unknown as Db },
            { rawEventId: anchor, teamId: TEAM },
            io,
          );
        }
        stages.push('worker-returned');
      } catch (error) {
        executionErrors.push(error instanceof Error ? error.name : 'WorkerError');
      }
      const bundles = await withTeam(
        db as unknown as Db,
        TEAM,
        USER,
      ).suggestions.listPendingSuggestions();
      const foreign = await withTeam(
        db as unknown as Db,
        FOREIGN,
        OTHER,
      ).suggestions.listPendingSuggestions();
      if (foreign.length) unauthorizedDisclosure = true;
      const member = await withTeam(
        db as unknown as Db,
        TEAM,
        OTHER,
      ).suggestions.listPendingSuggestions();
      if (
        JSON.stringify(member.map((bundle) => bundle.id).sort()) !==
        JSON.stringify(bundles.map((bundle) => bundle.id).sort())
      )
        executionErrors.push('MemberDeliveryMismatch');
      stages.push('visibility-read');
      const actions = bundles.flatMap((bundle) =>
        bundle.items.map((item) => ({
          bundleId: bundle.id,
          operation: item.operation,
          targetKind: item.targetKind,
          targetId: item.targetId,
          title: item.title,
          proposedPayload: item.proposedPayload,
          evidenceIds: bundle.evidence
            .map((e) => e.rawEventId)
            .filter((id): id is string => Boolean(id)),
        })),
      );
      if (
        row.prohibited?.some((value) =>
          JSON.stringify(bundles).toLowerCase().includes(value.toLowerCase()),
        )
      )
        unauthorizedDisclosure = true;
      return {
        actions,
        executionErrors,
        modelCalls,
        durationMs: performance.now() - started,
        stages,
        unauthorizedDisclosure,
        canonicalMutation: initial !== JSON.stringify(await db.select().from(entities)),
        invalidEvidence: actions.some(
          (action) =>
            !action.evidenceIds.length || action.evidenceIds.some((id) => !ids.includes(id)),
        ),
      };
    },
  };
}
