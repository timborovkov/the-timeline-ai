import { type Db, notifications, objectNoteMentions, teamMembers, users } from '@timeline/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { ActorKind } from '#src/objects/identity-facets.js';

import { actorDisplayName, parseMentions, type MentionMember } from '#src/objects/mentions.js';

const MENTION_EXCERPT_LENGTH = 180;

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

async function loadMentionMembers(db: DbOrTx, teamId: string): Promise<MentionMember[]> {
  const rows = await db
    .select({
      userId: teamMembers.userId,
      name: users.name,
      email: users.email,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), isNull(teamMembers.removedAt)));
  return rows.map((row) => ({
    userId: row.userId,
    name: row.name ?? '',
    email: row.email,
  }));
}

function mentionExcerpt(body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  if (compact.length <= MENTION_EXCERPT_LENGTH) return compact;
  return `${compact.slice(0, MENTION_EXCERPT_LENGTH - 1)}…`;
}

export async function persistObjectNoteMentions(
  db: DbOrTx,
  input: {
    teamId: string;
    noteId: string;
    entityId: string;
    objectName: string;
    body: string;
    authorUserId: string | null;
    actorKind: ActorKind;
    previousMentionedUserIds?: Iterable<string>;
  },
): Promise<{ pingAgent: boolean; actorName: string }> {
  const members = await loadMentionMembers(db, input.teamId);
  const parsed = parseMentions(input.body, members);
  const previousUsers = new Set(input.previousMentionedUserIds ?? []);

  await db
    .delete(objectNoteMentions)
    .where(
      and(eq(objectNoteMentions.teamId, input.teamId), eq(objectNoteMentions.noteId, input.noteId)),
    );

  const actorName = actorDisplayName(input.authorUserId, members);
  if (parsed.length === 0) return { pingAgent: false, actorName };

  await db.insert(objectNoteMentions).values(
    parsed.map((mention) => ({
      teamId: input.teamId,
      noteId: input.noteId,
      entityId: input.entityId,
      mentionedUserId: mention.kind === 'user' ? mention.userId : null,
      kind: mention.kind,
      startOffset: mention.startOffset,
      endOffset: mention.endOffset,
    })),
  );

  const excerpt = mentionExcerpt(input.body);
  const notifyUserIds = parsed.flatMap((mention) => {
    if (mention.kind !== 'user') return [];
    if (mention.userId === input.authorUserId) return [];
    if (previousUsers.has(mention.userId)) return [];
    return [mention.userId];
  });
  if (notifyUserIds.length > 0) {
    await db.insert(notifications).values(
      notifyUserIds.map((userId) => ({
        teamId: input.teamId,
        userId,
        kind: 'mention' as const,
        entityId: input.entityId,
        summary: `${actorName} mentioned you on ${input.objectName}`,
        payload: {
          note_id: input.noteId,
          excerpt,
          actor_user_id: input.authorUserId,
          actor_name: actorName,
        },
      })),
    );
  }

  const pingAgent =
    parsed.some((mention) => mention.kind === 'agent') &&
    input.actorKind !== 'agent' &&
    input.authorUserId !== null;
  return { pingAgent, actorName };
}

export async function pingObjectDiscussionAgent(input: {
  db: Db;
  teamId: string;
  userId: string;
  userName: string;
  entityId: string;
  objectName: string;
  objectType: string;
  noteId: string;
  body: string;
}): Promise<void> {
  const [{ acceptDirectAgentTurn }, { createObjectDiscussionDeliveryAdapter }] = await Promise.all([
    import('#src/conversation-surfaces/runtime.js'),
    import('#src/conversation-surfaces/object-discussion.js'),
  ]);
  const { withTeam } = await import('#src/team-scope.js');
  const adapter = createObjectDiscussionDeliveryAdapter({
    postComment: async (text) => {
      await withTeam(input.db, input.teamId, input.userId).objects.createNote({
        entityId: input.entityId,
        body: text,
        authorUserId: null,
        actor: { kind: 'agent', userId: null },
        metadata: { discussion_reply_to: input.noteId },
      });
    },
  });
  await acceptDirectAgentTurn(
    input.db,
    {
      surface: 'object_discussion',
      externalConversationKey: `object:${input.entityId}`,
      externalUserKey: input.userId,
      teamId: input.teamId,
      userId: input.userId,
      userName: input.userName,
      externalEventId: input.noteId,
      externalMessageId: input.noteId,
      question: [
        `On the object "${input.objectName}" (${input.objectType}), ${input.userName} wrote:`,
        '',
        input.body,
        '',
        'Reply in this object discussion. Your reply will be posted as a comment.',
      ].join('\n'),
    },
    adapter,
    { providerAcknowledgement: 'background' },
  );
}
