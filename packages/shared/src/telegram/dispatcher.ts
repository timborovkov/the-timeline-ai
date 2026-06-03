import {
  documentVersions,
  documents,
  type Db,
  rawEvents,
  teamMembers,
  teams,
  teamVisibilityDefaults,
  telegramChatBindings,
  telegramLinkTokens,
  telegramUsers,
  telegramUserTeams,
} from '@timeline/db';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';

import { askAgent } from '#src/agent/ask.js';
import {
  classifyConversationalAttachment,
  CONVERSATIONAL_ATTACHMENT_LIMITS,
  extensionOf,
} from '#src/conversational/attachments.js';
import { buildDocumentObjectKey } from '#src/documents/object-key.js';
import { childLogger } from '#src/logger.js';
import { getRedisConnection } from '#src/queue/connection.js';
import { checkRateLimit, rateLimitKey, RATE_LIMITS } from '#src/rate-limit/index.js';
import { type TelegramApi } from '#src/telegram/api.js';
import {
  tgUpdateSchema,
  type TgAudioPayload,
  type TgDocumentPayload,
  type TgMessage,
  type TgPhotoSize,
  type TgUpdate,
  type TgUser,
} from '#src/telegram/types.js';

const log = childLogger('telegram');

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

function formatTeamLabel(team: { teamId: string; teamName: string }): string {
  return `${team.teamName} (${team.teamId})`;
}

/**
 * Audio ingest is dependency-injected so the dispatcher stays testable
 * (no S3 or queue connection required for text-only tests). When `audio`
 * is undefined, voice/audio messages are silently dropped with a log line —
 * matching the Phase 2 behavior for unsupported media types.
 */
export interface AudioIngestDeps {
  /** Upload bytes to object storage; returns nothing. */
  upload(input: { key: string; body: Buffer; contentType: string }): Promise<void>;
  /** Enqueue a transcribe job for the freshly-inserted raw event. */
  enqueueTranscribe(input: { rawEventId: string; teamId: string; audioKey: string }): Promise<void>;
  /** Object key prefix builder. Implementation owns the bucket layout. */
  buildAudioKey(input: {
    teamId: string;
    chatId: number;
    messageId: number;
    fileId: string;
    extension: string;
  }): string;
}

/**
 * Extract enqueue is injected so the dispatcher can hand off to the
 * extraction worker without depending on BullMQ directly. Optional: when
 * undefined, text events still land but no facts are produced (timeline
 * shows the raw text only). The web action mirrors this shape.
 */
export interface ExtractEnqueueDeps {
  enqueueExtract(input: { rawEventId: string; teamId: string }): Promise<void>;
}

/**
 * Embed enqueue is injected for the same reason as ExtractEnqueueDeps.
 * Optional: when undefined, text events still land and extraction still
 * runs (extract itself enqueues per-fact embeds); only the event-body embed
 * that covers zero-fact events is skipped. The web action mirrors this shape.
 */
export interface EmbedEnqueueDeps {
  enqueueEmbed(input: { rawEventId: string; teamId: string }): Promise<void>;
}

export interface SuggestionEnqueueDeps {
  enqueueSuggestion(input: { rawEventId: string; teamId: string }): Promise<void>;
}

export interface DocumentAttachmentDeps {
  upload(input: { key: string; body: Buffer; contentType: string }): Promise<void>;
  enqueueExtract(input: { documentVersionId: string; teamId: string }): Promise<void>;
}

interface DispatcherDeps {
  db: Db;
  tg: TelegramApi;
  audio?: AudioIngestDeps;
  documents?: DocumentAttachmentDeps;
  extract?: ExtractEnqueueDeps;
  embed?: EmbedEnqueueDeps;
  suggestions?: SuggestionEnqueueDeps;
}

interface DmContext extends DispatcherDeps {
  message: TgMessage;
  updateId: number;
  tgUser: TgUser;
  tgUserRow: { id: string; userId: string | null };
  activeTeamId: string | null;
}

interface GroupContext extends DispatcherDeps {
  message: TgMessage;
  updateId: number;
  tgUser: TgUser | null;
  tgUserRow: { id: string; userId: string | null } | null;
  binding: { teamId: string; boundByUserId: string | null } | null;
}

/**
 * Entry point: dispatch a single Telegram update. Never throws — errors are
 * logged and swallowed so Telegram does not retry the webhook indefinitely.
 */
export async function handleUpdate(
  deps: DispatcherDeps,
  rawUpdate: unknown,
): Promise<{ ok: boolean }> {
  const parsed = tgUpdateSchema.safeParse(rawUpdate);
  if (!parsed.success) return { ok: false };
  const update: TgUpdate = parsed.data;

  try {
    if (update.message) {
      await routeMessage(deps, update.update_id, update.message, false);
    } else if (update.edited_message) {
      await routeMessage(deps, update.update_id, update.edited_message, true);
    }
    // callback_query: not used yet (Phase 2 has no inline keyboards
    // beyond optional /team — kept simple by replying with text).
  } catch (err) {
    log.error({ err }, 'dispatch failed');
    return { ok: false };
  }
  return { ok: true };
}

async function routeMessage(
  deps: DispatcherDeps,
  updateId: number,
  message: TgMessage,
  isEdit: boolean,
): Promise<void> {
  const chat = message.chat;
  if (chat.type === 'private') {
    if (!message.from) return; // anonymous DM is impossible, but typecheck
    const tgUserRow = await upsertTelegramUser(deps.db, message.from);
    const activeTeamId = await getActiveTeamId(deps.db, tgUserRow.id);
    await handleDm(
      {
        ...deps,
        updateId,
        message,
        tgUser: message.from,
        tgUserRow,
        activeTeamId,
      },
      isEdit,
    );
    return;
  }

  if (chat.type === 'group' || chat.type === 'supergroup') {
    const tgUserRow = message.from ? await upsertTelegramUser(deps.db, message.from) : null;
    const binding = await getChatBinding(deps.db, chat.id, chat.title ?? null);
    await handleGroup(
      {
        ...deps,
        updateId,
        message,
        tgUser: message.from ?? null,
        tgUserRow,
        binding,
      },
      isEdit,
    );
    return;
  }
  // channels not supported in Phase 2
}

// ---------- DM ----------

async function handleDm(ctx: DmContext, isEdit: boolean): Promise<void> {
  const text = ctx.message.text ?? ctx.message.caption ?? '';
  const command = parseCommand(text);
  if (command && !isEdit) {
    await dispatchCommand(ctx, command);
    return;
  }
  // Edits of commands are ignored — Telegram lets users edit /commands but
  // re-running them on edit would be confusing.
  if (isEdit && command) return;

  // Audio takes precedence over text/caption: a voice memo with a caption
  // is primarily an audio capture, and dropping the bytes to record only
  // the caption silently loses the actual content. The caption is kept
  // in source_metadata.tg_caption so it isn't lost either. Audio edits
  // are skipped — Telegram lets users edit captions on media but the
  // media bytes themselves are immutable, and the original row is already
  // on the timeline.
  const audio = ctx.message.voice ?? ctx.message.audio;
  if (audio && !isEdit) {
    if (!ctx.activeTeamId) {
      await ctx.tg.sendMessage({
        chat_id: ctx.message.chat.id,
        text: 'No active team. Run /link <token> first. Your voice memo was not recorded.',
      });
      return;
    }
    const insertedAudio = await ingestAudio(
      {
        db: ctx.db,
        tg: ctx.tg,
        audio: ctx.audio,
        message: ctx.message,
        updateId: ctx.updateId,
        authorUserId: ctx.tgUserRow.userId,
        visibilityOwnerUserId: ctx.tgUserRow.userId,
        sourceUnverified: ctx.tgUserRow.userId === null,
      },
      audio,
      ctx.message.voice ? 'voice' : 'audio',
      ctx.activeTeamId,
    );
    if (insertedAudio) await ackReaction(ctx.tg, ctx.message.chat.id, ctx.message.message_id);
    return;
  }

  const fileAttachment = pickTelegramDocumentAttachment(ctx.message);
  if (fileAttachment && !isEdit) {
    if (!ctx.activeTeamId) {
      await ctx.tg.sendMessage({
        chat_id: ctx.message.chat.id,
        text: 'No active team. Run /link <token> first. Your file was not recorded.',
      });
      return;
    }
    const inserted = await insertEvent(ctx.db, {
      fallbackTeamId: ctx.activeTeamId,
      authorUserId: ctx.tgUserRow.userId,
      text: text || null,
      message: ctx.message,
      updateId: ctx.updateId,
      sourceUnverified: ctx.tgUserRow.userId === null,
      isEdit: false,
    });
    if (text.trim()) {
      await maybeEnqueueExtract(ctx, inserted);
      await maybeEnqueueEmbed(ctx, inserted);
      await maybeEnqueueSuggestion(ctx, inserted);
    }
    await ingestTelegramDocumentAttachment(
      ctx,
      fileAttachment,
      inserted ? { ...inserted, authorUserId: ctx.tgUserRow.userId } : null,
    );
    if (inserted) await ackReaction(ctx.tg, ctx.message.chat.id, ctx.message.message_id);
    return;
  }

  if (text) {
    await ingestDmText(ctx, text, isEdit);
  }
}

