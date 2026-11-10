import {
  type Db,
  messageDeliveries,
  teamDigestDestinations,
  telegramChatBindings,
  telegramLinkTokens,
  telegramUsers,
  telegramUserTeams,
  users,
} from '@timeline/db';
import { and, desc, eq, gt, inArray, isNull, like } from 'drizzle-orm';

import { childLogger } from '#src/logger.js';
import {
  rewriteWorkspaceDigestDedupeKeyTarget,
  workspaceDigestDedupeKeyTargetLike,
} from '#src/messaging/destinations.js';

const log = childLogger('telegram');

type TeamRole = 'owner' | 'admin' | 'member';

export interface TelegramLinkTokenRow {
  id: string;
  scope: 'personal' | 'group';
  expiresAt: Date;
  issuedByUserId: string;
}

export interface TelegramChatBindingRow {
  id: string;
  title: string | null;
  tgChatId: number;
  createdAt: Date;
}

export interface TelegramLinkedUserRow {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  userId: string | null;
  isActive: boolean;
  appName: string | null;
  appEmail: string | null;
}

export interface CreateTelegramLinkTokenInput {
  scope: 'personal' | 'group';
  token: string;
  targetTgUsername: string;
  expiresAt: Date;
}

interface TelegramScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (minRole?: TeamRole) => Promise<TeamRole>;
}

function isAdminRole(role: TeamRole): boolean {
  return role === 'owner' || role === 'admin';
}

async function rewriteTelegramWorkspaceDigestLedgerKeys(
  tx: {
    select: Db['select'];
    update: Db['update'];
  },
  input: { teamId: string; fromTarget: string; toTarget: string },
): Promise<void> {
  const oldKeyPattern = workspaceDigestDedupeKeyTargetLike({
    teamId: input.teamId,
    kind: 'telegram_chat',
    targetId: input.fromTarget,
  });
  const ledgerRows = await tx
    .select({ id: messageDeliveries.id, dedupeKey: messageDeliveries.dedupeKey })
    .from(messageDeliveries)
    .where(
      and(
        eq(messageDeliveries.teamId, input.teamId),
        eq(messageDeliveries.intent, 'daily_digest'),
        eq(messageDeliveries.channel, 'telegram'),
        like(messageDeliveries.dedupeKey, oldKeyPattern),
      ),
    );
  for (const row of ledgerRows) {
    if (!row.dedupeKey) continue;
    const nextKey = rewriteWorkspaceDigestDedupeKeyTarget({
      dedupeKey: row.dedupeKey,
      teamId: input.teamId,
      kind: 'telegram_chat',
      fromTargetId: input.fromTarget,
      toTargetId: input.toTarget,
    });
    if (!nextKey || nextKey === row.dedupeKey) continue;
    const [keyConflict] = await tx
      .select({ id: messageDeliveries.id })
      .from(messageDeliveries)
      .where(eq(messageDeliveries.dedupeKey, nextKey))
      .limit(1);
    if (keyConflict) continue;
    await tx
      .update(messageDeliveries)
      .set({ dedupeKey: nextKey, updatedAt: new Date() })
      .where(and(eq(messageDeliveries.id, row.id), eq(messageDeliveries.teamId, input.teamId)));
  }
}

