import {
  type Db,
  documentVersions,
  documents,
  rawEvents,
  slackConversationBindings,
  slackUsers,
  slackUserTeams,
  slackWorkspaces,
  slackWorkspaceTeams,
  teamMembers,
  teams,
} from '@timeline/db';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';

import { askAgent, TEAM_BOT_ACTOR_USER_ID, type AskAgentDeps } from '#src/agent/ask.js';
import { type AgentToolErrorReporter } from '#src/agent/tools.js';
import { redactConversationError } from '#src/conversation-surfaces/privacy.js';
import { acceptDirectAgentTurn } from '#src/conversation-surfaces/runtime.js';
import { resetSurfaceSessionInTransaction } from '#src/conversation-surfaces/scope.js';
import { type DirectConversationIdentity } from '#src/conversation-surfaces/types.js';
import {
  classifyConversationalAttachment,
  CONVERSATIONAL_ATTACHMENT_LIMITS,
  extensionOf,
} from '#src/conversational/attachments.js';
import { contactMetadata, extractContactsFromText } from '#src/conversational/contact-artifacts.js';
import {
  extractLinksFromText,
  linkMetadata,
  reconcileLinkArtifactsForRawEvent,
} from '#src/conversational/link-artifacts.js';
import { encryptJson, decryptJson, type EncryptedSecret } from '#src/crypto/secrets.js';
import { buildDocumentObjectKey } from '#src/documents/object-key.js';
import { childLogger } from '#src/logger.js';
import {
  confirmRawUrlQuickJoin,
  createRawUrlQuickJoinConfirmation,
  joinSavedMeetingByCommand,
} from '#src/meetings/quick-capture.js';
import { detectMeetingPlatform } from '#src/meetings/scope.js';
import { getRedisConnection } from '#src/queue/connection.js';
import { normalizeRawEventsToEvidence } from '#src/reconciliation/normalization.js';
import { inlineSourceSnapshotMetadata } from '#src/reconciliation/source-snapshot.js';
import { SlackApi, type SlackConversation, type SlackOAuthAccessResponse } from '#src/slack/api.js';
import { createSlackConversationDeliveryAdapter } from '#src/slack/conversation-adapter.js';
import {
  slackEnvelopeSchema,
  type SlackAppMentionEvent,
  type SlackFile,
  type SlackMessageEvent,
} from '#src/slack/types.js';
import { withTeam } from '#src/team-scope.js';

const log = childLogger('slack');
const SLACK_SOURCE_SNAPSHOT_VERSION = 'slack-source-snapshot-2026-07';
const SLACK_HELP_TEXT =
  `Timeline commands:\n` +
  `/ask <question>  backward-compatible agent alias\n` +
  `/timeline note <text>  save a text note\n` +
  `/timeline new  start a new DM agent conversation\n` +
  `/timeline team [number]  list or switch eligible teams\n` +
  `/timeline whereami  show the active team\n` +
  `/timeline join <saved-meeting-alias-or-url> [optional title]  capture a meeting now\n` +
  `/timeline help  show this message`;

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

export interface SlackIngestDeps {
  db: Db;
  onAgentToolError?: AgentToolErrorReporter | undefined;
  onAgentError?: ((err: unknown) => void) | undefined;
  agentDeps?: Omit<AskAgentDeps, 'onToolError' | 'onAgentError'> | undefined;
  audio?: {
    upload(input: { key: string; body: Buffer; contentType: string }): Promise<void>;
    enqueueTranscribe(input: {
      rawEventId: string;
      teamId: string;
      audioKey: string;
    }): Promise<void>;
    buildAudioKey(input: {
      teamId: string;
      conversationId: string;
      messageTs: string;
      fileId: string;
      extension: string;
    }): string;
  };
  documents?: {
    upload(input: { key: string; body: Buffer; contentType: string }): Promise<void>;
    enqueueExtract(input: { documentVersionId: string; teamId: string }): Promise<void>;
  };
  extract?: { enqueueExtract(input: { rawEventId: string; teamId: string }): Promise<void> };
  embed?: { enqueueEmbed(input: { rawEventId: string; teamId: string }): Promise<void> };
  suggestions?: { enqueueSuggestion(input: { rawEventId: string; teamId: string }): Promise<void> };
}

interface SlackTokenJson {
  accessToken: string;
  tokenType?: string;
  scope?: string;
  authedUserAccessToken?: string;
  authedUserScope?: string;
}

export interface SlackWorkspaceRecord {
  id: string;
  slackTeamId: string;
  botUserId: string | null;
  tokenCiphertext: Buffer;
  tokenIv: Buffer;
  tokenTag: Buffer;
}

function definedString(value: string | undefined): string | null {
  return value ?? null;
}

export async function handleSlackEnvelope(
  deps: SlackIngestDeps,
  rawEnvelope: unknown,
): Promise<{ ok: boolean; challenge?: string }> {
  const parsed = slackEnvelopeSchema.safeParse(rawEnvelope);
  if (!parsed.success) return { ok: false };
  const envelope = parsed.data;
  if (envelope.type === 'url_verification') {
    return { ok: true, challenge: envelope.challenge };
  }

  try {
    const workspace = await findWorkspaceBySlackTeamId(deps.db, envelope.team_id);
    if (!workspace) return { ok: true };
    const api = new SlackApi(decryptWorkspaceToken(workspace).accessToken);
    const event = envelope.event;
    if (event.type === 'app_mention') {
      await handleAppMention(deps, api, workspace, envelope.event_id, event);
      return { ok: true };
    }
    await handleMessageEvent(deps, api, workspace, envelope.event_id, event);
  } catch (err) {
    log.error({ err: redactConversationError(err) }, 'slack dispatch failed');
    return { ok: false };
  }
  return { ok: true };
}

export interface SlackSlashCommandInput {
  command: string;
  text: string;
  user_id: string;
  team_id: string;
  channel_id: string;
  response_url: string;
  trigger_id?: string;
}

function replyToSlackCommand(
  api: SlackApi,
  input: Pick<SlackSlashCommandInput, 'channel_id' | 'response_url'>,
  text: string,
): Promise<void> {
  return api.postMessage({
    channel: input.channel_id,
    response_url: input.response_url,
    text,
  });
}

export async function handleSlackSlashCommand(
  deps: SlackIngestDeps,
  input: SlackSlashCommandInput,
  options: { deferStatelessAsk?: boolean } = {},
): Promise<void> {
  if (input.command !== '/ask' && input.command !== '/timeline') return;
  const workspace = await findWorkspaceBySlackTeamId(deps.db, input.team_id);
  if (!workspace) return;
  const api = new SlackApi(decryptWorkspaceToken(workspace).accessToken);
  if (input.command === '/ask') {
    const conversation = await api.conversationsInfo(input.channel_id).catch(() => null);
    const active = await findActiveSlackLink(deps.db, workspace.id, input.user_id);
    if (conversation?.is_im && active) {
      await queueSlackDmAgentTurn({
        db: deps.db,
        api,
        workspace,
        slackEventId:
          input.trigger_id ?? `slash:${input.team_id}:${input.channel_id}:${input.user_id}`,
        messageTs:
          input.trigger_id ?? `slash:${input.team_id}:${input.channel_id}:${input.user_id}`,
        channelId: input.channel_id,
        slackUserId: input.user_id,
        teamId: active.teamId,
        userId: active.userId,
        userName: active.displayName ?? 'a teammate',
        question: input.text,
      });
    } else {
      const answer = handleSlackAskCommand(deps, api, workspace.id, input);
      if (options.deferStatelessAsk) {
        void answer.catch((err: unknown) => {
          const safeError = redactConversationError(err);
          log.error({ err: safeError }, 'slack slash command background answer failed');
          deps.onAgentError?.(safeError);
        });
      } else {
        await answer;
      }
    }
    return;
  }
  const timelineText = input.text.trim().toLowerCase();
  if (!timelineText || timelineText === 'help') {
    await replyToSlackCommand(api, input, SLACK_HELP_TEXT);
    return;
  }
  const subcommand = timelineText.split(/\s+/, 1)[0];
  const linked = await findActiveSlackLink(deps.db, workspace.id, input.user_id);
  if (!linked) {
    if (subcommand === 'team') {
      const identity = await findVerifiedSlackIdentity(deps.db, workspace.id, input.user_id);
      if (identity) {
        const conversation = await api.conversationsInfo(input.channel_id).catch(() => null);
        await handleSlackTeamCommand(
          deps,
          api,
          workspace,
          input,
          identity,
          null,
          Boolean(conversation?.is_im),
        );
        return;
      }
    }
    await replyToSlackCommand(
      api,
      input,
      `Link your Slack identity to Timeline before using ${input.command}.`,
    );
    return;
  }
  const conversation = await api.conversationsInfo(input.channel_id).catch(() => null);
  await handleSlackTimelineCommand(
    deps,
    api,
    workspace,
    input,
    linked,
    Boolean(conversation?.is_im),
  );
}