async function dispatchCommand(
  ctx: DmContext,
  command: { name: string; arg: string },
): Promise<void> {
  switch (command.name) {
    case '/start':
      await cmdStartDm(ctx, command.arg);
      return;
    case '/link':
      await cmdLinkDm(ctx, command.arg);
      return;
    case '/team':
      await cmdTeamDm(ctx, command.arg);
      return;
    case '/whereami':
      await cmdWhereamiDm(ctx);
      return;
    case '/unlink':
      await cmdUnlinkDm(ctx, command.arg);
      return;
    case '/help':
      await cmdHelpDm(ctx);
      return;
    case '/ask':
      await cmdAskDm(ctx, command.arg);
      return;
    default:
      await ctx.tg.sendMessage({
        chat_id: ctx.message.chat.id,
        text: `Unknown command. Try /help.`,
      });
  }
}

async function cmdStartDm(ctx: DmContext, arg: string): Promise<void> {
  if (arg) {
    // Deep-link: t.me/<bot>?start=<token>
    await cmdLinkDm(ctx, arg);
    return;
  }
  await ctx.tg.sendMessage({
    chat_id: ctx.message.chat.id,
    text:
      `Welcome to The Timeline.\n\n` +
      `To connect this chat to a team, generate a link token in the web app ` +
      `(Team → Telegram) and reply with /link <token>.\n\n` +
      `Already linked? Run /whereami to see the active team, /team to switch, or /help.`,
  });
}

async function cmdLinkDm(ctx: DmContext, arg: string): Promise<void> {
  const token = arg.trim();
  if (!token) {
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: 'Usage: /link <token>. Generate one in the team settings page.',
    });
    return;
  }
  try {
    const team = await ctx.db.transaction(async (tx) => {
      const tokens = await tx
        .select()
        .from(telegramLinkTokens)
        .where(eq(telegramLinkTokens.token, token))
        .limit(1)
        .for('update');
      const row = tokens[0];
      if (!row) throw new Error('not_found');
      if (row.consumedAt) throw new Error('consumed');
      if (row.expiresAt < new Date()) throw new Error('expired');
      if (row.scope !== 'personal') throw new Error('wrong_scope_personal');
      // Identity gate: token is bound to the issuer's TG @username at
      // generation time and is only consumable from that exact account.
      // Once matched, the consumer IS the issuer — safe to bind user_id.
      if (!row.targetTgUsername) throw new Error('legacy_no_username');
      const consumerUsername = ctx.tgUser.username?.toLowerCase() ?? '';
      if (consumerUsername !== row.targetTgUsername) throw new Error('wrong_user');
      // Re-verify the issuer's team membership at consumption time so a
      // teammate who was removed inside the 15-min TTL window cannot still
      // bind Telegram capture to a team they no longer belong to.
      const issuerStillMember = await tx
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, row.teamId),
            eq(teamMembers.userId, row.issuedByUserId),
            isNull(teamMembers.removedAt),
          ),
        )
        .limit(1);
      if (!issuerStillMember[0]) throw new Error('issuer_revoked');

      // Upsert membership row, then flip active.
      const existing = await tx
        .select()
        .from(telegramUserTeams)
        .where(
          and(
            eq(telegramUserTeams.telegramUserId, ctx.tgUserRow.id),
            eq(telegramUserTeams.teamId, row.teamId),
          ),
        )
        .limit(1);

      // Deactivate any currently-active row first to satisfy the partial
      // unique index.
      await tx
        .update(telegramUserTeams)
        .set({ isActive: false })
        .where(
          and(
            eq(telegramUserTeams.telegramUserId, ctx.tgUserRow.id),
            eq(telegramUserTeams.isActive, true),
          ),
        );

      if (existing[0]) {
        // Refresh linkedByUserId on relink so the most recent issuer is the
        // one whose team-membership controls this row's continued validity.
        await tx
          .update(telegramUserTeams)
          .set({ isActive: true, linkedByUserId: row.issuedByUserId })
          .where(eq(telegramUserTeams.id, existing[0].id));
      } else {
        await tx.insert(telegramUserTeams).values({
          telegramUserId: ctx.tgUserRow.id,
          teamId: row.teamId,
          linkedByUserId: row.issuedByUserId,
          isActive: true,
        });
      }

      // Now that the @username match has proven consumer == issuer, bind
      // the Telegram account to the app user. This is what makes DM ingest
      // attribute messages to the right author_user_id (instead of going
      // in as source_unverified) AND what gives removeMemberAction a
      // consumer-side anchor for revoking routing on member removal.
      await tx
        .update(telegramUsers)
        .set({ userId: row.issuedByUserId, updatedAt: new Date() })
        .where(eq(telegramUsers.id, ctx.tgUserRow.id));

      await tx
        .update(telegramLinkTokens)
        .set({
          consumedAt: new Date(),
          consumedByTgUserId: ctx.tgUser.id,
        })
        .where(eq(telegramLinkTokens.id, row.id));

      const teamRows = await tx
        .select({ teamId: teams.id, teamName: teams.name })
        .from(teams)
        .where(eq(teams.id, row.teamId))
        .limit(1);
      const team = teamRows[0];
      if (!team) throw new Error('team_not_found');
      return team;
    });
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: `Linked. This chat is now attributed to team ${formatTeamLabel(team)}. Run /team to switch active team later.`,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'failed';
    const text =
      reason === 'not_found'
        ? 'Invalid link token.'
        : reason === 'consumed'
          ? 'That link token has already been used. Generate a new one.'
          : reason === 'expired'
            ? 'That link token has expired (15-minute TTL). Generate a new one.'
            : reason === 'wrong_scope_personal'
              ? 'That token is for a group binding, not a DM link.'
              : reason === 'issuer_revoked'
                ? 'The teammate who issued this token is no longer in that team. Ask a current member for a new one.'
                : reason === 'wrong_user'
                  ? 'This token was issued for a different Telegram @username. Generate one in the web app for your own account.'
                  : reason === 'legacy_no_username'
                    ? 'This token predates the identity check. Generate a new one in the web app.'
                    : 'Could not link. Try again.';
    await ctx.tg.sendMessage({ chat_id: ctx.message.chat.id, text });
  }
}

async function cmdTeamDm(ctx: DmContext, arg: string): Promise<void> {
  // Order by createdAt so the numbered list is stable across messages —
  // otherwise "/team 2" could switch to a different team than the one the
  // user just saw at position 2.
  const memberships = await ctx.db
    .select({
      id: telegramUserTeams.id,
      teamId: telegramUserTeams.teamId,
      teamName: teams.name,
      isActive: telegramUserTeams.isActive,
    })
    .from(telegramUserTeams)
    .innerJoin(teams, eq(teams.id, telegramUserTeams.teamId))
    .where(eq(telegramUserTeams.telegramUserId, ctx.tgUserRow.id))
    .orderBy(asc(telegramUserTeams.createdAt), asc(telegramUserTeams.id));

  if (memberships.length === 0) {
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: 'No linked teams yet. Generate a personal link token in the web app and run /link <token>.',
    });
    return;
  }
  const first = memberships[0];
  if (memberships.length === 1 && first) {
    // If the sole row is inactive (rare desync — e.g. a prior /link to a
    // different team that was later /unlinked), self-heal by activating it
    // so /whereami and DM ingest start working again.
    if (!first.isActive) {
      await ctx.db
        .update(telegramUserTeams)
        .set({ isActive: true })
        .where(eq(telegramUserTeams.id, first.id));
    }
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: `Only one linked team: ${formatTeamLabel(first)}. It's now active.`,
    });
    return;
  }

  if (arg) {
    const n = Number.parseInt(arg, 10);
    const target = Number.isInteger(n) ? memberships[n - 1] : undefined;
    if (target) {
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(telegramUserTeams)
          .set({ isActive: false })
          .where(
            and(
              eq(telegramUserTeams.telegramUserId, ctx.tgUserRow.id),
              eq(telegramUserTeams.isActive, true),
            ),
          );
        await tx
          .update(telegramUserTeams)
          .set({ isActive: true })
          .where(eq(telegramUserTeams.id, target.id));
      });
      await ctx.tg.sendMessage({
        chat_id: ctx.message.chat.id,
        text: `Active team is now ${formatTeamLabel(target)}.`,
      });
      return;
    }
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: `Invalid team number. Pick one of 1..${memberships.length}.`,
    });
    return;
  }

  const lines = memberships.map(
    (m, i) => `${i + 1}. ${formatTeamLabel(m)}${m.isActive ? '  ← active' : ''}`,
  );
  await ctx.tg.sendMessage({
    chat_id: ctx.message.chat.id,
    text:
      `Your linked teams:\n${lines.join('\n')}\n\n` +
      `To switch, reply with /team <number> (e.g. /team 2).`,
  });
}

