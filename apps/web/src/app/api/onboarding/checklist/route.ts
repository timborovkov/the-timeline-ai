import {
  integrations,
  documents,
  mcpServers,
  rawEvents,
  teamOnboardingState,
  telegramChatBindings,
  telegramUserTeams,
  userOnboardingState,
} from '@timeline/db';
import { cacheKey, cachedJson, deleteCacheKey, withTeam } from '@timeline/shared';
import { and, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ITEMS = [
  { key: 'capture', label: 'Capture one timeline event' },
  { key: 'telegram', label: 'Link Telegram' },
  { key: 'documents', label: 'Upload a document' },
  { key: 'integrations', label: 'Connect an integration or MCP server' },
] as const;

const patchSchema = z.object({
  action: z.enum(['dismiss', 'reopen', 'complete']),
  key: z.string().optional(),
});

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const key = cacheKey(['onboarding', active.teamId, session.user.id]);
  const state = await cachedJson(key, 30, async () => {
    const [
      teamRows,
      userRows,
      eventRows,
      tgUserRows,
      tgChatRows,
      documentRows,
      integrationRows,
      mcpRows,
    ] = await Promise.all([
      db
        .select({ completedKeys: teamOnboardingState.completedKeys })
        .from(teamOnboardingState)
        .where(eq(teamOnboardingState.teamId, active.teamId))
        .limit(1),
      db
        .select({ dismissedAt: userOnboardingState.dismissedAt })
        .from(userOnboardingState)
        .where(
          and(
            eq(userOnboardingState.teamId, active.teamId),
            eq(userOnboardingState.userId, session.user.id),
          ),
        )
        .limit(1),
      db.select({ total: count() }).from(rawEvents).where(eq(rawEvents.teamId, active.teamId)),
      db
        .select({ total: count() })
        .from(telegramUserTeams)
        .where(eq(telegramUserTeams.teamId, active.teamId)),
      db
        .select({ total: count() })
        .from(telegramChatBindings)
        .where(eq(telegramChatBindings.teamId, active.teamId)),
      db.select({ total: count() }).from(documents).where(eq(documents.teamId, active.teamId)),
      db
        .select({ total: count() })
        .from(integrations)
        .where(eq(integrations.teamId, active.teamId)),
      db.select({ total: count() }).from(mcpServers).where(eq(mcpServers.teamId, active.teamId)),
    ]);
    const firstTeamRow = teamRows[0];
    const manual = new Set(
      firstTeamRow && Array.isArray(firstTeamRow.completedKeys)
        ? (firstTeamRow.completedKeys as string[])
        : [],
    );
    const live = new Set<string>();
    if ((eventRows[0]?.total ?? 0) > 0) live.add('capture');
    if ((tgUserRows[0]?.total ?? 0) + (tgChatRows[0]?.total ?? 0) > 0) live.add('telegram');
    if ((documentRows[0]?.total ?? 0) > 0) live.add('documents');
    if ((integrationRows[0]?.total ?? 0) + (mcpRows[0]?.total ?? 0) > 0) live.add('integrations');
    return {
      dismissed: Boolean(userRows[0]?.dismissedAt),
      items: ITEMS.map((item) => ({
        ...item,
        completed: manual.has(item.key) || live.has(item.key),
      })),
    };
  });

  return Response.json(state);
}

export async function PATCH(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });

  if (parsed.data.action === 'dismiss' || parsed.data.action === 'reopen') {
    await db
      .insert(userOnboardingState)
      .values({
        teamId: active.teamId,
        userId: session.user.id,
        dismissedAt: parsed.data.action === 'dismiss' ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [userOnboardingState.teamId, userOnboardingState.userId],
        set: {
          dismissedAt: parsed.data.action === 'dismiss' ? new Date() : null,
          updatedAt: new Date(),
        },
      });
  }
  if (parsed.data.action === 'complete' && parsed.data.key) {
    await db
      .insert(teamOnboardingState)
      .values({ teamId: active.teamId, completedKeys: [parsed.data.key] })
      .onConflictDoUpdate({
        target: teamOnboardingState.teamId,
        set: {
          completedKeys: sql`(
            SELECT jsonb_agg(DISTINCT x.value)
            FROM jsonb_array_elements_text(${teamOnboardingState.completedKeys} || ${JSON.stringify([parsed.data.key])}::jsonb) AS x(value)
          )`,
          updatedAt: new Date(),
        },
      });
  }
  await deleteCacheKey(cacheKey(['onboarding', active.teamId, session.user.id]));
  return GET();
}
