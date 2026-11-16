import { type Db, telegramLinkTokens, teamMembers } from '@timeline/db';
import { and, eq, isNull } from 'drizzle-orm';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type LinkToken = typeof telegramLinkTokens.$inferSelect;

/** Verification, binding and consumption share a row-locked transaction so a
 * failed binding never spends a token and concurrent consumers cannot reuse it. */
export function consumeVerifiedTelegramLink<T>(
  input: {
    db: Db;
    token: string;
    scope: 'personal' | 'group';
    username?: string | undefined;
    tgUserId: number;
    chatId?: number;
  },
  bind: (tx: DbTx, token: LinkToken) => Promise<T>,
): Promise<T> {
  return input.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(telegramLinkTokens)
      .where(eq(telegramLinkTokens.token, input.token))
      .limit(1)
      .for('update');
    if (!row) throw new Error('not_found');
    if (row.consumedAt) throw new Error('consumed');
    if (row.expiresAt < new Date()) throw new Error('expired');
    if (row.scope !== input.scope)
      throw new Error(input.scope === 'personal' ? 'wrong_scope_personal' : 'wrong_scope_group');
    if (!row.targetTgUsername) throw new Error('legacy_no_username');
    if ((input.username?.toLowerCase() ?? '') !== row.targetTgUsername)
      throw new Error('wrong_user');
    const [issuer] = await tx
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
    if (!issuer || (input.scope === 'group' && issuer.role !== 'owner' && issuer.role !== 'admin'))
      throw new Error('issuer_revoked');
    const result = await bind(tx, row);
    await tx
      .update(telegramLinkTokens)
      .set({
        consumedAt: new Date(),
        consumedByTgUserId: input.tgUserId,
        ...(input.chatId !== undefined ? { consumedChatId: input.chatId } : {}),
      })
      .where(eq(telegramLinkTokens.id, row.id));
    return result;
  });
}