async function cmdWhereamiDm(ctx: DmContext): Promise<void> {
  if (!ctx.activeTeamId) {
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: 'No active team. Run /link <token> to connect.',
    });
    return;
  }
  const rows = await ctx.db
    .select({ teamId: teams.id, teamName: teams.name })
    .from(teams)
    .where(eq(teams.id, ctx.activeTeamId))
    .limit(1);
  const label = rows[0] ? formatTeamLabel(rows[0]) : ctx.activeTeamId;
  await ctx.tg.sendMessage({
    chat_id: ctx.message.chat.id,
    text: `Active team: ${label}. Messages you send here land in that team's timeline.`,
  });
}

async function cmdUnlinkDm(ctx: DmContext, _arg: string): Promise<void> {
  // Phase 2: simple unlink-all-from-this-TG-user with single confirmation step.
  // No "are you sure" round trip; product-brief doesn't require it for DMs.
  const deleted = await ctx.db
    .delete(telegramUserTeams)
    .where(eq(telegramUserTeams.telegramUserId, ctx.tgUserRow.id))
    .returning({ id: telegramUserTeams.id });
  await ctx.tg.sendMessage({
    chat_id: ctx.message.chat.id,
    text: `Unlinked ${deleted.length} team(s). New messages here will not be recorded until you /link again.`,
  });
}

async function cmdHelpDm(ctx: DmContext): Promise<void> {
  await ctx.tg.sendMessage({
    chat_id: ctx.message.chat.id,
    text:
      `Plain messages here are saved to your team's timeline (👀 = received).\n` +
      `Use /ask to query the timeline.\n\n` +
      `Commands (DM):\n` +
      `/ask <question>  ask the timeline (e.g. /ask what did we ship this week?)\n` +
      `/link <token>    connect this DM to a team\n` +
      `/team            list linked teams; /team N switches\n` +
      `/whereami        show current active team\n` +
      `/unlink          disconnect all teams\n` +
      `/help            this message`,
  });
}

async function cmdAskDm(ctx: DmContext, arg: string): Promise<void> {
  await runAsk({
    tg: ctx.tg,
    db: ctx.db,
    chatId: ctx.message.chat.id,
    tgUserId: ctx.tgUser.id,
    updateId: ctx.updateId,
    teamId: ctx.activeTeamId,
    userId: ctx.tgUserRow.userId,
    userName: tgDisplayName(ctx.tgUser),
    question: arg,
  });
}

function tgDisplayName(u: TgUser): string {
  return telegramSenderName(u) ?? 'a teammate';
}

function telegramSenderName(u: TgUser): string | null {
  const parts = [u.first_name, u.last_name].filter((p): p is string => !!p && p.length > 0);
  if (parts.length > 0) return parts.join(' ');
  if (u.username) return `@${u.username}`;
  return null;
}

/**
 * Shared `/ask` runner used by both DM and group dispatchers. Validates that
 * the chat has a team to answer against and that the sender is a known user
 * (TeamScope requires a real userId — unverified senders can't pose as a
 * teammate). Per-user rate-limited tighter than ingest because each call hits
 * OpenRouter.
 */
interface RunAskInput {
  tg: TelegramApi;
  db: Db;
  chatId: number;
  tgUserId: number;
  /** Telegram update_id — used to dedupe webhook retries so a slow agent
   *  call doesn't get replayed (and re-billed) when Telegram retries. */
  updateId: number;
  teamId: string | null;
  userId: string | null;
  userName: string;
  question: string;
}

async function runAsk(input: RunAskInput): Promise<void> {
  // Three-phase idempotency. Telegram redelivers the webhook on timeout, not
  // on HTTP 200, so:
  //
  //   1. Claim with a short TTL at entry — a concurrent retry that arrives
  //      while the first attempt is still running sees the key and drops.
  //   2. While the runner is in-flight, a heartbeat refreshes the TTL every
  //      ASK_HEARTBEAT_INTERVAL_MS so a long multi-step agent run cannot
  //      outlast the claim. On process death the heartbeat stops and the key
  //      expires on its own within ASK_INFLIGHT_TTL_SEC.
  //   3. Once the runner completes (success or handled error), extend to the
  //      long completed-TTL. OpenRouter has been billed, so a duplicate
  //      response is worse than a missed one — never re-run the agent for
  //      the same update_id.
  //
  // We do NOT release the key on a caught exception: the webhook still
  // returns 200, so Telegram won't auto-retry and a duplicate response to a
  // manually-replayed update would be worse than the missed reply we've
  // already logged. If a final send failed, runAskInner caches the answer
  // text so a future delivery (or a dedup-hit on retry) can still deliver
  // without re-billing.
  const claimed = await claimAskUpdate(input.updateId, ASK_INFLIGHT_TTL_SEC);
  if (!claimed) {
    log.info({ updateId: input.updateId, tgUserId: input.tgUserId }, 'ask_update_dedup');
    // First attempt may have paid for an answer but failed to deliver it.
    // Best-effort redelivery from the answer cache.
    await deliverPendingAnswer(input.tg, input.chatId, input.updateId);
    return;
  }
  const stopHeartbeat = startAskHeartbeat(input.updateId);
  try {
    await runAskInner(input);
  } catch (err) {
    log.error(
      { err, updateId: input.updateId, tgUserId: input.tgUserId, chatId: input.chatId },
      'ask_failed',
    );
  } finally {
    stopHeartbeat();
    await extendAskClaim(input.updateId, ASK_COMPLETED_TTL_SEC).catch(() => undefined);
  }
}

/**
 * Send a Telegram message with bounded retries. Used by `/ask` so a transient
 * Bot-API hiccup doesn't lose an answer we already paid OpenRouter to produce
 * — the webhook returns 200 either way and Telegram never automatically
 * resends, so we have to be the one that retries.
 */
async function sendWithRetry(
  tg: TelegramApi,
  payload: { chat_id: number; text: string },
): Promise<boolean> {
  const delaysMs = [0, 250, 1000];
  let lastErr: unknown;
  for (const delayMs of delaysMs) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      await tg.sendMessage(payload);
      return true;
    } catch (err) {
      lastErr = err;
      log.warn({ err, chatId: payload.chat_id }, 'tg_send_retry');
    }
  }
  log.error({ err: lastErr, chatId: payload.chat_id }, 'tg_send_failed');
  return false;
}

async function runAskInner(input: RunAskInput): Promise<void> {
  const question = input.question.trim();
  if (!question) {
    await sendWithRetry(input.tg, {
      chat_id: input.chatId,
      text: 'Usage: /ask <question>. Example: /ask what did we ship this week?',
    });
    return;
  }
  if (!input.teamId) {
    await sendWithRetry(input.tg, {
      chat_id: input.chatId,
      text: 'No team to ask. Run /link <token> first.',
    });
    return;
  }
  if (!input.userId) {
    await sendWithRetry(input.tg, {
      chat_id: input.chatId,
      text:
        'Your Telegram account is not linked to a workspace user — /ask needs a verified ' +
        'identity. Re-run /link to attach this chat.',
    });
    return;
  }
  const rl = await checkRateLimit({
    key: rateLimitKey('tg', 'ask', input.tgUserId),
    ...RATE_LIMITS.telegramAsk,
  });
  if (!rl.ok) {
    await sendWithRetry(input.tg, {
      chat_id: input.chatId,
      text: `Slow down — /ask is limited to ${RATE_LIMITS.telegramAsk.capacity}/min. Try again in ${Math.ceil(
        rl.retryAfterMs / 1000,
      )}s.`,
    });
    return;
  }
  // Best-effort typing indicator while the agent runs. Don't await the
  // promise's failure path — a chat-action error must not block the answer.
  void input.tg.sendChatAction({ chat_id: input.chatId, action: 'typing' }).catch(() => {
    /* ignore */
  });
  const result = await askAgent({
    db: input.db,
    teamId: input.teamId,
    userId: input.userId,
    userName: input.userName,
    question,
  });
  if (!result.ok) {
    const text =
      result.error === 'unconfigured'
        ? 'Chat is not configured on this server (missing OPENROUTER_API_KEY or QDRANT_URL).'
        : result.error === 'not_a_member'
          ? 'Your linked workspace user is no longer a member of this team. Ask a teammate to re-invite you.'
          : result.error === 'no_team'
            ? 'Could not load that team. Try /whereami and /team to confirm the active team.'
            : "Couldn't answer that — try again.";
    await sendWithRetry(input.tg, { chat_id: input.chatId, text });
    return;
  }
  const delivered = await sendWithRetry(input.tg, {
    chat_id: input.chatId,
    text: result.answer,
  });
  if (!delivered) {
    // Stash the paid answer ONLY after every send attempt failed. Caching
    // before the send opens a race: a Telegram redelivery arriving while
    // the first attempt is still inside sendWithRetry would hit dedup,
    // read the cache, and send the same answer a second time. The crash
    // window between a successful agent run and the first sendMessage
    // attempt is much smaller than the redelivery race, and a missed
    // reply is preferable to a duplicate.
    await cachePendingAnswer(input.updateId, result.answer).catch(() => undefined);
    log.error(
      { updateId: input.updateId, chatId: input.chatId, tgUserId: input.tgUserId },
      'ask_answer_undelivered',
    );
  }
}