async function handleSlackAskCommand(
  deps: {
    db: Db;
    onAgentToolError?: AgentToolErrorReporter | undefined;
    onAgentError?: ((err: unknown) => void) | undefined;
    agentDeps?: Omit<AskAgentDeps, 'onToolError' | 'onAgentError'> | undefined;
  },
  api: SlackApi,
  workspaceId: string,
  input: SlackSlashCommandInput,
): Promise<void> {
  const binding = await findSlackConversationBinding(deps.db, workspaceId, input.channel_id);
  const linkedForChannel = binding
    ? await findSlackLinkForTeam(deps.db, workspaceId, input.user_id, binding.teamId)
    : null;
  const activeLink = binding
    ? null
    : await findActiveSlackLink(deps.db, workspaceId, input.user_id);
  const route = binding
    ? {
        teamId: binding.teamId,
        userId: linkedForChannel?.userId ?? TEAM_BOT_ACTOR_USER_ID,
        userName: linkedForChannel?.displayName ?? 'a teammate',
        trustedTeamActor: !linkedForChannel,
      }
    : activeLink
      ? {
          teamId: activeLink.teamId,
          userId: activeLink.userId,
          userName: activeLink.displayName ?? 'a teammate',
          trustedTeamActor: false,
        }
      : null;
  if (!route) {
    await replyToSlackCommand(
      api,
      input,
      `Link your Slack identity to Timeline before using ${input.command}.`,
    );
    return;
  }
  const question = input.text.trim();
  if (!question) {
    await replyToSlackCommand(api, input, 'Usage: /ask what changed with Acme this week?');
    return;
  }
  const claim = await claimSlackAsk(
    input.trigger_id ?? `${input.team_id}:${input.channel_id}:${input.user_id}:${question}`,
  );
  if (!claim) return;
  try {
    const result = await askAgent(
      {
        db: deps.db,
        teamId: route.teamId,
        userId: route.userId,
        deliverySurface: 'slack',
        userName: route.userName,
        trustedTeamActor: route.trustedTeamActor,
        ...(route.trustedTeamActor
          ? {
              toolMode: 'proposal_only' as const,
              proposalOrigin: { surface: 'slack', actorKind: 'team_agent' as const },
            }
          : {}),
        question,
      },
      {
        ...deps.agentDeps,
        ...(route.trustedTeamActor ? { includeMcpTools: true } : {}),
        onToolError: deps.onAgentToolError,
        onAgentError: deps.onAgentError,
        sanitizeError: redactConversationError,
      },
    );
    await replyToSlackCommand(
      api,
      input,
      result.ok ? result.answer : 'Timeline could not answer that right now.',
    );
  } catch (err) {
    log.error({ err: redactConversationError(err) }, 'slack slash command answer failed');
    await replyToSlackCommand(api, input, 'Timeline could not answer that right now.').catch(
      (postErr: unknown) => {
        log.error({ err: postErr }, 'slack slash command failure response failed');
      },
    );
  }
}

async function handleSlackTimelineCommand(
  deps: SlackIngestDeps,
  api: SlackApi,
  workspace: SlackWorkspaceRecord,
  input: SlackSlashCommandInput,
  linked: { teamId: string; userId: string; displayName: string | null },
  isDm: boolean,
): Promise<void> {
  const [subcommandRaw = '', targetRaw = '', ...titleParts] = input.text.trim().split(/\s+/);
  const subcommand = subcommandRaw.toLowerCase();
  if (subcommand === 'whereami') {
    const rows = await deps.db
      .select({ teamId: teams.id, teamName: teams.name })
      .from(teams)
      .where(eq(teams.id, linked.teamId))
      .limit(1);
    const team = rows[0];
    await replyToSlackCommand(
      api,
      input,
      team ? `Active team: ${team.teamName} (${team.teamId}).` : `Active team: ${linked.teamId}.`,
    );
    return;
  }
  if (subcommand === 'new') {
    if (!isDm) {
      await replyToSlackCommand(
        api,
        input,
        'Start a direct message with Timeline to reset a private agent conversation.',
      );
      return;
    }
    await withTeam(deps.db, linked.teamId, linked.userId).conversations.resetSession(
      directSlackIdentity({
        workspaceId: workspace.id,
        channelId: input.channel_id,
        slackUserId: input.user_id,
        teamId: linked.teamId,
        userId: linked.userId,
        userName: linked.displayName ?? 'a teammate',
      }),
    );
    await replyToSlackCommand(api, input, 'Started a new conversation.');
    return;
  }
  if (subcommand === 'team') {
    await handleSlackTeamCommand(deps, api, workspace, input, linked, linked.teamId, isDm);
    return;
  }
  if (subcommand === 'note') {
    const note = [targetRaw, ...titleParts].join(' ').trim();
    if (!note) {
      await replyToSlackCommand(api, input, 'Usage: /timeline note <text>.');
      return;
    }
    const commandId =
      input.trigger_id ?? `command:${input.team_id}:${input.channel_id}:${input.user_id}:${note}`;
    const inserted = await insertSlackEvent(deps.db, {
      teamId: linked.teamId,
      authorUserId: linked.userId,
      text: note,
      occurredAt: new Date(),
      visibility: 'team',
      visibilityOwnerUserId: linked.userId,
      metadata: {
        slack_event_id: commandId,
        slack_workspace_id: workspace.id,
        slack_team_id: workspace.slackTeamId,
        slack_channel_id: input.channel_id,
        slack_channel_type: isDm ? 'im' : 'command',
        slack_message_ts: commandId,
        slack_sender_id: input.user_id,
        slack_sender_timeline_user_id: linked.userId,
        explicit_note: true,
      },
      isEdit: false,
      workspaceId: workspace.id,
      channelId: input.channel_id,
      messageTs: commandId,
    });
    if (inserted) await enqueueTextPipelines(deps, inserted);
    await replyToSlackCommand(api, input, 'Saved that note to the active team.');
    return;
  }
  if (subcommand !== 'join' || !targetRaw) {
    await replyToSlackCommand(api, input, SLACK_HELP_TEXT);
    return;
  }

  const maybeUrl = targetRaw.trim();
  if (detectMeetingPlatform(maybeUrl)) {
    const confirmation = await createRawUrlQuickJoinConfirmation({
      db: deps.db,
      teamId: linked.teamId,
      userId: linked.userId,
      meetingUrl: maybeUrl,
      title: titleParts.join(' ') || null,
      source: 'slack',
      sourceContext: {
        slack_team_id: input.team_id,
        slack_channel_id: input.channel_id,
        slack_user_id: input.user_id,
      },
    });
    if (!confirmation.needsConfirmation || !confirmation.confirmationId) {
      await replyToSlackCommand(
        api,
        input,
        confirmation.error ?? 'Could not prepare meeting capture confirmation.',
      );
      return;
    }
    await api.postMessage({
      channel: input.channel_id,
      response_url: input.response_url,
      text: 'Confirm participants know this call will be transcribed.',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'plain_text',
            text: 'Timeline will join this call after you confirm participants know it will be transcribed.',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Confirm and join' },
              style: 'primary',
              action_id: 'timeline_join_confirm',
              value: confirmation.confirmationId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Cancel' },
              action_id: 'timeline_join_cancel',
              value: confirmation.confirmationId,
            },
          ],
        },
      ],
    });
    return;
  }

  const joined = await joinSavedMeetingByCommand({
    db: deps.db,
    teamId: linked.teamId,
    userId: linked.userId,
    query: [targetRaw, ...titleParts].join(' '),
  });
  await api.postMessage({
    channel: input.channel_id,
    response_url: input.response_url,
    response_type: joined.ok ? 'in_channel' : 'ephemeral',
    text: joined.ok
      ? `Joining as ${joined.botName ?? 'Timeline bot'}.`
      : (joined.error ?? 'Could not join saved meeting.'),
  });
}

async function handleSlackTeamCommand(
  deps: SlackIngestDeps,
  api: SlackApi,
  workspace: SlackWorkspaceRecord,
  input: SlackSlashCommandInput,
  identity: { userId: string; displayName: string | null },
  activeTeamId: string | null,
  isDm: boolean,
): Promise<void> {
  if (!isDm) {
    await replyToSlackCommand(api, input, 'Use /timeline team in a direct message with Timeline.');
    return;
  }
  const [, targetRaw = ''] = input.text.trim().split(/\s+/, 2);
  const eligible = await listEligibleSlackTeams(
    deps.db,
    workspace.id,
    input.user_id,
    identity.userId,
  );
  if (targetRaw) {
    const number = Number.parseInt(targetRaw, 10);
    const target = Number.isInteger(number) ? eligible[number - 1] : undefined;
    if (!target) {
      await replyToSlackCommand(
        api,
        input,
        `Invalid team number. Pick one of 1..${eligible.length}.`,
      );
      return;
    }
    const changed = await activateSlackTeam({
      db: deps.db,
      workspaceId: workspace.id,
      channelId: input.channel_id,
      slackUserId: input.user_id,
      userId: identity.userId,
      userName: identity.displayName ?? 'a teammate',
      previousTeamId: activeTeamId,
      teamId: target.teamId,
    });
    await replyToSlackCommand(
      api,
      input,
      changed
        ? `Active team is now ${target.teamName} (${target.teamId}). I started a new conversation.`
        : `${target.teamName} (${target.teamId}) is already active.`,
    );
    return;
  }
  const lines = eligible.map(
    (team, index) =>
      `${index + 1}. ${team.teamName} (${team.teamId})${team.isActive ? '  ← active' : ''}`,
  );
  await replyToSlackCommand(
    api,
    input,
    `Your teams:\n${lines.join('\n')}\n\n` + 'To switch, use /timeline team <number>.',
  );
}

