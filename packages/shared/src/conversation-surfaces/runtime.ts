import { type Db } from '@timeline/db';

import { redactConversationError } from '#src/conversation-surfaces/privacy.js';
import {
  CONVERSATION_AGENT_BUSY_MESSAGE,
  CONVERSATION_AGENT_FAILURE_MESSAGE,
  type ConversationDeliveryAdapter,
  type DirectAgentTurnRequest,
} from '#src/conversation-surfaces/types.js';
import { childLogger } from '#src/logger.js';
import { enqueueConversationAgentJob } from '#src/queue/queues.js';
import { withTeam } from '#src/team-scope.js';

const log = childLogger('conversation-surfaces:runtime');

export type AcceptDirectAgentTurnResult =
  | { status: 'queued' | 'duplicate'; turnId: string; sessionId: string }
  | { status: 'busy' | 'rate_limited' | 'failed' };

interface AcceptDirectAgentTurnOptions {
  providerAcknowledgement?: 'wait' | 'background';
}

async function runProviderAcknowledgement(
  adapter: ConversationDeliveryAdapter,
  options: AcceptDirectAgentTurnOptions,
): Promise<void> {
  const acknowledge = async (): Promise<void> => {
    await adapter.acknowledgeAgentRequest();
    const stopInitialProgress = await adapter.startProgress();
    stopInitialProgress();
  };
  if (options.providerAcknowledgement !== 'background') {
    await acknowledge();
    return;
  }
  void acknowledge().catch((err: unknown) => {
    log.warn(
      { err: redactConversationError(err) },
      'direct conversation provider acknowledgement failed',
    );
  });
}

async function deliverAcceptanceFailure(
  adapter: ConversationDeliveryAdapter,
  text: string,
  options: AcceptDirectAgentTurnOptions,
): Promise<void> {
  const delivery = adapter.deliverFailure(text);
  if (options.providerAcknowledgement !== 'background') {
    await delivery;
    return;
  }
  void delivery.catch((err: unknown) => {
    log.warn(
      { err: redactConversationError(err) },
      'direct conversation acceptance failure delivery failed',
    );
  });
}

export async function acceptDirectAgentTurn(
  db: Db,
  request: DirectAgentTurnRequest,
  adapter: ConversationDeliveryAdapter,
  options: AcceptDirectAgentTurnOptions = {},
): Promise<AcceptDirectAgentTurnResult> {
  const scope = withTeam(db, request.teamId, request.userId);
  let result;
  try {
    result = await scope.conversations.createTurn(request);
  } catch (err) {
    log.warn(
      {
        event: 'conversation_agent_failed',
        surface: request.surface,
        teamId: request.teamId,
        userId: request.userId,
        externalEventId: request.externalEventId,
        status: 'failed',
        err: redactConversationError(err),
      },
      'direct conversation turn could not be persisted',
    );
    await deliverAcceptanceFailure(adapter, CONVERSATION_AGENT_FAILURE_MESSAGE, options);
    return { status: 'failed' };
  }
  if (result.status === 'busy') {
    log.info(
      {
        event: 'conversation_agent_busy',
        surface: request.surface,
        teamId: request.teamId,
        userId: request.userId,
        externalEventId: request.externalEventId,
        status: 'busy',
      },
      'direct conversation already has an active turn',
    );
    await deliverAcceptanceFailure(adapter, CONVERSATION_AGENT_BUSY_MESSAGE, options);
    return { status: 'busy' };
  }
  if (result.status === 'rate_limited') {
    await deliverAcceptanceFailure(
      adapter,
      'You’ve reached the limit of 10 agent messages per minute.',
      options,
    );
    return { status: 'rate_limited' };
  }
  if (result.turn.status === 'delivered' || result.turn.deliveredAt) {
    return {
      status: 'duplicate',
      turnId: result.turn.id,
      sessionId: result.turn.chatSessionId,
    };
  }
  try {
    await enqueueConversationAgentJob({ turnId: result.turn.id });
    await runProviderAcknowledgement(adapter, options);
    log.info(
      {
        event: 'conversation_agent_queued',
        surface: request.surface,
        teamId: request.teamId,
        userId: request.userId,
        turnId: result.turn.id,
        sessionId: result.turn.chatSessionId,
        externalEventId: request.externalEventId,
        status: 'queued',
      },
      'direct conversation turn queued',
    );
    return {
      status: result.status === 'accepted' ? 'queued' : 'duplicate',
      turnId: result.turn.id,
      sessionId: result.turn.chatSessionId,
    };
  } catch (err) {
    await scope.conversations
      .updateTurn(result.turn.id, {
        status: 'failed',
        errorCode: 'enqueue_failed',
      })
      .catch(() => undefined);
    log.warn(
      {
        event: 'conversation_agent_failed',
        surface: request.surface,
        teamId: request.teamId,
        userId: request.userId,
        turnId: result.turn.id,
        sessionId: result.turn.chatSessionId,
        externalEventId: request.externalEventId,
        status: 'failed',
        err: redactConversationError(err),
      },
      'direct conversation turn could not be enqueued',
    );
    await deliverAcceptanceFailure(adapter, CONVERSATION_AGENT_FAILURE_MESSAGE, options);
    return { status: 'failed' };
  }
}