/**
 * Telegram redelivers a webhook when the handler exceeds the bot-API timeout
 * (~60s). `/ask` runs the agent inline and may exceed that limit on
 * multi-step runs, so we dedupe by `update_id`. See `runAsk` for the
 * three-phase claim/heartbeat/extend lifecycle.
 *
 * Without Redis everything fails-open: capture and answer keep working at the
 * cost of possible double-billing during a Redis outage.
 */
const ASK_INFLIGHT_TTL_SEC = 180;
const ASK_HEARTBEAT_INTERVAL_MS = 60_000;
const ASK_COMPLETED_TTL_SEC = 600;
/** TTL on a cached but undelivered answer. One hour is long enough for an
 *  operator to manually replay a missed update; longer just wastes Redis. */
const ASK_ANSWER_CACHE_TTL_SEC = 3600;
const askClaimKey = (updateId: number): string => `tg:ask:seen:${updateId}`;
const askAnswerKey = (updateId: number): string => `tg:ask:answer:${updateId}`;

async function claimAskUpdate(updateId: number, ttlSec: number): Promise<boolean> {
  try {
    const conn = getRedisConnection();
    const reply = await conn.set(askClaimKey(updateId), '1', 'EX', ttlSec, 'NX');
    return reply === 'OK';
  } catch (err) {
    log.warn({ err: (err as Error).message, updateId }, 'ask_dedup_unavailable');
    return true;
  }
}

async function extendAskClaim(updateId: number, ttlSec: number): Promise<void> {
  const conn = getRedisConnection();
  await conn.set(askClaimKey(updateId), '1', 'EX', ttlSec);
}

/**
 * Refresh the dedup claim's TTL on an interval while the agent runs. Returns
 * a stop fn for the caller to invoke in `finally`. On process death the
 * interval stops and the key expires within `ASK_INFLIGHT_TTL_SEC`, which
 * lets a subsequent redelivery proceed.
 */
function startAskHeartbeat(updateId: number): () => void {
  const timer = setInterval(() => {
    extendAskClaim(updateId, ASK_INFLIGHT_TTL_SEC).catch(() => undefined);
  }, ASK_HEARTBEAT_INTERVAL_MS);
  // Node's Timeout has `unref` so a stuck heartbeat doesn't keep the worker
  // process alive past shutdown.
  if (typeof timer.unref === 'function') timer.unref();
  return () => {
    clearInterval(timer);
  };
}

async function cachePendingAnswer(updateId: number, text: string): Promise<void> {
  const conn = getRedisConnection();
  await conn.set(askAnswerKey(updateId), text, 'EX', ASK_ANSWER_CACHE_TTL_SEC);
}

async function clearPendingAnswer(updateId: number): Promise<void> {
  const conn = getRedisConnection();
  await conn.del(askAnswerKey(updateId));
}

/**
 * On a dedup-hit, attempt to deliver any answer the first attempt paid for
 * but failed to send. Cached entries are removed on successful delivery so
 * the next retry doesn't re-send.
 */
async function deliverPendingAnswer(
  tg: TelegramApi,
  chatId: number,
  updateId: number,
): Promise<void> {
  let text: string | null = null;
  try {
    const conn = getRedisConnection();
    text = await conn.get(askAnswerKey(updateId));
  } catch (err) {
    log.warn({ err: (err as Error).message, updateId }, 'ask_answer_cache_unavailable');
    return;
  }
  if (!text) return;
  const delivered = await sendWithRetry(tg, { chat_id: chatId, text });
  if (delivered) {
    await clearPendingAnswer(updateId).catch(() => undefined);
  }
}

async function ingestDmText(ctx: DmContext, text: string, isEdit: boolean): Promise<void> {
  // Edits flow through insertEvent regardless of active-team state — the
  // original event's team_id is the source of truth and an /unlink between
  // send and edit must not silently lose the correction.
  if (!ctx.activeTeamId && !isEdit) {
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: 'No active team. Run /link <token> first. Your message was not recorded.',
    });
    return;
  }
  const inserted = await insertEvent(ctx.db, {
    fallbackTeamId: ctx.activeTeamId,
    authorUserId: ctx.tgUserRow.userId,
    visibilityOwnerUserId: ctx.tgUserRow.userId,
    text,
    message: ctx.message,
    updateId: ctx.updateId,
    sourceUnverified: ctx.tgUserRow.userId === null,
    isEdit,
  });
  await maybeEnqueueExtract(ctx, inserted);
  await maybeEnqueueEmbed(ctx, inserted);
  await maybeEnqueueSuggestion(ctx, inserted);
  if (inserted && !isEdit) {
    await ackReaction(ctx.tg, ctx.message.chat.id, ctx.message.message_id);
  }
}

/**
 * Best-effort ingest ack. We don't await failures because a missing reaction
 * is a UX nicety, not a correctness signal — the event itself is already
 * durable in `raw_events`.
 */
async function ackReaction(tg: TelegramApi, chatId: number, messageId: number): Promise<void> {
  try {
    await tg.setMessageReaction({ chat_id: chatId, message_id: messageId, emoji: '👀' });
  } catch (err) {
    log.warn({ err }, 'setMessageReaction failed');
  }
}

/**
 * Hand a freshly-inserted text event off to the extraction worker. No-op
 * when no row was inserted (dedup hit) or when the dispatcher was started
 * without an `extract` dep. Failures are logged but never bubble — text is
 * already durable; missing facts can be replayed via the reextract script.
 *
 * On enqueue failure we also write `extraction_failed_at` /
 * `extraction_error` onto the row's source_metadata so the timeline UI can
 * surface "extraction unavailable" — matching the web text action and the
 * transcribe-worker handoff. Without this marker, a Redis outage at
 * Telegram ingest would leave no durable signal that extraction was
 * skipped.
 */
async function maybeEnqueueExtract(
  ctx: { db: Db; extract?: ExtractEnqueueDeps },
  inserted: { id: string; teamId: string } | null,
): Promise<void> {
  if (!inserted || !ctx.extract) return;
  try {
    await ctx.extract.enqueueExtract({ rawEventId: inserted.id, teamId: inserted.teamId });
  } catch (err) {
    log.error({ err }, 'extract enqueue failed');
    const failurePatch = JSON.stringify({
      extraction_failed_at: new Date().toISOString(),
      extraction_error: `enqueue failed: ${
        err instanceof Error ? err.message.slice(0, 480) : 'unknown'
      }`,
    });
    await ctx.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
      })
      .where(eq(rawEvents.id, inserted.id))
      .catch((markErr: unknown) => {
        log.error({ err: markErr }, 'failed to mark extract failure');
      });
  }
}

/**
 * Sibling of `maybeEnqueueExtract` for embeddings. Independent enqueue:
 * a failed embed enqueue must not block extraction (and vice versa), since
 * the two workers consume independent queues and write to independent stores.
 * Same failure-marker shape as the other paths so the timeline UI can
 * distinguish "no extract" from "no embedding".
 */
async function maybeEnqueueEmbed(
  ctx: { db: Db; embed?: EmbedEnqueueDeps },
  inserted: { id: string; teamId: string } | null,
): Promise<void> {
  if (!inserted || !ctx.embed) return;
  try {
    await ctx.embed.enqueueEmbed({ rawEventId: inserted.id, teamId: inserted.teamId });
  } catch (err) {
    log.error({ err }, 'embed enqueue failed');
    const failurePatch = JSON.stringify({
      embedding_failed_at: new Date().toISOString(),
      embedding_error: `enqueue failed: ${
        err instanceof Error ? err.message.slice(0, 480) : 'unknown'
      }`,
    });
    await ctx.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
      })
      .where(eq(rawEvents.id, inserted.id))
      .catch((markErr: unknown) => {
        log.error({ err: markErr }, 'failed to mark embed failure');
      });
  }
}

async function maybeEnqueueSuggestion(
  ctx: { db: Db; suggestions?: SuggestionEnqueueDeps },
  inserted: { id: string; teamId: string } | null,
): Promise<void> {
  if (!inserted || !ctx.suggestions) return;
  try {
    await ctx.suggestions.enqueueSuggestion({ rawEventId: inserted.id, teamId: inserted.teamId });
  } catch (err) {
    log.error({ err }, 'suggestion enqueue failed');
    const failurePatch = JSON.stringify({
      suggestions_failed_at: new Date().toISOString(),
      suggestions_error: `enqueue failed: ${
        err instanceof Error ? err.message.slice(0, 480) : 'unknown'
      }`,
    });
    await ctx.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
      })
      .where(eq(rawEvents.id, inserted.id))
      .catch((markErr: unknown) => {
        log.error({ err: markErr }, 'failed to mark suggestion failure');
      });
  }
}

// ---------- Group ----------