function directSlackIdentity(input: {
  workspaceId: string;
  channelId: string;
  slackUserId: string;
  teamId: string;
  userId: string;
  userName: string;
}): DirectConversationIdentity {
  return {
    surface: 'slack',
    externalConversationKey: `workspace:${input.workspaceId}:dm:${input.channelId}`,
    externalUserKey: `workspace:${input.workspaceId}:user:${input.slackUserId}`,
    teamId: input.teamId,
    userId: input.userId,
    userName: input.userName,
  };
}

async function listEligibleSlackTeams(
  db: Db,
  workspaceId: string,
  slackUserId: string,
  userId: string,
): Promise<{ teamId: string; teamName: string; isActive: boolean }[]> {
  const slackUserRows = await db
    .select({ id: slackUsers.id })
    .from(slackUsers)
    .where(and(eq(slackUsers.workspaceId, workspaceId), eq(slackUsers.slackUserId, slackUserId)))
    .limit(1);
  const slackUser = slackUserRows[0];
  if (!slackUser) return [];
  const rows = await db
    .select({
      teamId: teamMembers.teamId,
      teamName: teams.name,
      isActive: slackUserTeams.isActive,
    })
    .from(teamMembers)
    .innerJoin(
      slackWorkspaceTeams,
      and(
        eq(slackWorkspaceTeams.teamId, teamMembers.teamId),
        eq(slackWorkspaceTeams.workspaceId, workspaceId),
        eq(slackWorkspaceTeams.enabled, true),
      ),
    )
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .leftJoin(
      slackUserTeams,
      and(
        eq(slackUserTeams.slackUserId, slackUser.id),
        eq(slackUserTeams.teamId, teamMembers.teamId),
      ),
    )
    .where(and(eq(teamMembers.userId, userId), isNull(teamMembers.removedAt)))
    .orderBy(asc(teamMembers.createdAt), asc(teamMembers.teamId));
  return rows.map((row) => ({ ...row, isActive: row.isActive ?? false }));
}

async function activateSlackTeam(input: {
  db: Db;
  workspaceId: string;
  channelId: string;
  slackUserId: string;
  userId: string;
  userName: string;
  previousTeamId: string | null;
  teamId: string;
}): Promise<boolean> {
  if (input.previousTeamId === input.teamId) return false;
  await input.db.transaction(async (tx) => {
    const eligible = await tx
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .innerJoin(
        slackWorkspaceTeams,
        and(
          eq(slackWorkspaceTeams.teamId, teamMembers.teamId),
          eq(slackWorkspaceTeams.workspaceId, input.workspaceId),
          eq(slackWorkspaceTeams.enabled, true),
        ),
      )
      .where(
        and(
          eq(teamMembers.teamId, input.teamId),
          eq(teamMembers.userId, input.userId),
          isNull(teamMembers.removedAt),
        ),
      )
      .limit(1);
    if (!eligible[0]) throw new Error('Slack team is no longer eligible');
    if (input.previousTeamId) {
      await resetSurfaceSessionInTransaction(
        tx,
        directSlackIdentity({
          workspaceId: input.workspaceId,
          channelId: input.channelId,
          slackUserId: input.slackUserId,
          teamId: input.previousTeamId,
          userId: input.userId,
          userName: input.userName,
        }),
        'team_changed',
      );
    }
    await upsertSlackUserLink(tx, {
      workspaceId: input.workspaceId,
      slackUserId: input.slackUserId,
      teamId: input.teamId,
      userId: input.userId,
    });
  });
  log.info(
    {
      event: 'conversation_team_switched',
      surface: 'slack',
      teamId: input.teamId,
      userId: input.userId,
      status: 'active',
    },
    'Slack direct conversation team switched',
  );
  return true;
}

export async function handleSlackInteraction(
  deps: { db: Db },
  payload: unknown,
): Promise<{ ok: boolean; text?: string }> {
  if (!payload || typeof payload !== 'object') return { ok: false };
  const record = payload as Record<string, unknown>;
  const team = record.team as { id?: string } | undefined;
  const user = record.user as { id?: string } | undefined;
  const actions = Array.isArray(record.actions) ? record.actions : [];
  const action = actions[0] as { action_id?: string; value?: string } | undefined;
  const responseUrl = typeof record.response_url === 'string' ? record.response_url : undefined;
  const channel = record.channel as { id?: string } | undefined;
  if (!team?.id || !user?.id || !action?.value) return { ok: false };
  const workspace = await findWorkspaceBySlackTeamId(deps.db, team.id);
  if (!workspace) return { ok: true };
  const api = new SlackApi(decryptWorkspaceToken(workspace).accessToken);
  const linked = await findActiveSlackLink(deps.db, workspace.id, user.id);
  if (!linked) {
    await api.postMessage({
      channel: channel?.id ?? '',
      ...(responseUrl ? { response_url: responseUrl } : {}),
      text: 'Link your Slack identity to Timeline before joining calls.',
    });
    return { ok: true };
  }
  if (action.action_id === 'timeline_join_cancel') {
    const scope = withTeam(deps.db, linked.teamId, linked.userId);
    await scope.meetings.markMeetingCaptureConfirmation(action.value, 'cancelled');
    await api.postMessage({
      channel: channel?.id ?? '',
      ...(responseUrl ? { response_url: responseUrl } : {}),
      text: 'Cancelled.',
    });
    return { ok: true };
  }
  if (action.action_id !== 'timeline_join_confirm') return { ok: true };
  const joined = await confirmRawUrlQuickJoin({
    db: deps.db,
    teamId: linked.teamId,
    userId: linked.userId,
    confirmationId: action.value,
  });
  await api.postMessage({
    channel: channel?.id ?? '',
    ...(responseUrl ? { response_url: responseUrl } : {}),
    response_type: joined.ok ? 'in_channel' : 'ephemeral',
    text: joined.ok
      ? `Joining as ${joined.botName ?? 'Timeline bot'}.`
      : (joined.error ?? 'Could not join call.'),
  });
  return { ok: true };
}

export async function upsertSlackWorkspaceFromOAuth(input: {
  db: Db;
  oauth: SlackOAuthAccessResponse;
  installedByUserId: string;
  teamId: string;
}): Promise<string> {
  const oauthTeam = input.oauth.team;
  if (!oauthTeam?.id || !input.oauth.access_token)
    throw new Error('slack_oauth_missing_team_or_token');
  const tokenPayload: SlackTokenJson = {
    accessToken: input.oauth.access_token,
  };
  if (input.oauth.token_type) tokenPayload.tokenType = input.oauth.token_type;
  if (input.oauth.scope) tokenPayload.scope = input.oauth.scope;
  if (input.oauth.authed_user?.access_token) {
    tokenPayload.authedUserAccessToken = input.oauth.authed_user.access_token;
  }
  if (input.oauth.authed_user?.scope) tokenPayload.authedUserScope = input.oauth.authed_user.scope;
  const encrypted = encryptJson(tokenPayload);

  return input.db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: slackWorkspaces.id })
      .from(slackWorkspaces)
      .where(eq(slackWorkspaces.slackTeamId, oauthTeam.id))
      .limit(1);
    const now = new Date();
    const values = {
      slackTeamId: oauthTeam.id,
      slackEnterpriseId: input.oauth.enterprise?.id ?? null,
      name: oauthTeam.name ?? null,
      botUserId: input.oauth.bot_user_id ?? null,
      appId: input.oauth.app_id ?? null,
      scopes: input.oauth.scope ? input.oauth.scope.split(',').map((s) => s.trim()) : null,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenTag: encrypted.tag,
      installedByUserId: input.installedByUserId,
      updatedAt: now,
    };
    const workspaceId = existing[0]?.id
      ? (
          await tx
            .update(slackWorkspaces)
            .set(values)
            .where(eq(slackWorkspaces.id, existing[0].id))
            .returning({ id: slackWorkspaces.id })
        )[0]?.id
      : (
          await tx
            .insert(slackWorkspaces)
            .values({ ...values, createdAt: now })
            .returning({ id: slackWorkspaces.id })
        )[0]?.id;
    if (!workspaceId) throw new Error('slack_workspace_upsert_failed');
    await tx
      .insert(slackWorkspaceTeams)
      .values({
        workspaceId,
        teamId: input.teamId,
        installedByUserId: input.installedByUserId,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: [slackWorkspaceTeams.workspaceId, slackWorkspaceTeams.teamId],
        set: { enabled: true, installedByUserId: input.installedByUserId, updatedAt: now },
      });
    if (input.oauth.authed_user?.id) {
      await upsertSlackUserLink(tx, {
        workspaceId,
        slackUserId: input.oauth.authed_user.id,
        teamId: input.teamId,
        userId: input.installedByUserId,
      });
    }
    return workspaceId;
  });
}

