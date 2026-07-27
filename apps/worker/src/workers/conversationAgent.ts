import { type Db } from '@timeline/db';
import {
  agent,
  childLogger,
  conversationSurfaces,
  queue,
  slack,
  telegram,
  withTeam,
} from '@timeline/shared';
import { Worker, type Job } from 'bullmq';

import { captureWorkerJobFailure } from '#src/monitoring.js';

const log = childLogger('worker:conversation-agent');
type ConversationScope = ReturnType<typeof withTeam>['conversations'];

interface ConversationAgentWorkerDeps {
  db: Db;
  askAgent?: typeof agent.askAgent;
  timeoutMs?: number;
  createDeliveryAdapter?: (
    turn: conversationSurfaces.SurfaceTurnRow,
  ) => Promise<conversationSurfaces.ConversationDeliveryAdapter>;
}

async function deliveryAdapter(
  deps: ConversationAgentWorkerDeps,
  turn: conversationSurfaces.SurfaceTurnRow,
): Promise<conversationSurfaces.ConversationDeliveryAdapter> {
  if (deps.createDeliveryAdapter) return deps.createDeliveryAdapter(turn);
  if (turn.surface === 'telegram') {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required by the conversation agent worker');
    return telegram.createTelegramWorkerDeliveryAdapter({
      token,
      externalConversationKey: turn.externalConversationKey,
      externalMessageId: turn.externalMessageId,
    });
  }
  if (turn.surface === 'slack') {
    return slack.createSlackConversationDeliveryAdapter({
      db: deps.db,
      teamId: turn.teamId,
      externalConversationKey: turn.externalConversationKey,
      externalMessageId: turn.externalMessageId,
    });
  }
  throw new Error(`Unsupported conversation surface: ${turn.surface}`);
}

function turnLogContext(turn: conversationSurfaces.SurfaceTurnRow) {
  return {
    surface: turn.surface,
    teamId: turn.teamId,
    userId: turn.userId,
    turnId: turn.id,
    sessionId: turn.chatSessionId,
    externalEventId: turn.externalEventId,
  };
}

async function deliverCached(
  scope: ConversationScope,
  turn: conversationSurfaces.SurfaceTurnRow,
  adapter: conversationSurfaces.ConversationDeliveryAdapter,
): Promise<void> {
  if (turn.status === 'cancelled') return;
  if (!turn.answerText) throw new Error('Cached conversation turn has no answer');
  try {
    if (turn.status === 'failed' || turn.status === 'timed_out') {
      await adapter.deliverFailure(turn.answerText);
    } else {
      await adapter.deliverAnswer(turn.answerText);
    }
    await scope.markDelivered(turn.id);
  } catch (err) {
    log.warn(
      {
        event: 'conversation_agent_delivery_failed',
        ...turnLogContext(turn),
        status: turn.status,
        err: conversationSurfaces.redactConversationError(err),
      },
      'conversation answer delivery failed',
    );
    throw err;
  }
}

async function cacheAndDeliverFailure(
  scope: ConversationScope,
  turn: conversationSurfaces.SurfaceTurnRow,
  adapter: conversationSurfaces.ConversationDeliveryAdapter,
  failure: {
    status: 'timed_out' | 'failed';
    errorCode: string;
    answerText: string;
  },
  onCached: () => void = () => undefined,
): Promise<void> {
  await scope.cacheFailure(turn.id, failure);
  onCached();
  const cached = await scope.getTurn(turn.id);
  if (cached && !cached.deliveredAt) await deliverCached(scope, cached, adapter);
}

