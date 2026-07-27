import { type Db, slackWorkspaces, slackWorkspaceTeams } from '@timeline/db';
import { and, eq } from 'drizzle-orm';

import { type ConversationDeliveryAdapter } from '#src/conversation-surfaces/types.js';
import { decryptJson, type EncryptedSecret } from '#src/crypto/secrets.js';
import { SlackApi } from '#src/slack/api.js';

interface SlackTokenJson {
  accessToken: string;
}

function slackConversationParts(externalConversationKey: string): {
  workspaceId: string;
  channelId: string;
} {
  const match = /^workspace:([^:]+):dm:(.+)$/.exec(externalConversationKey);
  if (!match?.[1] || !match[2]) throw new Error('Invalid Slack direct-conversation delivery key');
  return { workspaceId: match[1], channelId: match[2] };
}

async function slackApiForDelivery(
  db: Db,
  input: { teamId: string; externalConversationKey: string },
): Promise<{ api: SlackApi; channelId: string }> {
  const { workspaceId, channelId } = slackConversationParts(input.externalConversationKey);
  const rows = await db
    .select({
      tokenCiphertext: slackWorkspaces.tokenCiphertext,
      tokenIv: slackWorkspaces.tokenIv,
      tokenTag: slackWorkspaces.tokenTag,
    })
    .from(slackWorkspaceTeams)
    .innerJoin(slackWorkspaces, eq(slackWorkspaces.id, slackWorkspaceTeams.workspaceId))
    .where(
      and(
        eq(slackWorkspaceTeams.workspaceId, workspaceId),
        eq(slackWorkspaceTeams.teamId, input.teamId),
        eq(slackWorkspaceTeams.enabled, true),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error('Slack workspace is no longer enabled for this team');
  const token = decryptJson({
    ciphertext: row.tokenCiphertext,
    iv: row.tokenIv,
    tag: row.tokenTag,
  } satisfies EncryptedSecret) as SlackTokenJson;
  return { api: new SlackApi(token.accessToken), channelId };
}

export async function createSlackConversationDeliveryAdapter(input: {
  db: Db;
  teamId: string;
  externalConversationKey: string;
  externalMessageId: string;
  api?: SlackApi;
}): Promise<ConversationDeliveryAdapter> {
  const parsed = slackConversationParts(input.externalConversationKey);
  const resolved = input.api
    ? { api: input.api, channelId: parsed.channelId }
    : await slackApiForDelivery(input.db, input);
  const react = (name: string): Promise<void> =>
    resolved.api
      .addReaction({
        channel: resolved.channelId,
        timestamp: input.externalMessageId,
        name,
      })
      .catch(() => undefined);
  const send = (text: string): Promise<void> =>
    resolved.api.postMessage({ channel: resolved.channelId, text });
  return {
    acknowledgeAgentRequest: () => react('thinking_face'),
    acknowledgeCapture: () => react('eyes'),
    startProgress: () => Promise.resolve(() => undefined),
    deliverAnswer: send,
    deliverFailure: send,
  };
}