export async function linkSlackUserFromOAuth(input: {
  db: Db;
  oauth: SlackOAuthAccessResponse;
  userId: string;
  teamId: string;
}): Promise<void> {
  if (!input.oauth.team?.id || !input.oauth.authed_user?.id)
    throw new Error('slack_oauth_missing_user');
  const slackUserId = input.oauth.authed_user.id;
  const workspace = await findWorkspaceBySlackTeamId(input.db, input.oauth.team.id);
  if (!workspace) throw new Error('slack_workspace_not_installed');
  const install = await findWorkspaceInstallForTeam(input.db, input.teamId);
  if (install?.id !== workspace.id) throw new Error('slack_workspace_not_installed');
  await input.db.transaction(async (tx) => {
    await upsertSlackUserLink(tx, {
      workspaceId: workspace.id,
      slackUserId,
      teamId: input.teamId,
      userId: input.userId,
    });
  });
}

export async function listSlackConversationsForTeam(input: {
  db: Db;
  teamId: string;
}): Promise<SlackConversation[]> {
  const install = await findWorkspaceInstallForTeam(input.db, input.teamId);
  if (!install) return [];
  const api = new SlackApi(decryptWorkspaceToken(install).accessToken);
  return api.conversationsList();
}

export async function hasSlackInstallForTeam(input: { db: Db; teamId: string }): Promise<boolean> {
  return Boolean(await findWorkspaceInstallForTeam(input.db, input.teamId));
}

export async function sendTeamSlackMessage(input: {
  db: Db;
  teamId: string;
  channelId: string;
  text: string;
}): Promise<void> {
  const install = await findWorkspaceInstallForTeam(input.db, input.teamId);
  if (!install) throw new Error('Slack workspace is no longer enabled for this team');
  const api = new SlackApi(decryptWorkspaceToken(install).accessToken);
  await api.postMessage({ channel: input.channelId, text: input.text });
}

export async function sendTeamSlackDirectMessage(input: {
  db: Db;
  teamId: string;
  slackUserId: string;
  text: string;
}): Promise<void> {
  const install = await findWorkspaceInstallForTeam(input.db, input.teamId);
  if (!install) throw new Error('Slack workspace is no longer enabled for this team');
  const api = new SlackApi(decryptWorkspaceToken(install).accessToken);
  try {
    await api.postMessage({ channel: input.slackUserId, text: input.text });
  } catch {
    const opened = await api.conversationsOpen(input.slackUserId);
    await api.postMessage({ channel: opened.id, text: input.text });
  }
}

export async function bindSlackConversation(input: {
  db: Db;
  teamId: string;
  userId: string;
  conversationId: string;
}): Promise<void> {
  const install = await findWorkspaceInstallForTeam(input.db, input.teamId);
  if (!install) throw new Error('slack_workspace_not_installed');
  const api = new SlackApi(decryptWorkspaceToken(install).accessToken);
  const info = await api.conversationsInfo(input.conversationId);
  const values = {
    conversationType: conversationType(info),
    title: info?.name ?? input.conversationId,
    boundByUserId: input.userId,
    visibilityDefault: 'team' as const,
    enabled: true,
    metadata: { is_member: info?.is_member ?? null },
    updatedAt: new Date(),
  };
  const disabledRows = await input.db
    .select({ id: slackConversationBindings.id })
    .from(slackConversationBindings)
    .where(
      and(
        eq(slackConversationBindings.workspaceId, install.id),
        eq(slackConversationBindings.teamId, input.teamId),
        eq(slackConversationBindings.slackConversationId, input.conversationId),
        eq(slackConversationBindings.enabled, false),
      ),
    )
    .orderBy(desc(slackConversationBindings.updatedAt), desc(slackConversationBindings.createdAt))
    .limit(1);
  const disabled = disabledRows[0];
  if (disabled) {
    await input.db
      .update(slackConversationBindings)
      .set(values)
      .where(eq(slackConversationBindings.id, disabled.id));
    return;
  }
  await input.db.insert(slackConversationBindings).values({
    workspaceId: install.id,
    teamId: input.teamId,
    slackConversationId: input.conversationId,
    ...values,
  });
}

export async function unbindSlackConversation(input: {
  db: Db;
  teamId: string;
  bindingId: string;
}): Promise<void> {
  await input.db
    .update(slackConversationBindings)
    .set({ enabled: false, updatedAt: new Date() })
    .where(
      and(
        eq(slackConversationBindings.id, input.bindingId),
        eq(slackConversationBindings.teamId, input.teamId),
      ),
    );
}

async function handleAppMention(
  deps: SlackIngestDeps,
  api: SlackApi,
  workspace: SlackWorkspaceRecord,
  slackEventId: string,
  event: SlackAppMentionEvent,
): Promise<void> {
  if (event.user && event.user === workspace.botUserId) return;
  if (!event.user) return;
  const route = await resolveSlackRoute(
    deps.db,
    workspace.id,
    event.user,
    event.channel,
    event.channel_type,
  );
  if (!route) return;
  const claimed = await claimSlackAsk(slackEventId);
  if (!claimed) return;
  const question = (event.text ?? '').replace(/<@[^>]+>/g, '').trim();
  if (!question) {
    await api.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts ?? event.ts,
      text: 'Ask a question after mentioning Timeline, for example: @Timeline what changed with Acme this week?',
    });
    return;
  }
  try {
    const result = await askAgent(
      {
        db: deps.db,
        teamId: route.teamId,
        userId: route.linkedUserId ?? TEAM_BOT_ACTOR_USER_ID,
        deliverySurface: 'slack',
        userName: route.linkedUserName ?? 'a teammate',
        trustedTeamActor: !route.linkedUserId && !route.isDm,
        ...(!route.linkedUserId && !route.isDm
          ? {
              toolMode: 'proposal_only' as const,
              proposalOrigin: { surface: 'slack', actorKind: 'team_agent' as const },
            }
          : {}),
        question,
      },
      {
        ...deps.agentDeps,
        ...(!route.linkedUserId && !route.isDm ? { includeMcpTools: true } : {}),
        onToolError: deps.onAgentToolError,
        onAgentError: deps.onAgentError,
        sanitizeError: redactConversationError,
      },
    );
    await api.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts ?? event.ts,
      text: result.ok ? result.answer : 'Timeline could not answer that right now.',
    });
  } catch (err) {
    log.error({ err: redactConversationError(err) }, 'slack app mention answer failed');
    await api
      .postMessage({
        channel: event.channel,
        thread_ts: event.thread_ts ?? event.ts,
        text: 'Timeline could not answer that right now.',
      })
      .catch((postErr: unknown) => {
        log.error({ err: postErr }, 'slack app mention failure response failed');
      });
  }
}