async function handleGroup(ctx: GroupContext, isEdit: boolean): Promise<void> {
  const text = ctx.message.text ?? ctx.message.caption ?? '';
  const command = parseCommand(text);
  if (command && !isEdit) {
    await dispatchGroupCommand(ctx, command);
    return;
  }
  if (isEdit && command) return;

  // Unbound group: drop new messages silently (Phase 2 behavior). Edits
  // still flow through so an edit of a previously-recorded message can land
  // on its original team even after /unlink.
  if (!ctx.binding && !isEdit) return;

  // Audio takes precedence over text/caption — see handleDm for rationale.
  const audio = ctx.message.voice ?? ctx.message.audio;
  if (audio && !isEdit && ctx.binding) {
    await ingestAudio(
      {
        db: ctx.db,
        tg: ctx.tg,
        audio: ctx.audio,
        message: ctx.message,
        updateId: ctx.updateId,
        authorUserId: ctx.tgUserRow?.userId ?? null,
        visibilityOwnerUserId: ctx.binding.boundByUserId ?? ctx.tgUserRow?.userId ?? null,
        sourceUnverified: !ctx.tgUserRow?.userId,
      },
      audio,
      ctx.message.voice ? 'voice' : 'audio',
      ctx.binding.teamId,
    );
    return;
  }

  const fileAttachment = pickTelegramDocumentAttachment(ctx.message);
  if (fileAttachment && !isEdit && ctx.binding) {
    const inserted = await insertEvent(ctx.db, {
      fallbackTeamId: ctx.binding.teamId,
      authorUserId: ctx.tgUserRow?.userId ?? null,
      text: text || null,
      message: ctx.message,
      updateId: ctx.updateId,
      sourceUnverified: !ctx.tgUserRow?.userId,
      isEdit: false,
    });
    if (text.trim()) {
      await maybeEnqueueExtract(ctx, inserted);
      await maybeEnqueueEmbed(ctx, inserted);
      await maybeEnqueueSuggestion(ctx, inserted);
    }
    await ingestTelegramDocumentAttachment(
      ctx,
      fileAttachment,
      inserted ? { ...inserted, authorUserId: ctx.tgUserRow?.userId ?? null } : null,
    );
    return;
  }

  if (text) {
    const inserted = await insertEvent(ctx.db, {
      fallbackTeamId: ctx.binding?.teamId ?? null,
      authorUserId: ctx.tgUserRow?.userId ?? null,
      visibilityOwnerUserId: ctx.binding?.boundByUserId ?? ctx.tgUserRow?.userId ?? null,
      text,
      message: ctx.message,
      updateId: ctx.updateId,
      sourceUnverified: !ctx.tgUserRow?.userId,
      isEdit,
    });
    await maybeEnqueueExtract(ctx, inserted);
    await maybeEnqueueEmbed(ctx, inserted);
    await maybeEnqueueSuggestion(ctx, inserted);
  }
}

async function dispatchGroupCommand(
  ctx: GroupContext,
  command: { name: string; arg: string },
): Promise<void> {
  switch (command.name) {
    case '/start':
      // groupstart deep link sends /start <token>
      if (command.arg) {
        await cmdLinkGroup(ctx, command.arg);
      } else {
        await ctx.tg.sendMessage({
          chat_id: ctx.message.chat.id,
          text: 'Hi! To bind this group to a team, an admin should run /link <token>.',
        });
      }
      return;
    case '/link':
      await cmdLinkGroup(ctx, command.arg);
      return;
    case '/whereami':
      await ctx.tg.sendMessage({
        chat_id: ctx.message.chat.id,
        text: ctx.binding
          ? `This group is bound to team ${ctx.binding.teamId}.`
          : 'This group is not bound to any team.',
      });
      return;
    case '/unlink':
      await cmdUnlinkGroup(ctx);
      return;
    case '/help':
      await ctx.tg.sendMessage({
        chat_id: ctx.message.chat.id,
        text:
          `Plain messages here are saved to the bound team's timeline (👀 = received).\n` +
          `Use /ask to query the timeline.\n\n` +
          `Commands (group):\n` +
          `/ask <question>  ask the timeline\n` +
          `/link <token>    bind this group to a team (admin only)\n` +
          `/whereami        show the bound team\n` +
          `/unlink          unbind (admin only)\n` +
          `/help            this message`,
      });
      return;
    case '/ask':
      if (!ctx.tgUser || !ctx.tgUserRow) {
        await ctx.tg.sendMessage({
          chat_id: ctx.message.chat.id,
          text: 'Cannot identify the sender. /ask needs a verified Telegram user.',
        });
        return;
      }
      await runAsk({
        tg: ctx.tg,
        db: ctx.db,
        chatId: ctx.message.chat.id,
        tgUserId: ctx.tgUser.id,
        updateId: ctx.updateId,
        teamId: ctx.binding?.teamId ?? null,
        userId: ctx.tgUserRow.userId,
        userName: tgDisplayName(ctx.tgUser),
        question: command.arg,
      });
      return;
    case '/team':
      await ctx.tg.sendMessage({
        chat_id: ctx.message.chat.id,
        text: '/team only works in a DM. Groups are permanently bound to one team.',
      });
      return;
    default:
      // ignore unknown commands in groups to avoid noise
      return;
  }
}

async function cmdLinkGroup(ctx: GroupContext, arg: string): Promise<void> {
  const token = arg.trim();
  if (!token) {
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: 'Usage: /link <token>. Group binding requires a team admin to issue the token.',
    });
    return;
  }
  if (!ctx.tgUser) {
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: 'Cannot identify the sender. Try again.',
    });
    return;
  }

  const issuer = ctx.tgUser;
  // Admin check: caller must be a TG admin of this chat.
  let isTgAdmin = false;
  try {
    const admins = await ctx.tg.getChatAdministrators({ chat_id: ctx.message.chat.id });
    isTgAdmin = admins.some((a) => a.user.id === issuer.id);
  } catch {
    isTgAdmin = false;
  }
  if (!isTgAdmin) {
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: 'Only group administrators can bind this group.',
    });
    return;
  }

  try {
    const teamId = await ctx.db.transaction(async (tx) => {
      const tokens = await tx
        .select()
        .from(telegramLinkTokens)
        .where(eq(telegramLinkTokens.token, token))
        .limit(1)
        .for('update');
      const row = tokens[0];
      if (!row) throw new Error('not_found');
      if (row.consumedAt) throw new Error('consumed');
      if (row.expiresAt < new Date()) throw new Error('expired');
      if (row.scope !== 'group') throw new Error('wrong_scope_group');
      // Identity gate: only the admin who issued the token (proved by
      // matching their TG @username) can consume it inside the group.
      if (!row.targetTgUsername) throw new Error('legacy_no_username');
      const consumerUsername = issuer.username?.toLowerCase() ?? '';
      if (consumerUsername !== row.targetTgUsername) throw new Error('wrong_user');
      // Issuer must still be an admin of the team at consumption time —
      // group binding is a privileged operation and a former admin's
      // outstanding token must not survive their removal/demotion.
      const issuerRoleRows = await tx
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, row.teamId),
            eq(teamMembers.userId, row.issuedByUserId),
            isNull(teamMembers.removedAt),
          ),
        )
        .limit(1);
      const issuerRole = issuerRoleRows[0]?.role;
      if (issuerRole !== 'owner' && issuerRole !== 'admin') {
        throw new Error('issuer_revoked');
      }

      const existingBinding = await tx
        .select()
        .from(telegramChatBindings)
        .where(eq(telegramChatBindings.tgChatId, ctx.message.chat.id))
        .limit(1);
      // The tg_chat_id UNIQUE constraint also enforces this — the check
      // here just gives a clearer error message in the common case.
      if (existingBinding[0]) throw new Error('already_bound');

      await tx.insert(telegramChatBindings).values({
        tgChatId: ctx.message.chat.id,
        teamId: row.teamId,
        // Provenance: removeMemberAction uses bound_by_user_id to revoke
        // group bindings established by a teammate who later leaves.
        boundByUserId: row.issuedByUserId,
        title: ctx.message.chat.title ?? null,
      });

      await tx
        .update(telegramLinkTokens)
        .set({
          consumedAt: new Date(),
          consumedByTgUserId: issuer.id,
          consumedChatId: ctx.message.chat.id,
        })
        .where(eq(telegramLinkTokens.id, row.id));

      return row.teamId;
    });
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: `Group bound to team ${teamId}. Every message here will be added to the team timeline.`,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'failed';
    const text =
      reason === 'not_found'
        ? 'Invalid link token.'
        : reason === 'consumed'
          ? 'That token has already been used.'
          : reason === 'expired'
            ? 'That token has expired.'
            : reason === 'wrong_scope_group'
              ? 'That token is for a personal DM link, not a group binding.'
              : reason === 'already_bound'
                ? 'This group is already bound to a team. Unbind it first with /unlink.'
                : reason === 'issuer_revoked'
                  ? 'The admin who issued this token is no longer an admin of that team. Ask a current admin for a new one.'
                  : reason === 'wrong_user'
                    ? 'This token was issued for a different Telegram @username. Have the issuing admin run /link from their own account.'
                    : reason === 'legacy_no_username'
                      ? 'This token predates the identity check. Generate a new one in the web app.'
                      : 'Could not bind. Try again.';
    await ctx.tg.sendMessage({ chat_id: ctx.message.chat.id, text });
  }
}

