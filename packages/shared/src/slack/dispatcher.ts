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
} from '@timeline/db';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';

import { askAgent } from '../agent/ask.js';
import {
  classifyConversationalAttachment,
  CONVERSATIONAL_ATTACHMENT_LIMITS,
  extensionOf,
} from '../conversational/attachments.js';
import { encryptJson, decryptJson, type EncryptedSecret } from '../crypto/secrets.js';
import { buildDocumentObjectKey } from '../documents/object-key.js';
import { childLogger } from '../logger.js';
import { getRedisConnection } from '../queue/connection.js';

import { SlackApi, type SlackConversation, type SlackOAuthAccessResponse } from './api.js';
import {
  slackEnvelopeSchema,
  type SlackAppMentionEvent,
  type SlackFile,
  type SlackMessageEvent,
} from './types.js';

const log = childLogger('slack');

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

export interface SlackIngestDeps {
  db: Db;
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
    log.error({ err }, 'slack dispatch failed');
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

export async function handleSlackSlashCommand(
  deps: { db: Db },
  input: SlackSlashCommandInput,
): Promise<void> {
  if (input.command !== '/ask') return;
  const workspace = await findWorkspaceBySlackTeamId(deps.db, input.team_id);
  if (!workspace) return;
  const api = new SlackApi(decryptWorkspaceToken(workspace).accessToken);
  const linked = await findActiveSlackLink(deps.db, workspace.id, input.user_id);
  if (!linked) {
    await api.postMessage({
      channel: input.channel_id,
      response_url: input.response_url,
      text: 'Link your Slack identity to Timeline before using /ask.',
    });
    return;
  }
  const question = input.text.trim();
  if (!question) {
    await api.postMessage({
      channel: input.channel_id,
      response_url: input.response_url,
      text: 'Usage: /ask what changed with Acme this week?',
    });
    return;
  }
  const claim = await claimSlackAsk(
    input.trigger_id ?? `${input.team_id}:${input.channel_id}:${input.user_id}:${question}`,
  );
  if (!claim) return;
  const result = await askAgent({
    db: deps.db,
    teamId: linked.teamId,
    userId: linked.userId,
    userName: linked.displayName ?? 'a teammate',
    question,
  });
  await api.postMessage({
    channel: input.channel_id,
    response_url: input.response_url,
    text: result.ok ? result.answer : 'Timeline could not answer that right now.',
  });
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
  await input.db.insert(slackConversationBindings).values({
    workspaceId: install.id,
    teamId: input.teamId,
    slackConversationId: input.conversationId,
    conversationType: conversationType(info),
    title: info?.name ?? input.conversationId,
    boundByUserId: input.userId,
    visibilityDefault: 'team',
    enabled: true,
    metadata: { is_member: info?.is_member ?? null },
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
  const linked = event.user ? await findActiveSlackLink(deps.db, workspace.id, event.user) : null;
  if (!linked) {
    await api.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts ?? event.ts,
      text: 'Link your Slack identity to Timeline before asking in Slack.',
    });
    return;
  }
  const claimed = await claimSlackAsk(slackEventId);
  if (!claimed) return;
  const question = (event.text ?? '').replace(/<@[^>]+>/g, '').trim();
  const result = await askAgent({
    db: deps.db,
    teamId: linked.teamId,
    userId: linked.userId,
    userName: linked.displayName ?? 'a teammate',
    question,
  });
  await api.postMessage({
    channel: event.channel,
    thread_ts: event.thread_ts ?? event.ts,
    text: result.ok ? result.answer : 'Timeline could not answer that right now.',
  });
}

async function handleMessageEvent(
  deps: SlackIngestDeps,
  api: SlackApi,
  workspace: SlackWorkspaceRecord,
  slackEventId: string,
  event: SlackMessageEvent,
): Promise<void> {
  if (event.bot_id || event.user === workspace.botUserId) return;
  if (event.subtype === 'message_deleted') {
    await tombstoneSlackSourceDelete(deps.db, {
      workspaceId: workspace.id,
      channel: event.channel,
      ts: event.deleted_ts ?? event.previous_message?.ts ?? event.ts,
    });
    return;
  }
  if (event.subtype && event.subtype !== 'message_changed') return;

  const message = event.subtype === 'message_changed' ? event.message : event;
  if (message?.bot_id) return;
  const senderId = message?.user ?? event.user;
  if (!senderId || senderId === workspace.botUserId) return;
  const isEdit = event.subtype === 'message_changed';
  const text = message?.text ?? event.text ?? '';
  const ts = isEdit ? (message?.ts ?? event.previous_message?.ts) : (message?.ts ?? event.ts);
  if (!ts) return;
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
    slack_event_ts: event.event_ts ?? ts,
    slack_thread_ts: threadTs ?? null,
    slack_sender_id: senderId,
    slack_sender_name: senderDisplayName,
    slack_sender_timeline_user_id: route.linkedUserId,
    source_owner_user_id: route.sourceOwnerUserId,
    source_unverified: route.linkedUserId ? false : true,
    attachments: files.map(fileSummary),
  };
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
    occurredAt: slackTsToDate(event.event_ts ?? ts),
    visibility: route.visibility,
    metadata,
    isEdit,
    workspaceId: workspace.id,
    channelId: event.channel,
    messageTs: ts,
  });
  if (inserted) {
    if (text.trim()) await enqueueTextPipelines(deps, inserted);
    await processSlackAttachments(deps, api, {
      teamId: inserted.teamId,
      parentRawEventId: inserted.id,
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

async function insertSlackEvent(
  db: Db,
  input: {
    teamId: string;
    authorUserId: string | null;
    text: string | null;
    occurredAt: Date;
    visibility: 'team' | 'private' | 'specific_users';
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
  if (!input.isEdit) return insert(db);
  return db.transaction(async (tx) => {
    await lockSlackMessageRevisions(tx, input);
    const row = await insert(tx);
    const latest = await findLatestSlackRevision(tx, input);
    if (latest) {
      await tombstoneSupersededSlackRevisions(tx, { ...input, supersededByEventId: latest.id });
    }
    return row && latest?.id === row.id ? row : null;
  });
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
} | null> {
  const linked = await findActiveSlackLink(db, workspaceId, slackUserId);
  if (channelType === 'im') {
    if (!linked) return null;
    return {
      teamId: linked.teamId,
      sourceOwnerUserId: linked.userId,
      linkedUserId: linked.userId,
      visibility: 'team',
      isDm: true,
      conversationType: 'im',
      conversationTitle: null,
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
  const linkedForTeam = linked?.teamId === binding.teamId ? linked.userId : null;
  return {
    teamId: binding.teamId,
    sourceOwnerUserId: binding.boundByUserId,
    linkedUserId: linkedForTeam,
    visibility: binding.visibilityDefault,
    isDm: false,
    conversationType: binding.conversationType,
    conversationTitle: binding.title,
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
      bytes = await api.downloadFile(file);
    } catch (err) {
      log.error({ err, fileId: file.id }, 'slack attachment download failed');
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
          sourceMetadata: {
            slack_attachment_kind: 'audio',
            slack_file_id: file.id,
            slack_file_name: filename,
            slack_parent_raw_event_id: input.parentRawEventId,
            slack_workspace_id: input.workspace.id,
            slack_channel_id: input.channelId,
            slack_message_ts: input.messageTs,
            source_owner_user_id: input.sourceOwnerUserId,
          },
        })
        .returning({ id: rawEvents.id, teamId: rawEvents.teamId });
      const row = rows[0];
      if (row)
        await deps.audio.enqueueTranscribe({
          rawEventId: row.id,
          teamId: row.teamId,
          audioKey: key,
        });
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
  await deps.db.transaction(async (tx) => {
    const docRows = await tx
      .insert(documents)
      .values({
        teamId: input.teamId,
        name: input.filename,
        ownerUserId: input.parentAuthorUserId,
        visibility: input.visibility,
        metadata: {
          source: 'slack',
          slack_file_id: input.file.id,
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
    const eventRows = await tx
      .insert(rawEvents)
      .values({
        teamId: input.teamId,
        authorUserId: input.parentAuthorUserId,
        source: 'document',
        contentText: `Uploaded ${input.filename}`,
        visibility: input.visibility,
        sourceMetadata: {
          action: 'upload',
          document_id: doc.id,
          document_version: 1,
          source: 'slack',
          slack_file_id: input.file.id,
          parent_raw_event_id: input.parentRawEventId,
        },
      })
      .returning({ id: rawEvents.id });
    const event = eventRows[0];
    if (!event) throw new Error('slack_document_event_insert_failed');
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
        sourceEventId: event.id,
        processingStatus: 'pending',
      })
      .returning({ id: documentVersions.id, objectKey: documentVersions.objectKey });
    const version = versionRows[0];
    if (!version) throw new Error('slack_document_version_insert_failed');
    await tx
      .update(documents)
      .set({ currentVersionId: version.id })
      .where(eq(documents.id, doc.id));
    await documentDeps.upload({ key, body: input.bytes, contentType: input.contentType });
    await documentDeps.enqueueExtract({ documentVersionId: version.id, teamId: input.teamId });
  });
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
  let profile;
  try {
    profile = await api.usersInfo(slackUserId);
  } catch {
    profile = null;
  }
  const name = profile?.profile?.display_name ?? profile?.name ?? null;
  const realName = profile?.profile?.real_name ?? profile?.real_name ?? null;
  const rows = await db
    .insert(slackUsers)
    .values({
      workspaceId,
      slackUserId,
      name,
      realName,
      email: profile?.profile?.email ?? null,
      avatarUrl: profile?.profile?.image_72 ?? null,
      metadata: profile ?? {},
    })
    .onConflictDoUpdate({
      target: [slackUsers.workspaceId, slackUsers.slackUserId],
      set: {
        name,
        realName,
        email: profile?.profile?.email ?? null,
        avatarUrl: profile?.profile?.image_72 ?? null,
        metadata: profile ?? {},
        updatedAt: new Date(),
      },
    })
    .returning({ name: slackUsers.name, realName: slackUsers.realName });
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

async function tombstoneSlackSourceDelete(
  db: Db,
  input: { workspaceId: string; channel: string; ts: string },
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
