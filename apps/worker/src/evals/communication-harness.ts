import {
  agentSuggestionItems,
  calendarEvents,
  conversationReviews,
  entities,
  entityRelationships,
  rawEvents,
  slackConversationBindings,
  slackUsers,
  slackUserTeams,
  slackWorkspaces,
  slackWorkspaceTeams,
  teamVisibilityDefaults,
  type Db,
} from '@timeline/db';
import { handleInbound } from '@timeline/shared/email';
import { getEnv } from '@timeline/shared/env';
import { chatStructured, TIMELINE_MODELS } from '@timeline/shared/llm';
import { planReconciliation } from '@timeline/shared/reconciliation/planner';
import { SlackApi, handleSlackEnvelope } from '@timeline/shared/slack';
import { withTeam } from '@timeline/shared/team-scope';
import { handleUpdate, type TelegramApi } from '@timeline/shared/telegram';
import { createResettablePGliteTestDb } from '@timeline/shared/test/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import {
  COMM_ACTORS,
  COMM_FOREIGN,
  COMM_TEAM,
  communicationId,
  type Actor,
  type CommunicationCase,
  type CommunicationObservation,
} from '#src/evals/communication-types.js';
import { processSuggestionJobForTests } from '#src/workers/suggestions.js';

const WORKSPACE = '33333333-3333-4333-8333-333333333333';
const BASE_TIME = Date.parse('2026-06-01T09:00:00Z');
type IO = NonNullable<Parameters<typeof processSuggestionJobForTests>[2]>;
type Job = Parameters<typeof processSuggestionJobForTests>[1];
const noop = () => Promise.resolve();
const tg: TelegramApi = {
  sendMessage: noop,
  getChatAdministrators: () => Promise.resolve([]),
  answerCallbackQuery: noop,
  editMessageText: noop,
  getFile: () => Promise.reject(new Error('Unexpected file access')),
  downloadFile: () => Promise.reject(new Error('Unexpected download')),
  setMessageReaction: noop,
  sendChatAction: noop,
};
class SyntheticSlackApi extends SlackApi {
  override usersInfo(user: string) {
    const name = user === 'U_BOB' ? 'Bob' : 'Alice';
    return Promise.resolve({
      id: user,
      name: name.toLowerCase(),
      real_name: name,
      profile: { display_name: name, real_name: name, email: `${name.toLowerCase()}@example.test` },
    });
  }
  override addReaction() {
    return Promise.resolve();
  }
  override postMessage() {
    return Promise.resolve();
  }
}
export interface CommunicationControls {
  model?: IO['chatStructured'];
  auditModel?: IO['chatStructured'];
  jobAttempts?: 1 | 2 | 3;
  failEnqueueOnce?: boolean;
  failAcceptance?: boolean;
  delayReview?: boolean;
}
function emailText(row: CommunicationCase, index: number) {
  const item = row.messages[index];
  if (!item) throw new Error('Missing message');
  const actor = item.actor ?? 'alice';
  const author = actor === 'alice' ? 'Alice' : 'Bob';
  const header = [
    `From: ${author} <${actor}@example.test>`,
    `Date: ${new Date(BASE_TIME + (item.offsetMinutes ?? index) * 60_000).toUTCString()}`,
    'Subject: Workspace discussion',
    'To: Alice <alice@example.test>',
  ];
  if (row.packaging === 'plain' || row.packaging === 'html') return item.text;
  if (row.packaging === 'outlook') return ['FYI', '', ...header, '', item.text].join('\n');
  if (row.packaging === 'apple')
    return ['FYI', '', 'Begin forwarded message:', ...header, '', item.text].join('\n');
  if (row.packaging === 'nested')
    return [
      row.messages[0]?.text,
      '',
      '---------- Forwarded message ---------',
      ...header,
      '',
      row.messages[1]?.text,
    ].join('\n');
  return ['FYI', '', '---------- Forwarded message ---------', ...header, '', item.text].join('\n');
}
/** Real local capture, scheduling, persistence and approval; synthetic stores/transports only. */
export async function createCommunicationHarness() {
  const store = await createResettablePGliteTestDb(async (pg) => {
    await pg.exec(`
      INSERT INTO teams(id,slug,name,inbound_email) VALUES ('${COMM_TEAM}','communications','Communications','eval@inbound.test'),('${COMM_FOREIGN}','foreign','Foreign',NULL);
      INSERT INTO users(id,email,name) VALUES ('${COMM_ACTORS.alice}','alice@example.test','Alice'),('${COMM_ACTORS.bob}','bob@example.test','Bob');
      INSERT INTO team_members(team_id,user_id,role) VALUES ('${COMM_TEAM}','${COMM_ACTORS.alice}','owner'),('${COMM_TEAM}','${COMM_ACTORS.bob}','member'),('${COMM_FOREIGN}','${COMM_ACTORS.bob}','owner');
      INSERT INTO telegram_users(id,tg_user_id,username,user_id) VALUES ('${COMM_ACTORS.alice}',7,'alice','${COMM_ACTORS.alice}'),('${COMM_ACTORS.bob}',8,'bob','${COMM_ACTORS.bob}');
      INSERT INTO telegram_user_teams(telegram_user_id,team_id,linked_by_user_id,is_active) VALUES ('${COMM_ACTORS.alice}','${COMM_TEAM}','${COMM_ACTORS.alice}',true),('${COMM_ACTORS.bob}','${COMM_TEAM}','${COMM_ACTORS.bob}',true);
      INSERT INTO telegram_chat_bindings(tg_chat_id,team_id,bound_by_user_id,title) VALUES (-100,'${COMM_TEAM}','${COMM_ACTORS.alice}','Synthetic communications');
    `);
  });
  const db = drizzle(store.pg);
  const scoped = () => withTeam(db as unknown as Db, COMM_TEAM, COMM_ACTORS.alice);
  return {
    close: () => store.close(),
    async run(
      row: CommunicationCase,
      controls: CommunicationControls = {},
    ): Promise<CommunicationObservation> {
      await store.reset();
      const started = performance.now();
      const stages = ['seeded'];
      const inferenceTimings: NonNullable<CommunicationObservation['inferenceTimings']> = [];
      const executionErrors: string[] = [];
      const executionFailureDetails: string[] = [];
      const ids: string[] = [];
      const jobs: Job[] = [];
      const reviews: Job[] = [];
      const packets: string[] = [];
      let modelCalls = 0,
        queuedJobs = 0,
        unauthorizedDisclosure = false,
        protectedPendingChanged = false,
        acceptanceErrors = 0,
        retriedEnqueue = false;
      const enqueueState = { failed: false };
      const snapshot = async () =>
        JSON.stringify({
          nodes: await db.select().from(entities).orderBy(entities.id),
          edges: await db.select().from(entityRelationships).orderBy(entityRelationships.id),
          calendar: await db.select().from(calendarEvents).orderBy(calendarEvents.id),
        });
      await db.insert(slackWorkspaces).values({
        id: WORKSPACE,
        slackTeamId: 'T_EVAL',
        name: 'Synthetic',
        botUserId: 'U_BOT',
        tokenCiphertext: Buffer.from('unused'),
        tokenIv: Buffer.alloc(12),
        tokenTag: Buffer.alloc(16),
        installedByUserId: COMM_ACTORS.alice,
      });
      await db.insert(slackWorkspaceTeams).values({
        workspaceId: WORKSPACE,
        teamId: COMM_TEAM,
        installedByUserId: COMM_ACTORS.alice,
        enabled: true,
      });
      await db.insert(slackConversationBindings).values({
        workspaceId: WORKSPACE,
        teamId: COMM_TEAM,
        slackConversationId: 'C_EVAL',
        conversationType: 'channel',
        boundByUserId: COMM_ACTORS.alice,
        enabled: true,
      });
      for (const actor of ['alice', 'bob'] as const) {
        await db.insert(slackUsers).values({
          id: COMM_ACTORS[actor],
          workspaceId: WORKSPACE,
          slackUserId: actor === 'alice' ? 'U_ALICE' : 'U_BOB',
          realName: actor === 'alice' ? 'Alice' : 'Bob',
        });
        await db.insert(slackUserTeams).values({
          slackUserId: COMM_ACTORS[actor],
          teamId: COMM_TEAM,
          userId: COMM_ACTORS[actor],
          linkedByUserId: COMM_ACTORS.alice,
          isActive: true,
        });
      }
      for (const node of row.seed)
        await db.insert(entities).values({
          id: communicationId(row.familyId, node.key),
          teamId: COMM_TEAM,
          type: node.type,
          canonicalName: node.name,
          status: node.status ?? (node.type === 'company' ? 'active' : 'planning'),
          aliases: node.aliases ?? [],
          assigneeUserId: node.assignee ? COMM_ACTORS[node.assignee] : null,
          dueAt: node.dueAt ? new Date(node.dueAt) : null,
        });
      const seedEvidence = communicationId(row.familyId, 'seed-evidence');
      const protectedItems: { id: string; payload: string }[] = [];
      if (row.pending?.length) {
        await db.insert(rawEvents).values({
          id: seedEvidence,
          teamId: COMM_TEAM,
          authorUserId: COMM_ACTORS.alice,
          source: 'web',
          contentText: 'Please prepare the migration checklist.',
          visibility: 'team',
          occurredAt: new Date(BASE_TIME - 60_000),
        });
        ids.push(seedEvidence);
        for (const pending of row.pending) {
          const projectKey = pending.edited ? 'human-project' : undefined;
          const bundle = await scoped().suggestions.createOrMergeSuggestionBundle({
            source: 'background',
            title: pending.node.name,
            dedupeKey: `pending:${row.id}:${pending.node.key}`,
            evidence: [
              { rawEventId: seedEvidence, quote: 'Please prepare the migration checklist.' },
            ],
            items: [
              {
                operation: 'create',
                targetKind: 'task',
                title: pending.node.name,
                dedupeKey: `pending-item:${row.id}`,
                proposedPayload: {
                  canonicalName: pending.node.name,
                  status: pending.node.status ?? 'todo',
                  ...(projectKey
                    ? { parentObjectId: communicationId(row.familyId, projectKey) }
                    : {}),
                },
              },
            ],
          });
          const item = bundle.items[0];
          if (!item) throw new Error('Missing seeded pending item');
          if (pending.edited) {
            await scoped().suggestions.reviseTaskSuggestionItem({
              itemId: item.id,
              project: {
                kind: 'existing',
                projectId: communicationId(row.familyId, 'human-project'),
              },
            });
            const [saved] = await db
              .select()
              .from(agentSuggestionItems)
              .where(eq(agentSuggestionItems.id, item.id));
            protectedItems.push({ id: item.id, payload: JSON.stringify(saved?.proposedPayload) });
          }
        }
      }
      const before = await snapshot();
      const queues = {
        extract: { enqueueExtract: noop },
        embed: { enqueueEmbed: noop },
        suggestions: {
          enqueueSuggestion: (job: { rawEventId: string; teamId: string }) => {
            if (controls.failEnqueueOnce && !enqueueState.failed) {
              enqueueState.failed = true;
              return Promise.reject(new Error('Injected queue outage'));
            }
            ids.push(job.rawEventId);
            jobs.push(job);
            queuedJobs++;
            return Promise.resolve();
          },
        },
      };
      const io: IO = {
        ...(controls.model || controls.auditModel
          ? {
              auditCommunication: async (input) => {
                modelCalls++;
                stages.push('completeness-check');
                const callStarted = performance.now();
                let failed = false;
                const checker =
                  controls.auditModel ??
                  (await import('#src/test/communication-audit.js')).controlledCommunicationAudit;
                try {
                  const result = await checker(input);
                  input.schema.parse(result.object);
                  return result;
                } catch (error) {
                  executionErrors.push(error instanceof Error ? error.name : 'AuditError');
                  failed = true;
                  throw error;
                } finally {
                  inferenceTimings.push({
                    stage: 'completeness-check',
                    latencyMs: performance.now() - callStarted,
                    failed,
                  });
                }
              },
            }
          : {}),
        getEnv: () => ({
          ...getEnv(),
          OPENROUTER_API_KEY: 'synthetic',
          TASK_CATEGORY_CLASSIFICATION_ENABLED: false,
        }),
        modelId: TIMELINE_MODELS.extraction.id,
        taskCategoryClassificationEnabled: false,
        evidencePackMode: 'off',
        ...(!controls.model ? { planReconciliation } : {}),
        takeIngestProcessingSlot: () => Promise.resolve({ allowed: true, retryAfterMs: 0 }),
        enqueueSuggestionJob: (job) => {
          reviews.push(job);
          return Promise.resolve({ enqueued: true, jobId: 'synthetic' });
        },
        chatStructured: async (input) => {
          modelCalls++;
          if (
            input.prompt.includes('# Current raw event') ||
            input.prompt.includes('# Anchor raw event')
          ) {
            packets.push(input.prompt);
            stages.push('packet-built');
          }
          const stage = input.instructions?.startsWith('communication-completeness-')
            ? 'completeness-check'
            : 'extraction';
          stages.push(stage === 'extraction' ? 'inference' : stage);
          const callStarted = performance.now();
          let failed = false;
          try {
            const result = await (controls.model ?? chatStructured)(input);
            input.schema.parse(result.object);
            return result;
          } catch (error) {
            executionErrors.push(error instanceof Error ? error.name : 'InferenceError');
            failed = true;
            throw error;
          } finally {
            inferenceTimings.push({ stage, latencyMs: performance.now() - callStarted, failed });
          }
        },
      };
      const runJob = async (job: Job) => {
        for (let attempt = 0; attempt < (controls.jobAttempts ?? 1); attempt++) {
          try {
            await processSuggestionJobForTests({ db: db as unknown as Db }, job, io);
            return;
          } catch (error) {
            executionErrors.push(error instanceof Error ? error.name : 'WorkerError');
            if (
              error instanceof Error &&
              /^(Communication |Pending communication )/.test(error.message)
            )
              executionFailureDetails.push(error.message);
          }
        }
      };
      const drain = async () => {
        while (jobs.length) {
          const job = jobs.shift();
          if (job) await runJob(job);
        }
        const pending = reviews.splice(0);
        const latest = new Map<string, Job>();
        for (const job of pending)
          if ('scope' in job && job.scope === 'conversation_review')
            latest.set(job.conversationReviewId, job);
        for (const job of latest.values())
          if ('scope' in job && job.scope === 'conversation_review') {
            if (controls.delayReview) await runJob(job);
            await db
              .update(conversationReviews)
              .set({ quietUntil: new Date('2020-01-01') })
              .where(eq(conversationReviews.id, job.conversationReviewId));
            await runJob(job);
            if (row.messages.some((message) => message.replay)) await runJob(job);
          }
        reviews.length = 0;
        stages.push('reviewed');
      };
      const messages = row.packaging === 'nested' ? row.messages.slice(0, 1) : row.messages;
      for (const [index, item] of messages.entries()) {
        const actor: Actor = item.actor ?? 'alice';
        await db
          .insert(teamVisibilityDefaults)
          .values({
            teamId: COMM_TEAM,
            source: row.source,
            visibility: item.private ? 'private' : 'team',
            sourceOwnerUserId: COMM_ACTORS[actor],
            updatedByUserId: COMM_ACTORS.alice,
          })
          .onConflictDoUpdate({
            target: [teamVisibilityDefaults.teamId, teamVisibilityDefaults.source],
            set: {
              visibility: item.private ? 'private' : 'team',
              sourceOwnerUserId: COMM_ACTORS[actor],
            },
          });
        if (row.source === 'slack')
          await db
            .update(slackConversationBindings)
            .set({ visibilityDefault: item.private ? 'private' : 'team' })
            .where(eq(slackConversationBindings.workspaceId, WORKSPACE));
        const timestamp = BASE_TIME + (item.offsetMinutes ?? index) * 60_000;
        const eventKey = `${row.id}-${index}`;
        const capture = async () => {
          if (row.source === 'email') {
            const text = emailText(row, index);
            return handleInbound(
              { db: db as unknown as Db, inboundDomain: 'inbound.test', ...queues },
              {
                providerId: eventKey,
                sentAt: new Date(timestamp).toISOString(),
                subject:
                  row.packaging === 'plain' ? 'Workspace discussion' : 'Fwd: Workspace discussion',
                from: 'alice@example.test',
                fromName: 'Alice',
                fromAddress: { email: 'alice@example.test', name: 'Alice' },
                toAddresses: [{ email: 'eval@inbound.test', name: 'Evaluation' }],
                ccAddresses: [],
                bccAddresses: [],
                text: row.packaging === 'html' ? '' : text,
                html:
                  row.packaging === 'html'
                    ? `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`
                    : '',
                headers: [
                  { name: 'Message-ID', value: `<${eventKey}@example.test>` },
                  ...(index
                    ? [
                        { name: 'In-Reply-To', value: `<${row.id}-${index - 1}@example.test>` },
                        {
                          name: 'References',
                          value: Array.from(
                            { length: index },
                            (_, prior) => `<${row.id}-${prior}@example.test>`,
                          ).join(' '),
                        },
                      ]
                    : []),
                ],
                attachments: [],
                receivedFor: [],
                authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
                attachmentsDropped: [],
              },
            );
          }
          if (row.source === 'slack')
            return handleSlackEnvelope(
              { db: db as unknown as Db, api: new SyntheticSlackApi('synthetic'), ...queues },
              {
                type: 'event_callback',
                team_id: 'T_EVAL',
                event_id: eventKey,
                event_time: Math.floor(timestamp / 1000),
                event: {
                  type: 'message',
                  user: actor === 'alice' ? 'U_ALICE' : 'U_BOB',
                  channel: 'C_EVAL',
                  channel_type: 'channel',
                  text: item.text,
                  ts: `${timestamp / 1000}.000000`,
                },
              },
            );
          return handleUpdate(
            { db: db as unknown as Db, tg, ...queues },
            {
              update_id: index + 100,
              message: {
                message_id: index + 100,
                date: timestamp / 1000,
                from: {
                  id: actor === 'alice' ? 7 : 8,
                  is_bot: false,
                  first_name: actor === 'alice' ? 'Alice' : 'Bob',
                  username: actor,
                },
                chat: { id: -100, type: 'supergroup', title: 'Communications' },
                text: item.text,
              },
            },
          );
        };
        try {
          const result = await capture();
          if (!result.ok && !controls.failEnqueueOnce) executionErrors.push('CaptureFailed');
        } catch (error) {
          if (!controls.failEnqueueOnce)
            executionErrors.push(error instanceof Error ? error.name : 'CaptureError');
        }
        if (controls.failEnqueueOnce && enqueueState.failed && !retriedEnqueue) {
          retriedEnqueue = true;
          await capture();
        }
        if (item.replay) await capture();
        while (jobs.length) {
          const job = jobs.shift();
          if (job) await runJob(job);
        }
        if (item.flush || index === messages.length - 1) await drain();
      }
      stages.push('persisted');
      const raw = await db.select().from(rawEvents);
      const capturedEvents = raw.filter((event) => event.source === row.source).length;
      if (capturedEvents !== messages.length) executionErrors.push('CaptureCountMismatch');
      if (!queuedJobs && messages.some((message) => !message.private))
        executionErrors.push('SuggestionNotQueued');
      const canonicalMutation = before !== (await snapshot());
      const bundles = await scoped().suggestions.listPendingSuggestions();
      const member = await withTeam(
        db as unknown as Db,
        COMM_TEAM,
        COMM_ACTORS.bob,
      ).suggestions.listPendingSuggestions();
      const foreign = await withTeam(
        db as unknown as Db,
        COMM_FOREIGN,
        COMM_ACTORS.bob,
      ).suggestions.listPendingSuggestions();
      if (foreign.length) unauthorizedDisclosure = true;
      if (
        JSON.stringify(member.map((row) => row.id).sort()) !==
        JSON.stringify(bundles.map((row) => row.id).sort())
      )
        executionErrors.push('VisibilityMismatch');
      for (const protectedItem of protectedItems) {
        const [item] = await db
          .select()
          .from(agentSuggestionItems)
          .where(eq(agentSuggestionItems.id, protectedItem.id));
        if (JSON.stringify(item?.proposedPayload) !== protectedItem.payload)
          protectedPendingChanged = true;
      }
      const actions = bundles.flatMap((bundle) =>
        bundle.items
          .filter((item) => item.status === 'pending' || item.status === 'failed')
          .map((item) => ({
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
      const actionKeys = actions
        .filter((action) => action.targetKind === 'task' || action.targetKind === 'object')
        .map((action) =>
          JSON.stringify([
            action.operation,
            action.targetKind,
            action.targetId ??
              (typeof action.proposedPayload.canonicalName === 'string'
                ? action.proposedPayload.canonicalName
                : action.title
              ).toLowerCase(),
          ]),
        );
      const duplicateProposals = actionKeys.length - new Set(actionKeys).size;
      const visibleIds = new Set(
        raw
          .filter((event) => event.teamId === COMM_TEAM && event.visibility === 'team')
          .map((event) => event.id),
      );
      const invalidEvidence = actions.some(
        (action) =>
          !action.evidenceIds.length || action.evidenceIds.some((id) => !visibleIds.has(id)),
      );
      // Public evidence may quote an attack; only originating its requested work is
      // a violation. Private content must not appear anywhere in a team bundle.
      const outputText = JSON.stringify(
        row.messages.some((message) => message.private) ? bundles : actions,
      ).toLowerCase();
      if (row.prohibitedText?.some((value) => outputText.includes(value.toLowerCase())))
        unauthorizedDisclosure = true;
      for (const item of row.messages.filter((message) => message.private))
        if (packets.some((packet) => packet.includes(item.text))) unauthorizedDisclosure = true;
      const packetLoss = row.messages.flatMap((message, index) =>
        (message.mustReachModel ?? [])
          .filter((fragment) => !packets.some((packet) => packet.includes(fragment)))
          .map(() => `message-${index}`),
      );
      const uncertaintyMissing = Boolean(
        row.uncertain &&
        bundles.length &&
        bundles.some(
          (bundle) =>
            bundle.confidence !== 'low' ||
            !/potential|possible|prospect|uncertain|not.*signed|no.*contract|not.*client/i.test(
              `${bundle.reason} ${bundle.summary}`,
            ),
        ),
      );
      stages.push('visibility-checked');
      for (const bundle of bundles) {
        const denied = await withTeam(
          db as unknown as Db,
          COMM_FOREIGN,
          COMM_ACTORS.bob,
        ).suggestions.acceptAll(bundle.id);
        if (denied.accepted) unauthorizedDisclosure = true;
      }
      const approvalScope = withTeam(
        db as unknown as Db,
        COMM_TEAM,
        COMM_ACTORS.alice,
        controls.failAcceptance
          ? { beforeSuggestionApply: () => Promise.reject(new Error('Injected acceptance outage')) }
          : {},
      );
      for (const bundle of bundles) {
        try {
          const result = await approvalScope.suggestions.acceptAll(bundle.id);
          acceptanceErrors += result.failed;
        } catch {
          acceptanceErrors++;
        }
      }
      const savedItems = await db.select().from(agentSuggestionItems);
      const approvalOutcomes = savedItems.map((item) => ({
        title: item.title,
        status: item.status,
        resultId: item.resultId,
        reason: item.failureReason ?? item.supersededReason,
      }));
      const acceptanceFailureReasons = savedItems
        .filter((item) => item.status === 'failed')
        .map((item) => `${item.targetKind}: ${item.failureReason ?? 'Acceptance failed'}`);
      stages.push('approval-checked');
      const nodes = (await db.select().from(entities))
        .filter((node) => node.teamId === COMM_TEAM && !node.archivedAt && !node.mergedIntoId)
        .map((node) => ({
          id: node.id,
          type: node.type,
          name: node.canonicalName,
          status: node.status,
          assigneeUserId: node.assigneeUserId,
          dueAt: node.dueAt?.toISOString() ?? null,
        }));
      const edges = (await db.select().from(entityRelationships))
        .filter((edge) => edge.teamId === COMM_TEAM)
        .map((edge) => ({ from: edge.fromEntityId, to: edge.toEntityId, kind: edge.kind }));
      return {
        actions,
        executionErrors,
        executionFailureDetails,
        modelCalls,
        inferenceTimings,
        durationMs: performance.now() - started,
        unauthorizedDisclosure,
        canonicalMutation,
        invalidEvidence,
        stages,
        nodes,
        edges,
        acceptanceErrors,
        acceptanceFailureReasons,
        approvalOutcomes,
        duplicateProposals,
        packetLoss,
        protectedPendingChanged,
        uncertaintyMissing,
        capturedEvents,
        queuedJobs,
        source: row.source,
        familyId: row.familyId,
      };
    },
  };
}