async function cmdUnlinkGroup(ctx: GroupContext): Promise<void> {
  if (!ctx.binding) {
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: 'This group is not bound.',
    });
    return;
  }
  const issuer = ctx.tgUser;
  if (!issuer) return;
  let isTgAdmin = false;
  try {
    const admins = await ctx.tg.getChatAdministrators({ chat_id: ctx.message.chat.id });
    isTgAdmin = admins.some((a) => a.user.id === issuer.id);
  } catch {
    isTgAdmin = false;
  }
  if (!isTgAdmin) {
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: 'Only group administrators can unbind this group.',
    });
    return;
  }
  await ctx.db
    .delete(telegramChatBindings)
    .where(eq(telegramChatBindings.tgChatId, ctx.message.chat.id));
  await ctx.tg.sendMessage({
    chat_id: ctx.message.chat.id,
    text: 'Unbound. New messages here will not be recorded.',
  });
}

// ---------- helpers ----------

export function parseCommand(text: string): { name: string; arg: string } | null {
  if (!text.startsWith('/')) return null;
  const space = text.indexOf(' ');
  let head = space === -1 ? text : text.slice(0, space);
  // Telegram appends @botusername to commands in groups.
  const at = head.indexOf('@');
  if (at !== -1) head = head.slice(0, at);
  const arg = space === -1 ? '' : text.slice(space + 1).trim();
  return { name: head.toLowerCase(), arg };
}

async function upsertTelegramUser(
  db: Db,
  user: TgUser,
): Promise<{ id: string; userId: string | null }> {
  // Single statement upsert. Two concurrent webhook workers seeing the same
  // brand-new TG user used to race a SELECT-then-INSERT and the loser would
  // throw on the unique violation, swallowed by handleUpdate — that update's
  // message was then silently dropped because Telegram had already gotten a
  // 200 from the winning request.
  const rows = await db
    .insert(telegramUsers)
    .values({
      tgUserId: user.id,
      username: user.username ?? null,
      firstName: user.first_name ?? null,
      lastName: user.last_name ?? null,
    })
    .onConflictDoUpdate({
      target: telegramUsers.tgUserId,
      set: {
        username: user.username ?? null,
        firstName: user.first_name ?? null,
        lastName: user.last_name ?? null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: telegramUsers.id, userId: telegramUsers.userId });
  const row = rows[0];
  if (!row) throw new Error('Failed to upsert telegram_users row');
  return row;
}

async function getActiveTeamId(db: Db, telegramUserId: string): Promise<string | null> {
  const rows = await db
    .select({ teamId: telegramUserTeams.teamId })
    .from(telegramUserTeams)
    .where(
      and(
        eq(telegramUserTeams.telegramUserId, telegramUserId),
        eq(telegramUserTeams.isActive, true),
      ),
    )
    .limit(1);
  return rows[0]?.teamId ?? null;
}

async function getChatBinding(
  db: Db,
  tgChatId: number,
  title: string | null,
): Promise<{ teamId: string; boundByUserId: string | null } | null> {
  const rows = await db
    .select({
      id: telegramChatBindings.id,
      teamId: telegramChatBindings.teamId,
      boundByUserId: telegramChatBindings.boundByUserId,
      title: telegramChatBindings.title,
    })
    .from(telegramChatBindings)
    .where(eq(telegramChatBindings.tgChatId, tgChatId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Refresh denormalized title only when it actually changed, so steady-state
  // group activity stays at one write per message (the raw_events insert).
  if (title && title !== row.title) {
    await db.update(telegramChatBindings).set({ title }).where(eq(telegramChatBindings.id, row.id));
  }
  return { teamId: row.teamId, boundByUserId: row.boundByUserId };
}

interface InsertEventInput {
  /**
   * The team to land non-edit messages on (active DM team or group binding).
   * For edits, this is also the fallback when the original isn't found — see
   * "orphan edit" handling below. Null means "no current routing context"
   * (e.g. /unlinked DM); edits can still be recorded against the original
   * event's team if we find one.
   */
  fallbackTeamId: string | null;
  authorUserId: string | null;
  visibilityOwnerUserId?: string | null;
  text: string | null;
  message: TgMessage;
  updateId: number;
  sourceUnverified: boolean;
  isEdit: boolean;
  /** Audio attachment: S3 object key + extra metadata to merge into source_metadata. */
  audio?: {
    key: string;
    extra: Record<string, unknown>;
  };
}

async function insertEvent(
  db: Db,
  input: InsertEventInput,
): Promise<{ id: string; teamId: string } | null> {
  const metadata: Record<string, unknown> = {
    tg_chat_id: input.message.chat.id,
    tg_chat_type: input.message.chat.type,
    tg_message_id: input.message.message_id,
    tg_update_id: input.updateId,
  };
  if (input.message.chat.title) metadata.tg_chat_title = input.message.chat.title;
  if (input.message.from) {
    metadata.tg_user_id = input.message.from.id;
    const senderName = telegramSenderName(input.message.from);
    if (senderName) metadata.tg_sender_name = senderName;
    if (input.message.from.username) metadata.tg_username = input.message.from.username;
  }
  if (input.audio) {
    Object.assign(metadata, input.audio.extra);
  }

  let teamId: string | null = input.fallbackTeamId;
  if (input.isEdit) {
    // Edits inherit the original event's team_id. A DM author can switch
    // /team or even /unlink between the original send and the edit; if we
    // used current context here, the edit would land on a different team
    // than the original (or be dropped entirely).
    const original = await findOriginalEvent(
      db,
      input.message.chat.id,
      input.message.message_id,
      teamId,
    );
    if (original) {
      metadata.edits_event_id = original.id;
      teamId = original.teamId;
    } else if (teamId) {
      // No original found yet — most likely the original webhook failed
      // before its insert and Telegram is still retrying it. Record the
      // edit under the current routing context so the correction is not
      // silently lost; a future reconciliation pass can relink it.
      metadata.edit_orphan = true;
    } else {
      // No original AND no current team to attribute to (e.g. edit of a
      // pre-link message after /unlink). Nothing safe to write.
      return null;
    }
  }
  if (!teamId) return null;

  // Per-message membership check. The candidate author_user_id comes from
  // telegram_users.user_id (bound at /link time after the username-match
  // identity gate). It can go stale if the user is later removed from the
  // team while their Telegram account is still in a bound group chat
  // someone else owns. Don't attribute group/DM messages to non-members;
  // they ingest as source_unverified instead so the timeline doesn't
  // grow ghost-authored events.
  let authorUserId = input.authorUserId;
  let sourceUnverified = input.sourceUnverified;
  if (authorUserId) {
    const stillMember = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, authorUserId),
          isNull(teamMembers.removedAt),
        ),
      )
      .limit(1);
    if (!stillMember[0]) {
      authorUserId = null;
      sourceUnverified = true;
    }
  }
  if (sourceUnverified) metadata.source_unverified = true;

  const defaults = await resolveTelegramVisibilityDefault(db, teamId);
  const visibilityOwnerUserId = await resolveTelegramVisibilityOwnerUserId(db, teamId, [
    input.visibilityOwnerUserId ?? null,
    authorUserId,
    defaults.sourceOwnerUserId,
  ]);
  const visibility =
    defaults.visibility === 'private' && visibilityOwnerUserId === null
      ? 'team'
      : defaults.visibility;

  // Edits use edit_date for occurredAt so the timeline orders them by when
  // the user actually edited, not by when the original was sent.
  const occurredAtSec = input.isEdit
    ? (input.message.edit_date ?? input.message.date)
    : input.message.date;

  const eventValues = {
    teamId,
    authorUserId,
    source: 'telegram' as const,
    contentText: input.text,
    contentAudioUrl: input.audio?.key ?? null,
    occurredAt: new Date(occurredAtSec * 1000),
    visibility,
    visibilityOwnerUserId,
    sourceMetadata: metadata,
  };

  async function insertRawEvent(tx: DbOrTx): Promise<{ id: string; teamId: string } | null> {
    // ON CONFLICT DO NOTHING against the partial unique index on
    // (source_metadata->>'tg_update_id') WHERE source='telegram'. If Telegram
    // retries an update because we didn't 200 in time (or the process crashed
    // mid-handler), the second insert is a silent no-op instead of a duplicate
    // row in the timeline.
    const inserted = await tx
      .insert(rawEvents)
      .values(eventValues)
      .onConflictDoNothing()
      .returning({ id: rawEvents.id, teamId: rawEvents.teamId });
    return inserted[0] ?? null;
  }

  if (input.isEdit) {
    return db.transaction(async (tx) => {
      await lockTelegramMessageRevisions(tx, {
        teamId,
        chatId: input.message.chat.id,
        messageId: input.message.message_id,
      });
      const inserted = await insertRawEvent(tx);
      const row = inserted ?? (await findEventByUpdateId(tx, input.updateId));
      if (row) {
        const latest = await findLatestTelegramRevision(tx, {
          teamId,
          chatId: input.message.chat.id,
          messageId: input.message.message_id,
        });
        if (latest) {
          await tombstoneSupersededTelegramRevisions(tx, {
            teamId,
            chatId: input.message.chat.id,
            messageId: input.message.message_id,
            supersededByEventId: latest.id,
          });
        }
        return inserted && latest?.id === inserted.id ? inserted : null;
      }
      return null;
    });
  }

  return insertRawEvent(db);
}