async function handleMessageEvent(
  deps: SlackIngestDeps,
  api: SlackApi,
  workspace: SlackWorkspaceRecord,
  slackEventId: string,
  event: SlackMessageEvent,
): Promise<void> {
  if (event.subtype === 'message_deleted') {
    await tombstoneSlackSourceDeletes(deps.db, {
      workspaceId: workspace.id,
      channel: event.channel,
      ts: event.deleted_ts ?? event.previous_message?.ts ?? event.ts,
    });
    return;
  }
  if (event.bot_id || event.user === workspace.botUserId) return;
  if (event.subtype && event.subtype !== 'message_changed' && event.subtype !== 'file_share') {
    return;
  }

  const message = event.subtype === 'message_changed' ? event.message : event;
  if (message?.bot_id) return;
  const senderId = message?.user ?? event.user;
  if (!senderId || senderId === workspace.botUserId) return;
  const isEdit = event.subtype === 'message_changed';
  const text = message?.text ?? event.text ?? '';
  const ts = isEdit ? (message?.ts ?? event.previous_message?.ts) : (message?.ts ?? event.ts);
  if (!ts) return;
  const eventTs = isEdit ? (event.event_ts ?? event.ts) : (event.event_ts ?? ts);
  const threadTs = message?.thread_ts ?? event.thread_ts;
  const files = message?.files ?? event.files ?? [];

  const route = await resolveSlackRoute(
    deps.db,
    workspace.id,
    senderId,
    event.channel,
    event.channel_type,
  );
  if (!route) return;
  if (route.isDm && files.length === 0) {
    if (isEdit) return;
    if (text.trim() && route.linkedUserId) {
      const sender = await findCachedSlackUserProfile(deps.db, workspace.id, senderId);
      await queueSlackDmAgentTurn({
        db: deps.db,
        api,
        workspace,
        slackEventId,
        messageTs: ts,
        channelId: event.channel,
        slackUserId: senderId,
        teamId: route.teamId,
        userId: route.linkedUserId,
        userName: sender?.realName ?? sender?.name ?? senderId,
        question: text,
      });
      void upsertSlackUserProfile(deps.db, api, workspace.id, senderId).catch((err: unknown) => {
        log.warn(
          { err: redactConversationError(err) },
          'Slack direct-message profile refresh failed',
        );
      });
    }
    return;
  }
  const sender = await upsertSlackUserProfile(deps.db, api, workspace.id, senderId);
  const senderDisplayName = sender?.realName ?? sender?.name ?? senderId;
  const authorUserId = route.linkedUserId;
  const metadata: Record<string, unknown> = {
    slack_event_id: slackEventId,
    slack_workspace_id: workspace.id,
    slack_team_id: workspace.slackTeamId,
    slack_channel_id: event.channel,
    slack_channel_type: event.channel_type ?? route.conversationType,
    slack_message_ts: ts,
    slack_event_ts: eventTs,
    slack_thread_ts: threadTs ?? null,
    slack_sender_id: senderId,
    slack_sender_name: senderDisplayName,
    slack_sender_timeline_user_id: route.linkedUserId,
    source_owner_user_id: route.sourceOwnerUserId,
    source_unverified: !route.linkedUserId,
    attachments: files.map(fileSummary),
    ...slackSourcePayloadMetadata({
      workspace,
      slackEventId,
      event,
      message,
      senderDisplayName,
      eventTs,
      ts,
      threadTs,
      route,
      files,
    }),
  };
  const links = extractLinksFromText(text);
  if (links.length > 0) metadata.links = linkMetadata(links);
  const contacts = extractContactsFromText(text);
  if (contacts.length > 0) metadata.contacts = contactMetadata(contacts);
  if (route.conversationTitle) metadata.slack_channel_name = route.conversationTitle;
  if (isEdit)
    metadata.edits_event_id = await findRootSlackEventId(
      deps.db,
      route.teamId,
      workspace.id,
      event.channel,
      ts,
    );

  const inserted = await insertSlackEvent(deps.db, {
    teamId: route.teamId,
    authorUserId,
    text,
    occurredAt: slackTsToDate(eventTs),
    visibility: route.visibility,
    visibilityOwnerUserId: route.sourceOwnerUserId,
    metadata,
    isEdit,
    workspaceId: workspace.id,
    channelId: event.channel,
    messageTs: ts,
  });
  const target =
    inserted ??
    (files.length > 0 || links.length > 0
      ? await findEventBySlackEventId(deps.db, slackEventId)
      : null);
  if (target && links.length > 0) {
    await reconcileLinkArtifactsForRawEvent(deps.db, {
      teamId: target.teamId,
      rawEventId: target.id,
      text,
      occurredAt: slackTsToDate(eventTs),
    }).catch((err: unknown) => {
      log.warn({ err, rawEventId: target.id }, 'slack link artifact reconciliation failed');
    });
  }
  if (inserted) {
    if (text.trim()) await enqueueTextPipelines(deps, inserted);
  }
  if (target) {
    await processSlackAttachments(deps, api, {
      teamId: target.teamId,
      parentRawEventId: target.id,
      parentAuthorUserId: authorUserId,
      visibility: route.visibility,
      files,
      workspace,
      channelId: event.channel,
      messageTs: ts,
      sourceOwnerUserId: route.sourceOwnerUserId,
    });
  }
  if (!isEdit && route.isDm && inserted) {
    await api
      .addReaction({ channel: event.channel, timestamp: ts, name: 'eyes' })
      .catch((err: unknown) => {
        log.warn({ err }, 'slack reaction failed');
      });
  }
}

async function queueSlackDmAgentTurn(input: {
  db: Db;
  api: SlackApi;
  workspace: SlackWorkspaceRecord;
  slackEventId: string;
  messageTs: string;
  channelId: string;
  slackUserId: string;
  teamId: string;
  userId: string;
  userName: string;
  question: string;
}): Promise<void> {
  const question = input.question.trim();
  if (!question) return;
  const identity = directSlackIdentity({
    workspaceId: input.workspace.id,
    channelId: input.channelId,
    slackUserId: input.slackUserId,
    teamId: input.teamId,
    userId: input.userId,
    userName: input.userName,
  });
  await acceptDirectAgentTurn(
    input.db,
    {
      ...identity,
      externalEventId: input.slackEventId,
      externalMessageId: input.messageTs,
      question,
    },
    await createSlackConversationDeliveryAdapter({
      db: input.db,
      teamId: input.teamId,
      externalConversationKey: identity.externalConversationKey,
      externalMessageId: input.messageTs,
      api: input.api,
    }),
    {
      providerAcknowledgement: 'background',
      validateRoute: async (tx) => {
        const rows = await tx
          .select({ id: slackUserTeams.id })
          .from(slackUsers)
          .innerJoin(slackUserTeams, eq(slackUserTeams.slackUserId, slackUsers.id))
          .innerJoin(
            slackWorkspaceTeams,
            and(
              eq(slackWorkspaceTeams.workspaceId, input.workspace.id),
              eq(slackWorkspaceTeams.teamId, slackUserTeams.teamId),
              eq(slackWorkspaceTeams.enabled, true),
            ),
          )
          .innerJoin(
            teamMembers,
            and(
              eq(teamMembers.teamId, slackUserTeams.teamId),
              eq(teamMembers.userId, slackUserTeams.userId),
              isNull(teamMembers.removedAt),
            ),
          )
          .where(
            and(
              eq(slackUsers.workspaceId, input.workspace.id),
              eq(slackUsers.slackUserId, input.slackUserId),
              eq(slackUserTeams.teamId, identity.teamId),
              eq(slackUserTeams.userId, identity.userId),
              eq(slackUserTeams.isActive, true),
            ),
          )
          .limit(1);
        return Boolean(rows[0]);
      },
      routeInactiveMessage:
        'This Slack conversation no longer has an active Timeline team. Choose a team before asking the agent.',
    },
  );
}

function slackSourcePayloadMetadata(input: {
  workspace: SlackWorkspaceRecord;
  slackEventId: string;
  event: SlackMessageEvent;
  message: SlackMessageEvent['message'] | SlackMessageEvent;
  senderDisplayName: string;
  eventTs: string;
  ts: string;
  threadTs: string | undefined;
  route: {
    conversationType: string;
    conversationTitle: string | null;
    linkedUserId: string | null;
  };
  files: SlackFile[];
}): Record<string, unknown> {
  const snapshot = {
    provider: 'slack',
    slack_event_id: input.slackEventId,
    workspace_id: input.workspace.id,
    slack_team_id: input.workspace.slackTeamId,
    channel_id: input.event.channel,
    channel_type: input.event.channel_type ?? input.route.conversationType,
    channel_title: input.route.conversationTitle,
    message_ts: input.ts,
    event_ts: input.eventTs,
    thread_ts: input.threadTs ?? null,
    subtype: input.event.subtype ?? null,
    sender_id: input.message?.user ?? input.event.user ?? null,
    sender_name: input.senderDisplayName,
    linked_user_id: input.route.linkedUserId,
    text: input.message?.text ?? input.event.text ?? null,
    files: input.files.map(fileSummary),
  };
  return inlineSourceSnapshotMetadata({
    snapshot,
    kind: 'slack_message_event',
    version: SLACK_SOURCE_SNAPSHOT_VERSION,
    ref: () => `inline://timeline/slack/${input.workspace.id}/${input.slackEventId}`,
  });
}

async function insertSlackEvent(
  db: Db,
  input: {
    teamId: string;
    authorUserId: string | null;
    text: string | null;
    occurredAt: Date;
    visibility: 'team' | 'private' | 'specific_users';
    visibilityOwnerUserId: string | null;
    metadata: Record<string, unknown>;
    isEdit: boolean;
    workspaceId: string;
    channelId: string;
    messageTs: string;
  },
): Promise<{ id: string; teamId: string } | null> {
  const values = {
    teamId: input.teamId,
    authorUserId: input.authorUserId,
    source: 'slack' as const,
    contentText: input.text,
    occurredAt: input.occurredAt,
    visibility: input.visibility,
    visibilityOwnerUserId: input.visibilityOwnerUserId,
    sourceMetadata: input.metadata,
  };
  async function insert(tx: DbOrTx) {
    const rows = await tx
      .insert(rawEvents)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: rawEvents.id, teamId: rawEvents.teamId });
    return rows[0] ?? null;
  }
  const row = !input.isEdit
    ? await insert(db)
    : await db.transaction(async (tx) => {
        await lockSlackMessageRevisions(tx, input);
        const row = await insert(tx);
        const latest = await findLatestSlackRevision(tx, input);
        if (latest) {
          await tombstoneSupersededSlackRevisions(tx, { ...input, supersededByEventId: latest.id });
        }
        return row && latest?.id === row.id ? row : null;
      });
  if (row) await normalizeRawEventEvidence(db, row);
  return row;
}

