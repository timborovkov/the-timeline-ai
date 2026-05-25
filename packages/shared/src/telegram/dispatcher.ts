import {
  type Db,
  rawEvents,
  teamMembers,
  telegramChatBindings,
  telegramLinkTokens,
  telegramUsers,
  telegramUserTeams,
} from '@timeline/db';
import { and, asc, eq, sql } from 'drizzle-orm';

import { askAgent } from '../agent/ask.js';
import { childLogger } from '../logger.js';
import { getRedisConnection } from '../queue/connection.js';
import { checkRateLimit, rateLimitKey, RATE_LIMITS } from '../rate-limit/index.js';

import { type TelegramApi } from './api.js';
import {
  tgUpdateSchema,
  type TgAudioPayload,
  type TgMessage,
  type TgUpdate,
  type TgUser,
} from './types.js';

const log = childLogger('telegram');

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

interface DispatcherDeps {
  db: Db;
  tg: TelegramApi;
  audio?: AudioIngestDeps;
  extract?: ExtractEnqueueDeps;
  embed?: EmbedEnqueueDeps;
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
  binding: { teamId: string } | null;
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
    await ingestAudio(
      {
        db: ctx.db,
        tg: ctx.tg,
        audio: ctx.audio,
        message: ctx.message,
        updateId: ctx.updateId,
        authorUserId: ctx.tgUserRow.userId,
        sourceUnverified: ctx.tgUserRow.userId === null,
      },
      audio,
      ctx.message.voice ? 'voice' : 'audio',
      ctx.activeTeamId,
    );
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
        .where(and(eq(teamMembers.teamId, row.teamId), eq(teamMembers.userId, row.issuedByUserId)))
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