async function tombstoneSupersededTelegramRevisions(
  db: DbOrTx,
  input: {
    teamId: string;
    chatId: number;
    messageId: number;
    supersededByEventId: string;
  },
): Promise<void> {
  const patch = JSON.stringify({
    deleted: true,
    delete_reason: 'telegram_superseded_by_edit',
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
        eq(rawEvents.source, 'telegram'),
        ne(rawEvents.id, input.supersededByEventId),
        sql`(${rawEvents.sourceMetadata} ->> 'tg_chat_id')::bigint = ${input.chatId}`,
        sql`(${rawEvents.sourceMetadata} ->> 'tg_message_id')::bigint = ${input.messageId}`,
        sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
      ),
    );
}

async function resolveTelegramVisibilityOwnerUserId(
  db: DbOrTx,
  teamId: string,
  candidates: (string | null | undefined)[],
): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const rows = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, candidate),
          isNull(teamMembers.removedAt),
        ),
      )
      .limit(1);
    if (rows[0]) return candidate;
  }
  return null;
}

async function lockTelegramMessageRevisions(
  db: DbOrTx,
  input: { teamId: string; chatId: number; messageId: number },
): Promise<void> {
  await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, input.teamId),
        eq(rawEvents.source, 'telegram'),
        sql`(${rawEvents.sourceMetadata} ->> 'tg_chat_id')::bigint = ${input.chatId}`,
        sql`(${rawEvents.sourceMetadata} ->> 'tg_message_id')::bigint = ${input.messageId}`,
      ),
    )
    .for('update');
}

async function findLatestTelegramRevision(
  db: DbOrTx,
  input: { teamId: string; chatId: number; messageId: number },
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, input.teamId),
        eq(rawEvents.source, 'telegram'),
        sql`(${rawEvents.sourceMetadata} ->> 'tg_chat_id')::bigint = ${input.chatId}`,
        sql`(${rawEvents.sourceMetadata} ->> 'tg_message_id')::bigint = ${input.messageId}`,
        sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
      ),
    )
    .orderBy(
      desc(rawEvents.occurredAt),
      sql`(${rawEvents.sourceMetadata} ->> 'tg_update_id')::bigint DESC`,
    )
    .limit(1);
  return rows[0] ?? null;
}

async function resolveTelegramVisibilityDefault(
  db: Db,
  teamId: string,
): Promise<{ visibility: 'private' | 'team'; sourceOwnerUserId: string | null }> {
  const rows = await db
    .select()
    .from(teamVisibilityDefaults)
    .where(
      and(
        eq(teamVisibilityDefaults.teamId, teamId),
        sql`${teamVisibilityDefaults.source} IN ('telegram', 'team')`,
      ),
    );
  const row = rows.find((r) => r.source === 'telegram') ?? rows.find((r) => r.source === 'team');
  return {
    visibility: row?.visibility === 'private' ? 'private' : 'team',
    sourceOwnerUserId: row?.sourceOwnerUserId ?? null,
  };
}

interface AudioIngestCtx {
  db: Db;
  tg: TelegramApi;
  audio: AudioIngestDeps | undefined;
  message: TgMessage;
  updateId: number;
  authorUserId: string | null;
  visibilityOwnerUserId?: string | null;
  sourceUnverified: boolean;
}

const MIME_TO_EXT: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/oga': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
};

function extForMime(mime: string | undefined, fallback: string): string {
  if (!mime) return fallback;
  return MIME_TO_EXT[mime.toLowerCase()] ?? fallback;
}

async function ingestAudio(
  ctx: AudioIngestCtx,
  payload: TgAudioPayload,
  kind: 'voice' | 'audio',
  teamId: string,
): Promise<boolean> {
  if (!ctx.audio) {
    // No audio ingest deps wired (e.g. local dev without RustFS env). Phase 2
    // behavior for unsupported media: silently drop, log so it's visible.
    log.warn('audio message dropped — audio ingest not configured');
    return false;
  }

  let fileInfo;
  let bytes: Buffer;
  try {
    fileInfo = await ctx.tg.getFile({ file_id: payload.file_id });
    bytes = await ctx.tg.downloadFile(
      fileInfo.file_path,
      CONVERSATIONAL_ATTACHMENT_LIMITS.maxBytes,
    );
    if (bytes.length > CONVERSATIONAL_ATTACHMENT_LIMITS.maxBytes) throw new Error('file_oversize');
  } catch (err) {
    log.error({ err }, 'audio fetch failed');
    return false;
  }

  const mimeType = payload.mime_type ?? (kind === 'voice' ? 'audio/ogg' : 'audio/mpeg');
  const extension = extForMime(mimeType, kind === 'voice' ? 'ogg' : 'bin');
  const key = ctx.audio.buildAudioKey({
    teamId,
    chatId: ctx.message.chat.id,
    messageId: ctx.message.message_id,
    fileId: payload.file_id,
    extension,
  });

  try {
    await ctx.audio.upload({ key, body: bytes, contentType: mimeType });
  } catch (err) {
    log.error({ err }, 'audio upload failed');
    return false;
  }

  const extra: Record<string, unknown> = {
    audio_kind: kind,
    audio_mime_type: mimeType,
    tg_file_id: payload.file_id,
  };
  if (typeof payload.duration === 'number') extra.audio_duration_sec = payload.duration;
  if (typeof payload.file_size === 'number') extra.audio_file_size = payload.file_size;
  // Telegram lets users attach a caption to voice/audio messages. The audio
  // is the primary content (content_text will hold the transcript), but the
  // caption is user-authored signal we must not drop. Stash it alongside
  // the audio metadata so the timeline / future extraction can surface it.
  if (ctx.message.caption) extra.tg_caption = ctx.message.caption;

  const eventInput: InsertEventInput = {
    fallbackTeamId: teamId,
    authorUserId: ctx.authorUserId,
    text: null,
    message: ctx.message,
    updateId: ctx.updateId,
    sourceUnverified: ctx.sourceUnverified,
    isEdit: false,
    audio: { key, extra },
  };
  if (ctx.visibilityOwnerUserId !== undefined) {
    eventInput.visibilityOwnerUserId = ctx.visibilityOwnerUserId;
  }
  const inserted = await insertEvent(ctx.db, eventInput);

  // Self-heal on retry: if `insertEvent` returned null, the row was inserted
  // on a prior webhook delivery but our enqueue may have failed (or the
  // process died before it could run). Look the row up by tg_update_id and
  // try the enqueue again. BullMQ dedups on jobId=rawEventId, so this is
  // a no-op when the original enqueue already succeeded.
  const target = inserted ?? (await findEventByUpdateId(ctx.db, ctx.updateId));
  if (!target) return false;

  try {
    await ctx.audio.enqueueTranscribe({
      rawEventId: target.id,
      teamId: target.teamId,
      audioKey: key,
    });
  } catch (err) {
    log.error({ err }, 'transcribe enqueue failed');
    // Row is already committed with an audio key and no content_text. With
    // no job in the queue, the worker's `failed` handler will never run
    // either, so the timeline would otherwise show "Transcribing…"
    // indefinitely. Mark the row inline so the UI surfaces the failure
    // state and a future reconciler has a flag to act on. Mirrors the
    // worker's permanent-failure shape (transcription_failed_at +
    // transcription_error).
    const failurePatch = JSON.stringify({
      transcription_failed_at: new Date().toISOString(),
      transcription_error: `enqueue failed: ${err instanceof Error ? err.message.slice(0, 480) : 'unknown'}`,
    });
    await ctx.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
      })
      .where(eq(rawEvents.id, target.id))
      .catch((markErr: unknown) => {
        log.error({ err: markErr }, 'failed to mark row failure');
      });
  }
  return Boolean(inserted);
}

type TelegramDocumentAttachment =
  | { kind: 'document'; payload: TgDocumentPayload; filename: string; contentType: string | null }
  | { kind: 'photo'; payload: TgPhotoSize; filename: string; contentType: string };

function pickTelegramDocumentAttachment(message: TgMessage): TelegramDocumentAttachment | null {
  if (message.document) {
    return {
      kind: 'document',
      payload: message.document,
      filename: message.document.file_name ?? `${message.document.file_id}.bin`,
      contentType: message.document.mime_type ?? null,
    };
  }
  const photo = message.photo?.slice().sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0];
  if (photo) {
    return {
      kind: 'photo',
      payload: photo,
      filename: `${photo.file_id}.jpg`,
      contentType: 'image/jpeg',
    };
  }
  return null;
}