async function normalizeRawEventEvidence(
  db: Db,
  row: { id: string; teamId: string },
): Promise<void> {
  try {
    await normalizeRawEventsToEvidence({ db, teamId: row.teamId, rawEventIds: [row.id] });
  } catch (err) {
    log.warn(
      { err, teamId: row.teamId, rawEventId: row.id },
      'slack reconciliation evidence normalization failed',
    );
  }
}

async function resolveSlackRoute(
  db: Db,
  workspaceId: string,
  slackUserId: string,
  channelId: string,
  channelType?: string,
): Promise<{
  teamId: string;
  sourceOwnerUserId: string | null;
  linkedUserId: string | null;
  visibility: 'team' | 'private' | 'specific_users';
  isDm: boolean;
  conversationType: string;
  conversationTitle: string | null;
  linkedUserName: string | null;
} | null> {
  if (channelType === 'im') {
    const linked = await findActiveSlackLink(db, workspaceId, slackUserId);
    if (!linked) return null;
    return {
      teamId: linked.teamId,
      sourceOwnerUserId: linked.userId,
      linkedUserId: linked.userId,
      visibility: 'team',
      isDm: true,
      conversationType: 'im',
      conversationTitle: null,
      linkedUserName: linked.displayName,
    };
  }
  const bindings = await db
    .select()
    .from(slackConversationBindings)
    .where(
      and(
        eq(slackConversationBindings.workspaceId, workspaceId),
        eq(slackConversationBindings.slackConversationId, channelId),
        eq(slackConversationBindings.enabled, true),
      ),
    )
    .limit(1);
  const binding = bindings[0];
  if (!binding) return null;
  const linkedForTeam = await findSlackLinkForTeam(db, workspaceId, slackUserId, binding.teamId);
  return {
    teamId: binding.teamId,
    sourceOwnerUserId: binding.boundByUserId,
    linkedUserId: linkedForTeam?.userId ?? null,
    visibility: binding.visibilityDefault,
    isDm: false,
    conversationType: binding.conversationType,
    conversationTitle: binding.title,
    linkedUserName: linkedForTeam?.displayName ?? null,
  };
}

async function processSlackAttachments(
  deps: SlackIngestDeps,
  api: SlackApi,
  input: {
    teamId: string;
    parentRawEventId: string;
    parentAuthorUserId: string | null;
    visibility: 'team' | 'private' | 'specific_users';
    files: SlackFile[];
    workspace: SlackWorkspaceRecord;
    channelId: string;
    messageTs: string;
    sourceOwnerUserId: string | null;
  },
): Promise<void> {
  let processed = 0;
  const skipped: Record<string, unknown>[] = [];
  for (const file of input.files) {
    const filename = file.name ?? file.title ?? file.id;
    if (
      await slackAttachmentAlreadyProcessed(deps.db, {
        parentRawEventId: input.parentRawEventId,
        workspaceId: input.workspace.id,
        channelId: input.channelId,
        messageTs: input.messageTs,
        fileId: file.id,
      })
    ) {
      continue;
    }
    const decision =
      processed >= CONVERSATIONAL_ATTACHMENT_LIMITS.maxProcessedPerMessage
        ? { kind: 'skip' as const, reason: 'too_many_attachments' }
        : classifyConversationalAttachment({
            filename,
            contentType: definedString(file.mimetype),
            sizeBytes: file.size ?? null,
          });
    if (decision.kind === 'skip') {
      skipped.push({
        source: 'slack',
        file_id: file.id,
        filename,
        mimetype: file.mimetype ?? null,
        size: file.size ?? null,
        reason: decision.reason,
      });
      continue;
    }
    processed += 1;
    let bytes: Buffer;
    try {
      bytes = await api.downloadFile(file, CONVERSATIONAL_ATTACHMENT_LIMITS.maxBytes);
      if (bytes.length > CONVERSATIONAL_ATTACHMENT_LIMITS.maxBytes)
        throw new Error('file_oversize');
    } catch (err) {
      log.error({ err, fileId: file.id }, 'slack attachment download failed');
      skipped.push({
        source: 'slack',
        file_id: file.id,
        filename,
        mimetype: file.mimetype ?? null,
        size: file.size ?? null,
        reason:
          err instanceof Error && err.message === 'file_oversize' ? 'oversize' : 'download_failed',
      });
      continue;
    }
    const contentType =
      file.mimetype ?? (decision.kind === 'audio' ? 'application/octet-stream' : 'text/plain');
    if (decision.kind === 'audio') {
      if (!deps.audio) continue;
      const ext = extensionOf(filename) || 'bin';
      const key = deps.audio.buildAudioKey({
        teamId: input.teamId,
        conversationId: input.channelId,
        messageTs: input.messageTs,
        fileId: file.id,
        extension: ext,
      });
      await deps.audio.upload({ key, body: bytes, contentType });
      const rows = await deps.db
        .insert(rawEvents)
        .values({
          teamId: input.teamId,
          authorUserId: input.parentAuthorUserId,
          source: 'slack',
          contentText: null,
          contentAudioUrl: key,
          visibility: input.visibility,
          visibilityOwnerUserId: input.parentAuthorUserId ?? input.sourceOwnerUserId,
          sourceMetadata: slackAudioAttachmentSourceMetadata({
            input,
            file,
            filename,
            contentType,
            audioKey: key,
          }),
        })
        .returning({ id: rawEvents.id, teamId: rawEvents.teamId });
      const row = rows[0];
      if (row) {
        await normalizeRawEventEvidence(deps.db, row);
        await deps.audio.enqueueTranscribe({
          rawEventId: row.id,
          teamId: row.teamId,
          audioKey: key,
        });
      }
    } else {
      if (!deps.documents) continue;
      await createSlackDocumentAttachment(deps, {
        ...input,
        file,
        filename,
        bytes,
        contentType,
      });
    }
  }
  if (skipped.length > 0) {
    const patch = JSON.stringify({ attachment_skips: skipped });
    await deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
      })
      .where(eq(rawEvents.id, input.parentRawEventId));
  }
}

function slackAudioAttachmentSourceMetadata(args: {
  input: {
    parentRawEventId: string;
    workspace: SlackWorkspaceRecord;
    channelId: string;
    messageTs: string;
    sourceOwnerUserId: string | null;
  };
  file: SlackFile;
  filename: string;
  contentType: string;
  audioKey: string;
}): Record<string, unknown> {
  const snapshot = {
    provider: 'slack',
    capture_kind: 'audio_attachment',
    workspace_id: args.input.workspace.id,
    slack_team_id: args.input.workspace.slackTeamId,
    channel_id: args.input.channelId,
    message_ts: args.input.messageTs,
    parent_raw_event_id: args.input.parentRawEventId,
    source_owner_user_id: args.input.sourceOwnerUserId,
    audio_key: args.audioKey,
    content_type: args.contentType,
    file: fileSummary(args.file),
  };
  return {
    slack_attachment_kind: 'audio',
    slack_file_id: args.file.id,
    slack_file_name: args.filename,
    slack_parent_raw_event_id: args.input.parentRawEventId,
    slack_workspace_id: args.input.workspace.id,
    slack_channel_id: args.input.channelId,
    slack_message_ts: args.input.messageTs,
    source_owner_user_id: args.input.sourceOwnerUserId,
    ...inlineSourceSnapshotMetadata({
      snapshot,
      kind: 'slack_audio_attachment',
      version: SLACK_SOURCE_SNAPSHOT_VERSION,
      ref: () =>
        `inline://timeline/slack/${args.input.workspace.id}/${args.input.channelId}/${args.input.messageTs}/attachment/${args.file.id}`,
    }),
  };
}

async function slackAttachmentAlreadyProcessed(
  db: Db,
  input: {
    parentRawEventId: string;
    workspaceId: string;
    channelId: string;
    messageTs: string;
    fileId: string;
  },
): Promise<boolean> {
  const audioRows = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(
      and(
        sql`${rawEvents.sourceMetadata} ->> 'slack_workspace_id' = ${input.workspaceId}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_channel_id' = ${input.channelId}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_message_ts' = ${input.messageTs}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_file_id' = ${input.fileId}`,
      ),
    )
    .limit(1);
  if (audioRows[0]) return true;

  const docRows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        sql`${documents.metadata} ->> 'slack_workspace_id' = ${input.workspaceId}`,
        sql`${documents.metadata} ->> 'slack_channel_id' = ${input.channelId}`,
        sql`${documents.metadata} ->> 'slack_message_ts' = ${input.messageTs}`,
        sql`${documents.metadata} ->> 'slack_file_id' = ${input.fileId}`,
      ),
    )
    .limit(1);
  return Boolean(docRows[0]);
}

