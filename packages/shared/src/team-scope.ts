import { type Db, rawEvents, teamMembers, teams, teamRole } from '@timeline/db';
import { and, asc, desc, eq, gte, lt, or, sql } from 'drizzle-orm';

// Note: `teamRole` value is referenced at runtime by drizzle elsewhere; keeping
// the value import lets us derive the union type from the enum definition.
const _roleValues = teamRole.enumValues;
export type TeamRole = (typeof _roleValues)[number];

const ROLE_RANK: Record<TeamRole, number> = { member: 0, admin: 1, owner: 2 };

export interface EventListFilters {
  authorUserId?: string;
  /** Inclusive lower bound on `occurred_at`. */
  from?: Date;
  /** Exclusive upper bound on `occurred_at`. Callers wanting "include all of
   *  day X" should pass midnight UTC of day X+1. */
  to?: Date;
  limit?: number;
}

export interface CreateEventInput {
  authorUserId: string | null;
  source: 'web' | 'telegram' | 'email' | 'system';
  contentText?: string | null;
  contentAudioUrl?: string | null;
  occurredAt?: Date;
  visibility?: 'private' | 'team' | 'specific_users';
  visibilityUserIds?: string[] | null;
  sourceMetadata?: Record<string, unknown>;
}

/**
 * Construct a query helper bound to a single (team, user) pair.
 *
 * Every query the helper runs is automatically scoped to `teamId`. Callers
 * cannot override the team_id after construction — this is the single
 * chokepoint that enforces team isolation. Row-level visibility for
 * `raw_events` is applied here too, so it cannot be forgotten by callers.
 *
 * Membership is verified on first query (cached) so isolation is enforced,
 * not advised. Callers may still invoke `requireMembership(role)` explicitly
 * to require a higher role than `member` (e.g. for admin-only operations).
 */
export function withTeam(db: Db, teamId: string, userId: string) {
  const visibilityFilter = or(
    eq(rawEvents.visibility, 'team'),
    and(eq(rawEvents.visibility, 'private'), eq(rawEvents.authorUserId, userId)),
    and(
      eq(rawEvents.visibility, 'specific_users'),
      sql`${userId}::uuid = ANY(${rawEvents.visibilityUserIds})`,
    ),
  );

  let membershipPromise: Promise<TeamRole> | undefined;

  function ensureMember(minRole: TeamRole = 'member'): Promise<TeamRole> {
    membershipPromise ??= (async () => {
      const rows = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error('Not a member of this team');
      return row.role;
    })();
    return membershipPromise.then((role) => {
      if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
        throw new Error(`Requires ${minRole} role`);
      }
      return role;
    });
  }

  return {
    teamId,
    userId,

    requireMembership: ensureMember,

    async team() {
      await ensureMember();
      const rows = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
      return rows[0] ?? null;
    },

    async listEvents(filters: EventListFilters = {}) {
      await ensureMember();
      const conditions = [eq(rawEvents.teamId, teamId), visibilityFilter];
      if (filters.authorUserId) {
        conditions.push(eq(rawEvents.authorUserId, filters.authorUserId));
      }
      if (filters.from) conditions.push(gte(rawEvents.occurredAt, filters.from));
      if (filters.to) conditions.push(lt(rawEvents.occurredAt, filters.to));
      return db
        .select()
        .from(rawEvents)
        .where(and(...conditions))
        .orderBy(desc(rawEvents.occurredAt))
        .limit(filters.limit ?? 200);
    },

    async getEvent(id: string) {
      await ensureMember();
      const rows = await db
        .select()
        .from(rawEvents)
        .where(and(eq(rawEvents.id, id), eq(rawEvents.teamId, teamId), visibilityFilter))
        .limit(1);
      return rows[0] ?? null;
    },

    async createEvent(input: CreateEventInput) {
      await ensureMember();
      const rows = await db
        .insert(rawEvents)
        .values({
          teamId,
          authorUserId: input.authorUserId,
          source: input.source,
          contentText: input.contentText ?? null,
          contentAudioUrl: input.contentAudioUrl ?? null,
          occurredAt: input.occurredAt ?? new Date(),
          visibility: input.visibility ?? 'team',
          visibilityUserIds: input.visibilityUserIds ?? null,
          sourceMetadata: input.sourceMetadata ?? {},
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Failed to create event');
      return row;
    },

    async listMembers() {
      await ensureMember();
      return db
        .select({
          userId: teamMembers.userId,
          role: teamMembers.role,
          createdAt: teamMembers.createdAt,
        })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId))
        .orderBy(asc(teamMembers.createdAt));
    },
  };
}

export type TeamScope = ReturnType<typeof withTeam>;