async function ingestTelegramDocumentAttachment(
  ctx: {
    db: Db;
    tg: TelegramApi;
    audio?: AudioIngestDeps;
    documents?: DocumentAttachmentDeps;
    message: TgMessage;
  },
  attachment: TelegramDocumentAttachment,
  parent: { id: string; teamId: string; authorUserId: string | null } | null,
): Promise<void> {
  if (!parent) return;
  const sizeBytes = attachment.payload.file_size ?? null;
  const decision = classifyConversationalAttachment({
    filename: attachment.filename,
    contentType: attachment.contentType,
    sizeBytes,
  });
  if (decision.kind === 'audio') {
    await ingestTelegramDocumentAudioAttachment(ctx, attachment, parent);
    return;
  }
  if (!ctx.documents) return;
  const documentDeps = ctx.documents;
  if (decision.kind !== 'document') {
    const patch = JSON.stringify({
      attachment_skips: [
        {
          source: 'telegram',
          file_id: attachment.payload.file_id,
          filename: attachment.filename,
          reason: decision.reason,
        },
      ],
    });
    await ctx.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
      })
      .where(eq(rawEvents.id, parent.id));
    return;
  }

  let fileInfo;
  let bytes: Buffer;
  try {
    fileInfo = await ctx.tg.getFile({ file_id: attachment.payload.file_id });
    bytes = await ctx.tg.downloadFile(
      fileInfo.file_path,
      CONVERSATIONAL_ATTACHMENT_LIMITS.maxBytes,
    );
    if (bytes.length > CONVERSATIONAL_ATTACHMENT_LIMITS.maxBytes) throw new Error('file_oversize');
  } catch (err) {
    log.error({ err }, 'telegram document fetch failed');
    return;
  }

  const contentType = attachment.contentType ?? 'application/octet-stream';
  await ctx.db.transaction(async (tx) => {
    const docRows = await tx
      .insert(documents)
      .values({
        teamId: parent.teamId,
        name: attachment.filename,
        ownerUserId: parent.authorUserId,
        visibility: 'team',
        metadata: {
          source: 'telegram',
          tg_file_id: attachment.payload.file_id,
          parent_raw_event_id: parent.id,
        },
      })
      .returning({ id: documents.id });
    const doc = docRows[0];
    if (!doc) throw new Error('telegram_document_insert_failed');
    const key = buildDocumentObjectKey({
      teamId: parent.teamId,
      documentId: doc.id,
      version: 1,
      filename: attachment.filename,
    });
    const eventRows = await tx
      .insert(rawEvents)
      .values({
        teamId: parent.teamId,
        authorUserId: parent.authorUserId,
        source: 'document',
        contentText: `Uploaded ${attachment.filename}`,
        visibility: 'team',
        sourceMetadata: {
          action: 'upload',
          document_id: doc.id,
          document_name: attachment.filename,
          document_version: 1,
          source: 'telegram',
          tg_file_id: attachment.payload.file_id,
          parent_raw_event_id: parent.id,
        },
      })
      .returning({ id: rawEvents.id });
    const event = eventRows[0];
    if (!event) throw new Error('telegram_document_event_insert_failed');
    const versionRows = await tx
      .insert(documentVersions)
      .values({
        teamId: parent.teamId,
        documentId: doc.id,
        version: 1,
        objectKey: key,
        byteSize: bytes.length,
        contentType,
        uploadedByUserId: parent.authorUserId,
        sourceEventId: event.id,
        processingStatus: 'pending',
      })
      .returning({ id: documentVersions.id });
    const version = versionRows[0];
    if (!version) throw new Error('telegram_document_version_insert_failed');
    await tx
      .update(documents)
      .set({ currentVersionId: version.id })
      .where(eq(documents.id, doc.id));
    await documentDeps.upload({ key, body: bytes, contentType });
    await documentDeps.enqueueExtract({ documentVersionId: version.id, teamId: parent.teamId });
  });
}

async function ingestTelegramDocumentAudioAttachment(
  ctx: { db: Db; tg: TelegramApi; audio?: AudioIngestDeps; message: TgMessage },
  attachment: TelegramDocumentAttachment,
  parent: { id: string; teamId: string; authorUserId: string | null },
): Promise<void> {
  if (!ctx.audio) {
    await recordTelegramAttachmentSkip(ctx.db, parent.id, {
      source: 'telegram',
      file_id: attachment.payload.file_id,
      filename: attachment.filename,
      reason: 'audio_ingest_not_configured',
    });
    return;
  }

  let fileInfo;
  let bytes: Buffer;
  try {
    fileInfo = await ctx.tg.getFile({ file_id: attachment.payload.file_id });
    bytes = await ctx.tg.downloadFile(
      fileInfo.file_path,
      CONVERSATIONAL_ATTACHMENT_LIMITS.maxBytes,
    );
    if (bytes.length > CONVERSATIONAL_ATTACHMENT_LIMITS.maxBytes) throw new Error('file_oversize');
  } catch (err) {
    log.error({ err }, 'telegram document audio fetch failed');
    await recordTelegramAttachmentSkip(ctx.db, parent.id, {
      source: 'telegram',
      file_id: attachment.payload.file_id,
      filename: attachment.filename,
      reason:
        err instanceof Error && err.message === 'file_oversize' ? 'oversize' : 'download_failed',
    });
    return;
  }

  const contentType = attachment.contentType ?? 'application/octet-stream';
  const extension = extensionOf(attachment.filename) || extForMime(contentType, 'bin');
  const key = ctx.audio.buildAudioKey({
    teamId: parent.teamId,
    chatId: ctx.message.chat.id,
    messageId: ctx.message.message_id,
    fileId: attachment.payload.file_id,
    extension,
  });

  try {
    await ctx.audio.upload({ key, body: bytes, contentType });
  } catch (err) {
    log.error({ err }, 'telegram document audio upload failed');
    await recordTelegramAttachmentSkip(ctx.db, parent.id, {
      source: 'telegram',
      file_id: attachment.payload.file_id,
      filename: attachment.filename,
      reason: 'upload_failed',
    });
    return;
  }

  const rows = await ctx.db
    .insert(rawEvents)
    .values({
      teamId: parent.teamId,
      authorUserId: parent.authorUserId,
      source: 'telegram',
      contentText: null,
      contentAudioUrl: key,
      visibility: 'team',
      sourceMetadata: telegramAttachmentMetadata(ctx.message, {
        tg_attachment_kind: 'audio',
        tg_file_id: attachment.payload.file_id,
        tg_file_name: attachment.filename,
        tg_parent_raw_event_id: parent.id,
        audio_mime_type: contentType,
        audio_file_size: attachment.payload.file_size ?? null,
      }),
    })
    .returning({ id: rawEvents.id, teamId: rawEvents.teamId });
  const row = rows[0];
  if (!row) return;

  try {
    await ctx.audio.enqueueTranscribe({
      rawEventId: row.id,
      teamId: row.teamId,
      audioKey: key,
    });
  } catch (err) {
    log.error({ err }, 'telegram document audio transcribe enqueue failed');
  }
}

function telegramAttachmentMetadata(
  message: TgMessage,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    tg_chat_id: message.chat.id,
    tg_chat_type: message.chat.type,
    tg_message_id: message.message_id,
    ...extra,
  };
  if (message.chat.title) metadata.tg_chat_title = message.chat.title;
  if (message.from) {
    metadata.tg_user_id = message.from.id;
    const senderName = telegramSenderName(message.from);
    if (senderName) metadata.tg_sender_name = senderName;
    if (message.from.username) metadata.tg_username = message.from.username;
  }
  if (message.caption) metadata.tg_caption = message.caption;
  return metadata;
}

async function recordTelegramAttachmentSkip(
  db: Db,
  parentRawEventId: string,
  skip: Record<string, unknown>,
): Promise<void> {
  const patch = JSON.stringify({ attachment_skips: [skip] });
  await db
    .update(rawEvents)
    .set({
      sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
    })
    .where(eq(rawEvents.id, parentRawEventId));
}

async function findEventByUpdateId(
  db: DbOrTx,
  updateId: number,
): Promise<{ id: string; teamId: string } | null> {
  const rows = await db
    .select({ id: rawEvents.id, teamId: rawEvents.teamId })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.source, 'telegram'),
        sql`(${rawEvents.sourceMetadata} ->> 'tg_update_id')::bigint = ${updateId}`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function findOriginalEvent(
  db: DbOrTx,
  chatId: number,
  messageId: number,
  preferredTeamId: string | null = null,
): Promise<{ id: string; teamId: string } | null> {
  // Excludes:
  //   - rows that are themselves edits (have edits_event_id)
  //   - orphan-edit rows (edit_orphan=true) — these are edits we recorded
  //     before the original was inserted; they must NOT be picked up as the
  //     original by a later edit, or edits would chain onto an orphan
  //     instead of the real first message once it lands.
  // Ordered by createdAt to keep behavior deterministic if more than one
  // row somehow matches.
  async function lookup(teamId: string | null): Promise<{ id: string; teamId: string } | null> {
    const conditions = [
      eq(rawEvents.source, 'telegram'),
      sql`(${rawEvents.sourceMetadata} ->> 'tg_chat_id')::bigint = ${chatId}`,
      sql`(${rawEvents.sourceMetadata} ->> 'tg_message_id')::bigint = ${messageId}`,
      sql`(${rawEvents.sourceMetadata} ? 'edits_event_id') = false`,
      sql`COALESCE((${rawEvents.sourceMetadata} ->> 'edit_orphan')::boolean, false) = false`,
    ];
    if (teamId) conditions.push(eq(rawEvents.teamId, teamId));
    const rows = await db
      .select({ id: rawEvents.id, teamId: rawEvents.teamId })
      .from(rawEvents)
      .where(and(...conditions))
      .orderBy(asc(rawEvents.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  return (preferredTeamId ? await lookup(preferredTeamId) : null) ?? lookup(null);
}