      return row.teamId;
    });
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: `Linked. This chat is now attributed to team ${teamId}. Run /team to switch active team later.`,
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
      isActive: telegramUserTeams.isActive,
    })
    .from(telegramUserTeams)
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
      text: `Only one linked team (${first.teamId}). It's now active.`,
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
        text: `Active team is now ${target.teamId}.`,
      });
      return;
    }
    await ctx.tg.sendMessage({
      chat_id: ctx.message.chat.id,
      text: `Invalid team number. Pick one of 1..${memberships.length}.`,
    });
    return;
  }

  const lines = memberships.map((m, i) => `${i + 1}. ${m.teamId}${m.isActive ? '  ← active' : ''}`);
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
  await ctx.tg.sendMessage({
    chat_id: ctx.message.chat.id,
    text: `Active team: ${ctx.activeTeamId}. Messages you send here land in that team's timeline.`,
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
  const parts = [u.first_name, u.last_name].filter((p): p is string => !!p && p.length > 0);
  if (parts.length > 0) return parts.join(' ');
  if (u.username) return `@${u.username}`;
  return 'a teammate';
}

/**
 * Shared `/ask` runner used by both DM and group dispatchers. Validates that
 * the chat has a team to answer against and that the sender is a known user
 * (TeamScope requires a real userId — unverified senders can't pose as a
 * teammate). Per-user rate-limited tighter than ingest because each call hits
 * OpenRouter.
 */
async function runAsk(input: {
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
}): Promise<void> {
  // Idempotency gate: if Telegram retries this update_id (typical when the
  // webhook handler takes longer than ~60s, which can happen when the agent
  // runs multi-tool turns), short-circuit so we don't bill OpenRouter twice
  // and the user doesn't get duplicate replies. Fail-open when Redis is
  // unavailable — capture and answer keep working at the cost of possible
  // double-billing during an outage.
  const claimed = await claimAskUpdate(input.updateId);
  if (!claimed) {
    log.info({ updateId: input.updateId, tgUserId: input.tgUserId }, 'ask_update_dedup');
    return;
  }
  const question = input.question.trim();
  if (!question) {
    await input.tg.sendMessage({
      chat_id: input.chatId,
      text: 'Usage: /ask <question>. Example: /ask what did we ship this week?',
    });
    return;
  }
  if (!input.teamId) {
    await input.tg.sendMessage({
      chat_id: input.chatId,
      text: 'No team to ask. Run /link <token> first.',
    });
    return;
  }
  if (!input.userId) {
    await input.tg.sendMessage({
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
    await input.tg.sendMessage({
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
    await input.tg.sendMessage({ chat_id: input.chatId, text });
    return;
  }
  await input.tg.sendMessage({ chat_id: input.chatId, text: result.answer });
}

/**
 * Claim a Telegram update_id for /ask processing. Returns `true` if this is
 * the first time we've seen it (caller should proceed), `false` if it's a
 * duplicate webhook delivery (caller should silently drop).
 *
 * Backed by Redis SET NX with a 10-minute TTL — long enough to cover
 * Telegram's retry window for a slow handler, short enough that the key set
 * stays bounded. Without Redis we fail-open: capture is correctness, this
 * dedup is only a cost/UX guard.
 */
async function claimAskUpdate(updateId: number): Promise<boolean> {
  try {
    const conn = getRedisConnection();
    const key = `tg:ask:seen:${updateId}`;
    const reply = await conn.set(key, '1', 'EX', 600, 'NX');
    return reply === 'OK';
  } catch (err) {
    log.warn({ err: (err as Error).message, updateId }, 'ask_dedup_unavailable');
    return true;
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
    text,
    message: ctx.message,
    updateId: ctx.updateId,
    sourceUnverified: ctx.tgUserRow.userId === null,
    isEdit,
  });
  await maybeEnqueueExtract(ctx, inserted);
  await maybeEnqueueEmbed(ctx, inserted);
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
        sourceUnverified: !ctx.tgUserRow?.userId,
      },
      audio,
      ctx.message.voice ? 'voice' : 'audio',
      ctx.binding.teamId,
    );
    return;
  }

  if (text) {
    const inserted = await insertEvent(ctx.db, {
      fallbackTeamId: ctx.binding?.teamId ?? null,
      authorUserId: ctx.tgUserRow?.userId ?? null,
      text,
      message: ctx.message,
      updateId: ctx.updateId,
      sourceUnverified: !ctx.tgUserRow?.userId,
      isEdit,
    });
    await maybeEnqueueExtract(ctx, inserted);
    await maybeEnqueueEmbed(ctx, inserted);
    if (inserted && !isEdit) {
      await ackReaction(ctx.tg, ctx.message.chat.id, ctx.message.message_id);
    }
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
        .where(and(eq(teamMembers.teamId, row.teamId), eq(teamMembers.userId, row.issuedByUserId)))
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
): Promise<{ teamId: string } | null> {
  const rows = await db
    .select({
      id: telegramChatBindings.id,
      teamId: telegramChatBindings.teamId,
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
  return { teamId: row.teamId };
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
  if (input.message.from) {
    metadata.tg_user_id = input.message.from.id;
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
    const original = await findOriginalEvent(db, input.message.chat.id, input.message.message_id);
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
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, authorUserId)))
      .limit(1);
    if (!stillMember[0]) {
      authorUserId = null;
      sourceUnverified = true;
    }
  }
  if (sourceUnverified) metadata.source_unverified = true;

  // Edits use edit_date for occurredAt so the timeline orders them by when
  // the user actually edited, not by when the original was sent.
  const occurredAtSec = input.isEdit
    ? (input.message.edit_date ?? input.message.date)
    : input.message.date;

  // ON CONFLICT DO NOTHING against the partial unique index on
  // (source_metadata->>'tg_update_id') WHERE source='telegram'. If Telegram
  // retries an update because we didn't 200 in time (or the process crashed
  // mid-handler), the second insert is a silent no-op instead of a duplicate
  // row in the timeline.
  const inserted = await db
    .insert(rawEvents)
    .values({
      teamId,
      authorUserId,
      source: 'telegram',
      contentText: input.text,
      contentAudioUrl: input.audio?.key ?? null,
      occurredAt: new Date(occurredAtSec * 1000),
      sourceMetadata: metadata,
    })
    .onConflictDoNothing()
    .returning({ id: rawEvents.id, teamId: rawEvents.teamId });
  return inserted[0] ?? null;
}

interface AudioIngestCtx {
  db: Db;
  tg: TelegramApi;
  audio: AudioIngestDeps | undefined;
  message: TgMessage;
  updateId: number;
  authorUserId: string | null;
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
): Promise<void> {
  if (!ctx.audio) {
    // No audio ingest deps wired (e.g. local dev without RustFS env). Phase 2
    // behavior for unsupported media: silently drop, log so it's visible.
    log.warn('audio message dropped — audio ingest not configured');
    return;
  }

  let fileInfo;
  let bytes: Buffer;
  try {
    fileInfo = await ctx.tg.getFile({ file_id: payload.file_id });
    bytes = await ctx.tg.downloadFile(fileInfo.file_path);
  } catch (err) {
    log.error({ err }, 'audio fetch failed');
    return;
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
    return;
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

  const inserted = await insertEvent(ctx.db, {
    fallbackTeamId: teamId,
    authorUserId: ctx.authorUserId,
    text: null,
    message: ctx.message,
    updateId: ctx.updateId,
    sourceUnverified: ctx.sourceUnverified,
    isEdit: false,
    audio: { key, extra },
  });

  // Self-heal on retry: if `insertEvent` returned null, the row was inserted
  // on a prior webhook delivery but our enqueue may have failed (or the
  // process died before it could run). Look the row up by tg_update_id and
  // try the enqueue again. BullMQ dedups on jobId=rawEventId, so this is
  // a no-op when the original enqueue already succeeded.
  const target = inserted ?? (await findEventByUpdateId(ctx.db, ctx.updateId));
  if (!target) return;

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
}

async function findEventByUpdateId(
  db: Db,
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
  db: Db,
  chatId: number,
  messageId: number,
): Promise<{ id: string; teamId: string } | null> {
  // Excludes:
  //   - rows that are themselves edits (have edits_event_id)
  //   - orphan-edit rows (edit_orphan=true) — these are edits we recorded
  //     before the original was inserted; they must NOT be picked up as the
  //     original by a later edit, or edits would chain onto an orphan
  //     instead of the real first message once it lands.
  // Ordered by createdAt to keep behavior deterministic if more than one
  // row somehow matches.
  const rows = await db
    .select({ id: rawEvents.id, teamId: rawEvents.teamId })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.source, 'telegram'),
        sql`(${rawEvents.sourceMetadata} ->> 'tg_chat_id')::bigint = ${chatId}`,
        sql`(${rawEvents.sourceMetadata} ->> 'tg_message_id')::bigint = ${messageId}`,
        sql`(${rawEvents.sourceMetadata} ? 'edits_event_id') = false`,
        sql`COALESCE((${rawEvents.sourceMetadata} ->> 'edit_orphan')::boolean, false) = false`,
      ),
    )
    .orderBy(asc(rawEvents.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