export function createTelegramScope({ db, teamId, userId, ensureMember }: TelegramScopeDeps) {
  return {
    async listActiveLinkTokens(): Promise<TelegramLinkTokenRow[]> {
      const role = await ensureMember();
      const now = new Date();
      const tokensWhere = isAdminRole(role)
        ? and(
            eq(telegramLinkTokens.teamId, teamId),
            isNull(telegramLinkTokens.consumedAt),
            gt(telegramLinkTokens.expiresAt, now),
          )
        : and(
            eq(telegramLinkTokens.teamId, teamId),
            eq(telegramLinkTokens.issuedByUserId, userId),
            isNull(telegramLinkTokens.consumedAt),
            gt(telegramLinkTokens.expiresAt, now),
          );
      return db
        .select({
          id: telegramLinkTokens.id,
          scope: telegramLinkTokens.scope,
          expiresAt: telegramLinkTokens.expiresAt,
          issuedByUserId: telegramLinkTokens.issuedByUserId,
        })
        .from(telegramLinkTokens)
        .where(tokensWhere)
        .orderBy(desc(telegramLinkTokens.createdAt));
    },

    async listChatBindings(): Promise<TelegramChatBindingRow[]> {
      await ensureMember();
      return db
        .select({
          id: telegramChatBindings.id,
          title: telegramChatBindings.title,
          tgChatId: telegramChatBindings.tgChatId,
          createdAt: telegramChatBindings.createdAt,
        })
        .from(telegramChatBindings)
        .where(eq(telegramChatBindings.teamId, teamId))
        .orderBy(desc(telegramChatBindings.createdAt));
    },

    async listLinkedUsers(): Promise<TelegramLinkedUserRow[]> {
      await ensureMember();
      const linked = await db
        .select({
          id: telegramUsers.id,
          username: telegramUsers.username,
          firstName: telegramUsers.firstName,
          lastName: telegramUsers.lastName,
          userId: telegramUsers.userId,
          isActive: telegramUserTeams.isActive,
        })
        .from(telegramUserTeams)
        .innerJoin(telegramUsers, eq(telegramUserTeams.telegramUserId, telegramUsers.id))
        .where(eq(telegramUserTeams.teamId, teamId));
      const userIds = linked.map((row) => row.userId).filter((id): id is string => Boolean(id));
      const userRows =
        userIds.length > 0
          ? await db
              .select({ id: users.id, name: users.name, email: users.email })
              .from(users)
              .where(inArray(users.id, userIds))
          : [];
      const userMap = new Map(userRows.map((row) => [row.id, row] as const));
      return linked.map((row) => {
        const appUser = row.userId ? userMap.get(row.userId) : undefined;
        return {
          id: row.id,
          username: row.username,
          firstName: row.firstName,
          lastName: row.lastName,
          userId: row.userId,
          isActive: row.isActive,
          appName: appUser?.name ?? null,
          appEmail: appUser?.email ?? null,
        };
      });
    },

    async createLinkToken(input: CreateTelegramLinkTokenInput): Promise<void> {
      await ensureMember(input.scope === 'group' ? 'admin' : 'member');
      await db.insert(telegramLinkTokens).values({
        token: input.token,
        teamId,
        scope: input.scope,
        issuedByUserId: userId,
        targetTgUsername: input.targetTgUsername,
        expiresAt: input.expiresAt,
      });
    },

    async revokeLinkToken(id: string): Promise<void> {
      await ensureMember('admin');
      await db
        .delete(telegramLinkTokens)
        .where(and(eq(telegramLinkTokens.id, id), eq(telegramLinkTokens.teamId, teamId)));
    },

    async unbindChat(id: string): Promise<void> {
      await ensureMember('admin');
      await db
        .delete(telegramChatBindings)
        .where(and(eq(telegramChatBindings.id, id), eq(telegramChatBindings.teamId, teamId)));
    },

    /**
     * Rewrite this team's stored Telegram chat id after a group→supergroup
     * upgrade. Bindings, digest destinations, and workspace digest ledger
     * keys are the live send/route/dedupe identity.
     */
    async migrateChatId(input: { fromChatId: number; toChatId: number }): Promise<void> {
      await ensureMember();
      const { fromChatId, toChatId } = input;
      if (fromChatId === toChatId) return;
      const fromTarget = String(fromChatId);
      const toTarget = String(toChatId);

      await db.transaction(async (tx) => {
        const [oldBinding] = await tx
          .select({ id: telegramChatBindings.id })
          .from(telegramChatBindings)
          .where(
            and(
              eq(telegramChatBindings.teamId, teamId),
              eq(telegramChatBindings.tgChatId, fromChatId),
            ),
          )
          .limit(1);
        const [newBinding] = await tx
          .select({ id: telegramChatBindings.id })
          .from(telegramChatBindings)
          .where(
            and(
              eq(telegramChatBindings.teamId, teamId),
              eq(telegramChatBindings.tgChatId, toChatId),
            ),
          )
          .limit(1);

        if (oldBinding && newBinding) {
          await tx
            .delete(telegramChatBindings)
            .where(
              and(
                eq(telegramChatBindings.id, oldBinding.id),
                eq(telegramChatBindings.teamId, teamId),
              ),
            );
        } else if (oldBinding) {
          await tx
            .update(telegramChatBindings)
            .set({ tgChatId: toChatId })
            .where(
              and(
                eq(telegramChatBindings.id, oldBinding.id),
                eq(telegramChatBindings.teamId, teamId),
              ),
            );
        }

        const destinations = await tx
          .select({ id: teamDigestDestinations.id })
          .from(teamDigestDestinations)
          .where(
            and(
              eq(teamDigestDestinations.teamId, teamId),
              eq(teamDigestDestinations.kind, 'telegram_chat'),
              eq(teamDigestDestinations.targetId, fromTarget),
            ),
          );

        for (const destination of destinations) {
          const [conflict] = await tx
            .select({ id: teamDigestDestinations.id })
            .from(teamDigestDestinations)
            .where(
              and(
                eq(teamDigestDestinations.teamId, teamId),
                eq(teamDigestDestinations.kind, 'telegram_chat'),
                eq(teamDigestDestinations.targetId, toTarget),
              ),
            )
            .limit(1);
          if (conflict) {
            await tx
              .delete(teamDigestDestinations)
              .where(
                and(
                  eq(teamDigestDestinations.id, destination.id),
                  eq(teamDigestDestinations.teamId, teamId),
                ),
              );
            continue;
          }
          await tx
            .update(teamDigestDestinations)
            .set({ targetId: toTarget, updatedAt: new Date() })
            .where(
              and(
                eq(teamDigestDestinations.id, destination.id),
                eq(teamDigestDestinations.teamId, teamId),
              ),
            );
        }

        await rewriteTelegramWorkspaceDigestLedgerKeys(tx, {
          teamId,
          fromTarget,
          toTarget,
        });
      });

      log.info({ teamId, fromChatId, toChatId }, 'telegram chat migrated');
    },
  };
}
