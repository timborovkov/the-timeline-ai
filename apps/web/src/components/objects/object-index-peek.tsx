'use client';

import { useRouter } from 'next/navigation';

import type { ObjectDetail, TaskPrimaryProjectRow } from '@timeline/shared/objects/types';

import { updateObjectAction } from '@/app/actions/objects';
import { ChatViewContextBinder } from '@/components/chat/chat-view-context';
import { ObjectPeekPanel } from '@/components/objects/object-peek-panel';
import { notifyAction } from '@/lib/notify';
import { objectDetailHref } from '@/lib/object-links';
import { statusOptionsForType } from '@/lib/object-status-options';
import { TASK_STATUS_COLUMNS } from '@/lib/task-statuses';

export function ObjectIndexPeek({
  detail,
  pinned,
  userId,
  members,
  projects,
  primaryProject,
  closeHref,
  returnTo,
  taskCategoriesEnabled,
}: {
  detail: ObjectDetail;
  pinned: boolean;
  userId: string;
  members: { id: string; label: string }[];
  projects: { id: string; label: string }[];
  primaryProject: TaskPrimaryProjectRow | null;
  closeHref: string;
  returnTo: string;
  taskCategoriesEnabled: boolean;
}) {
  const router = useRouter();
  const refresh = () => {
    router.refresh();
  };
  return (
    <>
      <ChatViewContextBinder
        viewKey={`object:${detail.id}`}
        kind="object"
        href={returnTo}
        label={detail.canonicalName}
        objectId={detail.id}
      />
      <ObjectPeekPanel
        task={detail}
        connectedWork={detail.connectedWork}
        provenance={detail.provenance}
        notes={detail.notes}
        recentChanges={detail.recentChanges}
        initialPinned={pinned}
        currentUserId={userId}
        columns={
          detail.type === 'task'
            ? [...TASK_STATUS_COLUMNS]
            : statusOptionsForType(detail.type, detail.status)
        }
        members={members}
        projects={projects}
        taskCategoriesEnabled={taskCategoriesEnabled}
        primaryProject={primaryProject}
        closeHref={closeHref}
        objectHref={objectDetailHref(detail.id, returnTo)}
        onUpdate={async (id, patch) => {
          const result = await notifyAction({
            id: `object:${id}:update`,
            loading: 'Saving object…',
            success: 'Object updated',
            error: 'Couldn’t update object',
            run: () =>
              updateObjectAction({
                ...patch,
                id,
                ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt?.toISOString() ?? null } : {}),
              }),
          });
          if (!result.error) refresh();
          return result;
        }}
        onProjectChange={refresh}
        onProjectChangeCommitted={refresh}
        onProjectChangeReverted={refresh}
      />
    </>
  );
}
