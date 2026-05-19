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

import { type TelegramApi } from './api';
import { tgUpdateSchema, type TgMessage, type TgUpdate, type TgUser } from './types';

interface DispatcherDeps {
  db: Db;
  tg: TelegramApi;
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
    console.error('[telegram] dispatch failed', err);
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

  if (!text) return; // text-only ingest in Phase 2
  await ingestDmText(ctx, text, isEdit);
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
        await tx
          .update(telegramUserTeams)
          .set({ isActive: true })
          .where(eq(telegramUserTeams.id, existing[0].id));
      } else {
        await tx.insert(telegramUserTeams).values({
          telegramUserId: ctx.tgUserRow.id,
          teamId: row.teamId,
          isActive: true,
        });
      }

      // We do NOT bind telegram_users.user_id = row.issuedByUserId here.
      // A single short-lived token can't prove the consumer IS the issuer —
      // anyone who obtains the token (paste in wrong window, shoulder-surf)
      // could then post to the team's timeline attributed to the issuer.
      // Until Phase 2b adds an out-of-band confirmation flow, messages from
      // a linked DM land in the right team but with author_user_id=null and
      // source_unverified=true. The team binding (telegram_user_teams) is
      // safe to establish — it only routes to a team the issuer is already
      // a member of; the unverified flag is what protects attribution.
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
      `Commands (DM):\n` +
      `/link <token>   connect this DM to a team\n` +
      `/team           list linked teams; /team N switches\n` +
      `/whereami       show current active team\n` +
      `/unlink         disconnect all teams\n` +
      `/help           this message`,
  });
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
  await insertEvent(ctx.db, {
    fallbackTeamId: ctx.activeTeamId,
    authorUserId: ctx.tgUserRow.userId,
    text,
    message: ctx.message,
    updateId: ctx.updateId,
    sourceUnverified: ctx.tgUserRow.userId === null,
    isEdit,
  });
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

  if (!text) return;
  // Unbound group: drop new messages silently (Phase 2 behavior). Edits
  // still flow through so an edit of a previously-recorded message can land
  // on its original team even after /unlink.
  if (!ctx.binding && !isEdit) return;

  await insertEvent(ctx.db, {
    fallbackTeamId: ctx.binding?.teamId ?? null,
    authorUserId: ctx.tgUserRow?.userId ?? null,
    text,
    message: ctx.message,
    updateId: ctx.updateId,
    sourceUnverified: !ctx.tgUserRow?.userId,
    isEdit,
  });
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
          `Commands (group):\n` +
          `/link <token>   bind this group to a team (admin only)\n` +
          `/whereami       show the bound team\n` +
          `/unlink         unbind (admin only)\n` +
          `/help           this message`,
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
  text: string;
  message: TgMessage;
  updateId: number;
  sourceUnverified: boolean;
  isEdit: boolean;
}

async function insertEvent(db: Db, input: InsertEventInput): Promise<void> {
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
  if (input.sourceUnverified) metadata.source_unverified = true;

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
      return;
    }
  }
  if (!teamId) return;

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
  await db
    .insert(rawEvents)
    .values({
      teamId,
      authorUserId: input.authorUserId,
      source: 'telegram',
      contentText: input.text,
      occurredAt: new Date(occurredAtSec * 1000),
      sourceMetadata: metadata,
    })
    .onConflictDoNothing();
}

async function findOriginalEvent(
  db: Db,
  chatId: number,
  messageId: number,
): Promise<{ id: string; teamId: string } | null> {
  const rows = await db
    .select({ id: rawEvents.id, teamId: rawEvents.teamId })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.source, 'telegram'),
        sql`(${rawEvents.sourceMetadata} ->> 'tg_chat_id')::bigint = ${chatId}`,
        sql`(${rawEvents.sourceMetadata} ->> 'tg_message_id')::bigint = ${messageId}`,
        // exclude rows that are themselves edits
        sql`(${rawEvents.sourceMetadata} ? 'edits_event_id') = false`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
