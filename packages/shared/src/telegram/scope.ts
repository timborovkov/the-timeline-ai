import {
  type Db,
  teamDigestDestinations,
  telegramChatBindings,
  telegramLinkTokens,
  telegramUsers,
  telegramUserTeams,
  users,
} from '@timeline/db';
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';

import { childLogger } from '#src/logger.js';

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
     * upgrade. Bindings and digest destinations are the live send/route keys.
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
      });

      log.info({ teamId, fromChatId, toChatId }, 'telegram chat migrated');
    },
  };
}
