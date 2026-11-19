'use server';

import { users } from '@timeline/db';
import { displayObjectTitle } from '@timeline/shared/objects';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { handoffBodySchema, resolveHandoffSources } from '@/lib/handoff-snapshot';
import { TASK_OPEN_STATUSES_EXCLUDED } from '@/lib/task-board-config';

export async function saveProjectHandoff(sessionId: string, messageId: string) {
  const unavailable = {
    ok: false,
    error:
      'Start a fresh Ask session pinned to the project and ask it to cite evidence from List events.',
  };
  if (!z.uuid().safeParse(sessionId).success || !z.uuid().safeParse(messageId).success)
    return unavailable;
  const session = await auth();
  if (!session?.user) return unavailable;
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return unavailable;
  const scope = withTeam(db, active.teamId, session.user.id);
  const chat = await scope.objects.getChatSession(sessionId);
  const projectId = chat?.session.pinnedEntityId;
  if (!projectId || !chat) return unavailable;
  const turn = chat.messages.find((row) => {
    const content = row.content as { ui_message?: { id?: string } } | null;
    return row.role === 'assistant' && content?.ui_message?.id === messageId;
  });
  if (!turn) return unavailable;
  const content = turn.content as {
    text?: unknown;
    handoff_provenance?: unknown;
    interrupted?: boolean;
  };
  if (content.interrupted) return unavailable;
  const [project, tasks, members] = await Promise.all([
    scope.objects.getObject(projectId),
    scope.objects.listObjects({
      type: 'task',
      primaryProjectId: projectId,
      archived: false,
      statusNotCaseInsensitive: [...TASK_OPEN_STATUSES_EXCLUDED],
      limit: 100,
    }),
    scope.timeline.listMembers(),
  ]);
  if (project?.type !== 'project') return unavailable;
  const activeMembers = new Set(members.map((member) => member.userId));
  const ownerIds = [
    ...new Set(
      tasks.flatMap((task) => {
        const owner = task.assigneeUserId ?? task.ownerUserId;
        return owner && activeMembers.has(owner) ? [owner] : [];
      }),
    ),
  ];
  const ownerRows = ownerIds.length
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, ownerIds))
    : [];
  const ownerNames = new Map(ownerRows.map((row) => [row.id, row.name]));
  const body = handoffBodySchema.safeParse({
    project: displayObjectTitle(project),
    answer: content.text,
    sources: content.handoff_provenance,
    commitments: tasks.map((task) => ({
      id: task.id,
      title: displayObjectTitle(task),
      owner: ownerNames.get(task.assigneeUserId ?? task.ownerUserId ?? '') ?? null,
    })),
  });
  if (!body.success || !(await resolveHandoffSources(scope, body.data.sources))) return unavailable;
  const id = await scope.handoffs.create(projectId, turn.id, body.data);
  if (!id) return unavailable;
  return { ok: true, id };
}