export async function processConversationAgentJob(
  deps: ConversationAgentWorkerDeps,
  data: queue.ConversationAgentJobData,
): Promise<{ turnId: string; status: string }> {
  const startedAt = Date.now();
  const scope = withTeam(deps.db, data.teamId, data.userId).conversations;
  const claim = await scope.claimTurn(data.turnId);
  if (claim.status === 'missing') return { turnId: data.turnId, status: 'missing' };
  if (claim.status === 'delivered') return { turnId: data.turnId, status: 'delivered' };

  const turn = claim.turn;
  if (claim.status === 'terminal') return { turnId: turn.id, status: turn.status };
  let adapter: conversationSurfaces.ConversationDeliveryAdapter;
  try {
    adapter = await deliveryAdapter(deps, turn);
  } catch (err) {
    if (!turn.answerText) {
      await scope.cacheFailure(turn.id, {
        status: 'failed',
        errorCode: 'delivery_adapter_unavailable',
        answerText: conversationSurfaces.CONVERSATION_AGENT_FAILURE_MESSAGE,
      });
    }
    log.warn(
      {
        event: 'conversation_agent_delivery_failed',
        ...turnLogContext(turn),
        status: turn.status,
        err: conversationSurfaces.redactConversationError(err),
      },
      'conversation delivery adapter unavailable',
    );
    throw err;
  }
  if (claim.status === 'cached') {
    await deliverCached(scope, turn, adapter);
    return { turnId: turn.id, status: 'delivered_cached' };
  }
  if (claim.status === 'stale_processing') {
    await cacheAndDeliverFailure(scope, turn, adapter, {
      status: 'failed',
      errorCode: 'stale_processing',
      answerText: conversationSurfaces.CONVERSATION_AGENT_FAILURE_MESSAGE,
    });
    log.warn(
      {
        event: 'conversation_agent_failed',
        ...turnLogContext(turn),
        status: 'failed',
        durationMs: Date.now() - startedAt,
      },
      'conversation turn failed closed after ambiguous processing state',
    );
    return { turnId: turn.id, status: 'stale_processing' };
  }
  log.info(
    {
      event: 'conversation_agent_started',
      ...turnLogContext(turn),
      status: 'processing',
    },
    'conversation agent turn started',
  );

  let stopProgress = (): void => undefined;
  const abortController = new AbortController();
  let responseCached = false;
  const timeoutError = new Error('conversation_agent_timeout');
  let stopDeadline = (): void => undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(timeoutError);
      abortController.abort(timeoutError);
    }, deps.timeoutMs ?? conversationSurfaces.DIRECT_CONVERSATION_TIMEOUT_MS);
    timeout.unref();
    stopDeadline = () => {
      clearTimeout(timeout);
    };
  });
  let toolObservability: agent.AgentTurnObservability | undefined;
  try {
    const runAgent = deps.askAgent ?? agent.askAgent;
    const prepareAgentResult = async (): Promise<agent.AskAgentResult> => {
      stopProgress = await adapter.startProgress();
      abortController.signal.throwIfAborted();
      const history = await scope.recentHistory(turn.chatSessionId);
      abortController.signal.throwIfAborted();
      return runAgent(
        {
          db: deps.db,
          teamId: turn.teamId,
          userId: turn.userId,
          question: turn.questionText,
          priorMessages: history,
        },
        {
          abortSignal: abortController.signal,
          sanitizeError: conversationSurfaces.redactConversationError,
          onTurnObservability: (value) => {
            toolObservability = value;
          },
        },
      );
    };
    const result = await Promise.race([prepareAgentResult(), deadline]);

    if (!result.ok) {
      await cacheAndDeliverFailure(
        scope,
        turn,
        adapter,
        {
          status: 'failed',
          errorCode: `agent_${result.error}`,
          answerText: conversationSurfaces.CONVERSATION_AGENT_FAILURE_MESSAGE,
        },
        () => {
          responseCached = true;
        },
      );
      log.warn(
        {
          event: 'conversation_agent_failed',
          ...turnLogContext(turn),
          status: 'failed',
          durationMs: Date.now() - startedAt,
        },
        'conversation agent turn failed',
      );
      return { turnId: turn.id, status: 'failed' };
    }

    const stored = await scope.storeAnswer({
      turnId: turn.id,
      answer: result.answer,
      ...(result.requestedModelId ? { requestedModelId: result.requestedModelId } : {}),
      ...(result.responseModelId ? { responseModelId: result.responseModelId } : {}),
      ...(toolObservability ? { toolObservability } : {}),
    });
    if (!stored) return { turnId: turn.id, status: 'cancelled' };
    responseCached = true;
    const answered = await scope.getTurn(turn.id);
    if (!answered) return { turnId: turn.id, status: 'missing_after_answer' };
    if (answered.status === 'cancelled') return { turnId: turn.id, status: 'cancelled' };
    await deliverCached(scope, answered, adapter);
    log.info(
      {
        event: 'conversation_agent_completed',
        ...turnLogContext(turn),
        status: 'delivered',
        requestedModelId: result.requestedModelId,
        responseModelId: result.responseModelId,
        durationMs: Date.now() - startedAt,
      },
      'conversation agent turn completed',
    );
    return { turnId: turn.id, status: 'delivered' };
  } catch (err) {
    if (responseCached) throw err;
    if (err === timeoutError || abortController.signal.reason === timeoutError) {
      await cacheAndDeliverFailure(
        scope,
        turn,
        adapter,
        {
          status: 'timed_out',
          errorCode: 'agent_timeout',
          answerText: conversationSurfaces.CONVERSATION_AGENT_TIMEOUT_MESSAGE,
        },
        () => {
          responseCached = true;
        },
      );
      log.warn(
        {
          event: 'conversation_agent_timeout',
          ...turnLogContext(turn),
          status: 'timed_out',
          durationMs: Date.now() - startedAt,
        },
        'conversation agent turn timed out',
      );
      return { turnId: turn.id, status: 'timed_out' };
    }
    await cacheAndDeliverFailure(scope, turn, adapter, {
      status: 'failed',
      errorCode: 'agent_exception',
      answerText: conversationSurfaces.CONVERSATION_AGENT_FAILURE_MESSAGE,
    });
    log.warn(
      {
        event: 'conversation_agent_failed',
        ...turnLogContext(turn),
        status: 'failed',
        durationMs: Date.now() - startedAt,
        err: conversationSurfaces.redactConversationError(err),
      },
      'conversation agent threw before producing an answer',
    );
    return { turnId: turn.id, status: 'failed' };
  } finally {
    stopDeadline();
    stopProgress();
  }
}

export function startConversationAgentWorker(
  deps: ConversationAgentWorkerDeps,
): Worker<queue.ConversationAgentJobData> {
  const worker = new Worker<queue.ConversationAgentJobData>(
    queue.QUEUE_NAMES.conversationAgent,
    async (job: Job<queue.ConversationAgentJobData>) => processConversationAgentJob(deps, job.data),
    { connection: queue.getRedisConnection(), concurrency: 2 },
  );
  worker.on('failed', (job, err) => {
    const safeError = conversationSurfaces.redactConversationError(err);
    log.error({ jobId: job?.id, err: safeError }, 'conversation agent job failed');
    captureWorkerJobFailure(safeError, job);
  });
  return worker;
}