async function findEventBySlackEventId(
  db: Db,
  slackEventId: string,
): Promise<{ id: string; teamId: string } | null> {
  const rows = await db
    .select({ id: rawEvents.id, teamId: rawEvents.teamId })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.source, 'slack'),
        sql`${rawEvents.sourceMetadata} ->> 'slack_event_id' = ${slackEventId}`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function createSlackDocumentAttachment(
  deps: SlackIngestDeps,
  input: {
    teamId: string;
    parentRawEventId: string;
    parentAuthorUserId: string | null;
    visibility: 'team' | 'private' | 'specific_users';
    workspace: SlackWorkspaceRecord;
    channelId: string;
    messageTs: string;
    sourceOwnerUserId: string | null;
    file: SlackFile;
    filename: string;
    bytes: Buffer;
    contentType: string;
  },
): Promise<void> {
  const documentDeps = deps.documents;
  if (!documentDeps) return;
  const created = await deps.db.transaction(async (tx) => {
    const docRows = await tx
      .insert(documents)
      .values({
        teamId: input.teamId,
        fileKind: 'captured',
        name: input.filename,
        ownerUserId: input.parentAuthorUserId ?? input.sourceOwnerUserId,
        visibility: input.visibility,
        sourceRawEventId: input.parentRawEventId,
        metadata: {
          source: 'slack',
          slack_file_id: input.file.id,
          slack_workspace_id: input.workspace.id,
          slack_channel_id: input.channelId,
          slack_message_ts: input.messageTs,
          parent_raw_event_id: input.parentRawEventId,
        },
      })
      .returning({ id: documents.id });
    const doc = docRows[0];
    if (!doc) throw new Error('slack_document_insert_failed');
    const key = buildDocumentObjectKey({
      teamId: input.teamId,
      documentId: doc.id,
      version: 1,
      filename: input.filename,
    });
    const versionRows = await tx
      .insert(documentVersions)
      .values({
        teamId: input.teamId,
        documentId: doc.id,
        version: 1,
        objectKey: key,
        byteSize: input.bytes.length,
        contentType: input.contentType,
        uploadedByUserId: input.parentAuthorUserId,
        sourceEventId: input.parentRawEventId,
        processingStatus: 'pending',
      })
      .returning({ id: documentVersions.id, objectKey: documentVersions.objectKey });
    const version = versionRows[0];
    if (!version) throw new Error('slack_document_version_insert_failed');
    await tx
      .update(documents)
      .set({ currentVersionId: version.id })
      .where(eq(documents.id, doc.id));
    return { key, versionId: version.id };
  });
  await documentDeps.upload({
    key: created.key,
    body: input.bytes,
    contentType: input.contentType,
  });
  await documentDeps.enqueueExtract({ documentVersionId: created.versionId, teamId: input.teamId });
}

async function enqueueTextPipelines(
  deps: SlackIngestDeps,
  row: { id: string; teamId: string },
): Promise<void> {
  await deps.extract
    ?.enqueueExtract({ rawEventId: row.id, teamId: row.teamId })
    .catch((err: unknown) => {
      log.error({ err, rawEventId: row.id }, 'slack extract enqueue failed');
    });
  await deps.embed
    ?.enqueueEmbed({ rawEventId: row.id, teamId: row.teamId })
    .catch((err: unknown) => {
      log.error({ err, rawEventId: row.id }, 'slack embed enqueue failed');
    });
  await deps.suggestions
    ?.enqueueSuggestion({ rawEventId: row.id, teamId: row.teamId })
    .catch((err: unknown) => {
      log.error({ err, rawEventId: row.id }, 'slack suggestion enqueue failed');
    });
}

function fileSummary(file: SlackFile): Record<string, unknown> {
  return {
    id: file.id,
    name: file.name ?? file.title ?? file.id,
    mimetype: file.mimetype ?? null,
    size: file.size ?? null,
  };
}

async function findWorkspaceBySlackTeamId(
  db: Db,
  slackTeamId: string | undefined,
): Promise<SlackWorkspaceRecord | null> {
  if (!slackTeamId) return null;
  const rows = await db
    .select({
      id: slackWorkspaces.id,
      slackTeamId: slackWorkspaces.slackTeamId,
      botUserId: slackWorkspaces.botUserId,
      tokenCiphertext: slackWorkspaces.tokenCiphertext,
      tokenIv: slackWorkspaces.tokenIv,
      tokenTag: slackWorkspaces.tokenTag,
    })
    .from(slackWorkspaces)
    .where(eq(slackWorkspaces.slackTeamId, slackTeamId))
    .limit(1);
  return rows[0] ?? null;
}

async function findWorkspaceInstallForTeam(
  db: Db,
  teamId: string,
): Promise<SlackWorkspaceRecord | null> {
  const rows = await db
    .select({
      id: slackWorkspaces.id,
      slackTeamId: slackWorkspaces.slackTeamId,
      botUserId: slackWorkspaces.botUserId,
      tokenCiphertext: slackWorkspaces.tokenCiphertext,
      tokenIv: slackWorkspaces.tokenIv,
      tokenTag: slackWorkspaces.tokenTag,
    })
    .from(slackWorkspaceTeams)
    .innerJoin(slackWorkspaces, eq(slackWorkspaces.id, slackWorkspaceTeams.workspaceId))
    .where(and(eq(slackWorkspaceTeams.teamId, teamId), eq(slackWorkspaceTeams.enabled, true)))
    .limit(1);
  return rows[0] ?? null;
}

function decryptWorkspaceToken(workspace: SlackWorkspaceRecord): SlackTokenJson {
  return decryptJson({
    ciphertext: workspace.tokenCiphertext,
    iv: workspace.tokenIv,
    tag: workspace.tokenTag,
  } satisfies EncryptedSecret) as SlackTokenJson;
}

async function upsertSlackUserLink(
  tx: DbOrTx,
  input: { workspaceId: string; slackUserId: string; teamId: string; userId: string },
): Promise<void> {
  const now = new Date();
  const userRows = await tx
    .insert(slackUsers)
    .values({ workspaceId: input.workspaceId, slackUserId: input.slackUserId })
    .onConflictDoUpdate({
      target: [slackUsers.workspaceId, slackUsers.slackUserId],
      set: { updatedAt: now },
    })
    .returning({ id: slackUsers.id });
  const slackUserRow = userRows[0];
  if (!slackUserRow) throw new Error('slack_user_upsert_failed');
  await tx
    .update(slackUserTeams)
    .set({ isActive: false, updatedAt: now })
    .where(and(eq(slackUserTeams.slackUserId, slackUserRow.id), eq(slackUserTeams.isActive, true)));
  await tx
    .insert(slackUserTeams)
    .values({
      slackUserId: slackUserRow.id,
      teamId: input.teamId,
      userId: input.userId,
      linkedByUserId: input.userId,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [slackUserTeams.slackUserId, slackUserTeams.teamId],
      set: { userId: input.userId, linkedByUserId: input.userId, isActive: true, updatedAt: now },
    });
}

async function upsertSlackUserProfile(
  db: Db,
  api: SlackApi,
  workspaceId: string,
  slackUserId: string,
): Promise<{ name: string | null; realName: string | null } | null> {
  async function preserveExistingProfile() {
    const existing = await db
      .select({ name: slackUsers.name, realName: slackUsers.realName })
      .from(slackUsers)
      .where(and(eq(slackUsers.workspaceId, workspaceId), eq(slackUsers.slackUserId, slackUserId)))
      .limit(1);
    if (existing[0]) return existing[0];
    const rows = await db
      .insert(slackUsers)
      .values({ workspaceId, slackUserId })
      .onConflictDoUpdate({
        target: [slackUsers.workspaceId, slackUsers.slackUserId],
        set: { updatedAt: new Date() },
      })
      .returning({ name: slackUsers.name, realName: slackUsers.realName });
    return rows[0] ?? null;
  }

  let profile: Awaited<ReturnType<SlackApi['usersInfo']>>;
  try {
    profile = await api.usersInfo(slackUserId);
  } catch {
    return preserveExistingProfile();
  }
  if (!profile) return preserveExistingProfile();

  const name = profile.profile?.display_name ?? profile.name ?? null;
  const realName = profile.profile?.real_name ?? profile.real_name ?? null;
  const email = profile.profile?.email ?? null;
  const avatarUrl = profile.profile?.image_72 ?? null;
  const rows = await db
    .insert(slackUsers)
    .values({
      workspaceId,
      slackUserId,
      name,
      realName,
      email,
      avatarUrl,
      metadata: profile,
    })
    .onConflictDoUpdate({
      target: [slackUsers.workspaceId, slackUsers.slackUserId],
      set: {
        name,
        realName,
        email,
        avatarUrl,
        metadata: profile,
        updatedAt: new Date(),
      },
    })
    .returning({ name: slackUsers.name, realName: slackUsers.realName });
  return rows[0] ?? null;
}

async function findCachedSlackUserProfile(
  db: Db,
  workspaceId: string,
  slackUserId: string,
): Promise<{ name: string | null; realName: string | null } | null> {
  const rows = await db
    .select({ name: slackUsers.name, realName: slackUsers.realName })
    .from(slackUsers)
    .where(and(eq(slackUsers.workspaceId, workspaceId), eq(slackUsers.slackUserId, slackUserId)))
    .limit(1);
  return rows[0] ?? null;
}

async function findVerifiedSlackIdentity(
  db: Db,
  workspaceId: string,
  slackUserId: string,
): Promise<{ userId: string; displayName: string | null } | null> {
  const rows = await db
    .select({
      userId: slackUserTeams.userId,
      displayName: slackUsers.realName,
    })
    .from(slackUsers)
    .innerJoin(slackUserTeams, eq(slackUserTeams.slackUserId, slackUsers.id))
    .where(and(eq(slackUsers.workspaceId, workspaceId), eq(slackUsers.slackUserId, slackUserId)))
    .orderBy(desc(slackUserTeams.isActive), desc(slackUserTeams.updatedAt))
    .limit(1);
  return rows[0] ?? null;
}

async function findActiveSlackLink(
  db: Db,
  workspaceId: string,
  slackUserId: string,
): Promise<{ teamId: string; userId: string; displayName: string | null } | null> {
  const rows = await db
    .select({
      teamId: slackUserTeams.teamId,
      userId: slackUserTeams.userId,
      displayName: slackUsers.realName,
      memberUserId: teamMembers.userId,
    })
    .from(slackUsers)
    .innerJoin(slackUserTeams, eq(slackUserTeams.slackUserId, slackUsers.id))
    .innerJoin(
      slackWorkspaceTeams,
      and(
        eq(slackWorkspaceTeams.workspaceId, workspaceId),
        eq(slackWorkspaceTeams.teamId, slackUserTeams.teamId),
        eq(slackWorkspaceTeams.enabled, true),
      ),
    )
    .innerJoin(
      teamMembers,
      and(
        eq(teamMembers.teamId, slackUserTeams.teamId),
        eq(teamMembers.userId, slackUserTeams.userId),
        isNull(teamMembers.removedAt),
      ),
    )
    .where(
      and(
        eq(slackUsers.workspaceId, workspaceId),
        eq(slackUsers.slackUserId, slackUserId),
        eq(slackUserTeams.isActive, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function findSlackConversationBinding(
  db: Db,
  workspaceId: string,
  channelId: string,
): Promise<{ teamId: string } | null> {
  const rows = await db
    .select({ teamId: slackConversationBindings.teamId })
    .from(slackConversationBindings)
    .where(
      and(
        eq(slackConversationBindings.workspaceId, workspaceId),
        eq(slackConversationBindings.slackConversationId, channelId),
        eq(slackConversationBindings.enabled, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function findSlackLinkForTeam(
  db: Db,
  workspaceId: string,
  slackUserId: string,
  teamId: string,
): Promise<{ userId: string; displayName: string | null } | null> {
  const rows = await db
    .select({
      userId: slackUserTeams.userId,
      displayName: slackUsers.realName,
    })
    .from(slackUsers)
    .innerJoin(slackUserTeams, eq(slackUserTeams.slackUserId, slackUsers.id))
    .innerJoin(
      slackWorkspaceTeams,
      and(
        eq(slackWorkspaceTeams.workspaceId, workspaceId),
        eq(slackWorkspaceTeams.teamId, slackUserTeams.teamId),
        eq(slackWorkspaceTeams.enabled, true),
      ),
    )
    .innerJoin(
      teamMembers,
      and(
        eq(teamMembers.teamId, slackUserTeams.teamId),
        eq(teamMembers.userId, slackUserTeams.userId),
        isNull(teamMembers.removedAt),
      ),
    )
    .where(
      and(
        eq(slackUsers.workspaceId, workspaceId),
        eq(slackUsers.slackUserId, slackUserId),
        eq(slackUserTeams.teamId, teamId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function tombstoneSlackSourceDeletes(
  db: Db,
  input: { workspaceId: string; channel: string; ts: string },
): Promise<void> {
  const rows = await db
    .selectDistinct({ teamId: rawEvents.teamId })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.source, 'slack'),
        sql`${rawEvents.sourceMetadata} ->> 'slack_workspace_id' = ${input.workspaceId}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_channel_id' = ${input.channel}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_message_ts' = ${input.ts}`,
        sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
      ),
    );

  for (const row of rows) {
    await tombstoneSlackSourceDelete(db, { ...input, teamId: row.teamId });
  }
}

async function tombstoneSlackSourceDelete(
  db: Db,
  input: { teamId: string; workspaceId: string; channel: string; ts: string },
): Promise<void> {
  const patch = JSON.stringify({
    deleted: true,
    delete_reason: 'slack_deleted_at_source',
    deleted_at: new Date().toISOString(),
  });
  await db
    .update(rawEvents)
    .set({
      sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
    })
    .where(
      and(
        eq(rawEvents.teamId, input.teamId),
        eq(rawEvents.source, 'slack'),
        sql`${rawEvents.sourceMetadata} ->> 'slack_workspace_id' = ${input.workspaceId}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_channel_id' = ${input.channel}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_message_ts' = ${input.ts}`,
        sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
      ),
    );
}

async function tombstoneSupersededSlackRevisions(
  db: DbOrTx,
  input: {
    teamId: string;
    workspaceId: string;
    channelId: string;
    messageTs: string;
    supersededByEventId: string;
  },
): Promise<void> {
  const patch = JSON.stringify({
    deleted: true,
    delete_reason: 'slack_superseded_by_edit',
    deleted_at: new Date().toISOString(),
    superseded_by_event_id: input.supersededByEventId,
  });
  await db
    .update(rawEvents)
    .set({
      sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
    })
    .where(
      and(
        eq(rawEvents.teamId, input.teamId),
        eq(rawEvents.source, 'slack'),
        ne(rawEvents.id, input.supersededByEventId),
        sql`${rawEvents.sourceMetadata} ->> 'slack_workspace_id' = ${input.workspaceId}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_channel_id' = ${input.channelId}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_message_ts' = ${input.messageTs}`,
        sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
      ),
    );
}

async function lockSlackMessageRevisions(
  db: DbOrTx,
  input: { teamId: string; workspaceId: string; channelId: string; messageTs: string },
): Promise<void> {
  await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, input.teamId),
        eq(rawEvents.source, 'slack'),
        sql`${rawEvents.sourceMetadata} ->> 'slack_workspace_id' = ${input.workspaceId}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_channel_id' = ${input.channelId}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_message_ts' = ${input.messageTs}`,
      ),
    )
    .for('update');
}

async function findLatestSlackRevision(
  db: DbOrTx,
  input: { teamId: string; workspaceId: string; channelId: string; messageTs: string },
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, input.teamId),
        eq(rawEvents.source, 'slack'),
        sql`${rawEvents.sourceMetadata} ->> 'slack_workspace_id' = ${input.workspaceId}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_channel_id' = ${input.channelId}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_message_ts' = ${input.messageTs}`,
        sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
      ),
    )
    .orderBy(desc(rawEvents.occurredAt))
    .limit(1);
  return rows[0] ?? null;
}

async function findRootSlackEventId(
  db: Db,
  teamId: string,
  workspaceId: string,
  channelId: string,
  messageTs: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, teamId),
        eq(rawEvents.source, 'slack'),
        sql`${rawEvents.sourceMetadata} ->> 'slack_workspace_id' = ${workspaceId}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_channel_id' = ${channelId}`,
        sql`${rawEvents.sourceMetadata} ->> 'slack_message_ts' = ${messageTs}`,
      ),
    )
    .orderBy(asc(rawEvents.occurredAt), asc(rawEvents.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

function slackTsToDate(ts: string): Date {
  const n = Number.parseFloat(ts);
  return Number.isFinite(n) ? new Date(n * 1000) : new Date();
}

function conversationType(info: SlackConversation | null): string {
  if (info?.is_im) return 'im';
  if (info?.is_mpim) return 'mpim';
  if (info?.is_group) return 'private_channel';
  return 'public_channel';
}

async function claimSlackAsk(key: string, ttlSec = 600): Promise<boolean> {
  try {
    const conn = getRedisConnection();
    const reply = await conn.set(`slack:ask:seen:${key}`, '1', 'EX', ttlSec, 'NX');
    return reply === 'OK';
  } catch {
    return true;
  }
}
