'use client';

import { useRouter } from 'next/navigation';
import { useRef, useTransition } from 'react';

import { setTaskProjectAction } from '@/app/actions/objects';
import { ProjectPicker } from '@/components/tasks/project-picker';
import { notifyAction } from '@/lib/notify';

export function TaskProjectSelect({
  taskId,
  projectId,
  currentProjectLabel,
  projectArchived = false,
  projects,
  onProjectChange,
  onProjectChangeCommitted,
  onProjectChangeReverted,
  quiet = false,
}: {
  taskId: string;
  projectId: string | null;
  currentProjectLabel?: string | undefined;
  projectArchived?: boolean;
  projects: { id: string; label: string }[];
  onProjectChange?: (project: { id: string; label: string } | null) => void;
  onProjectChangeCommitted?: () => void;
  onProjectChangeReverted?: () => void;
  quiet?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const selectorRef = useRef<HTMLButtonElement>(null);
  const restoreSelectorFocus = () => {
    const selector = selectorRef.current;
    if (!selector) return;

    const observer = new MutationObserver(() => {
      if (selector.disabled) return;
      observer.disconnect();
      selector.focus();
    });
    observer.observe(selector, { attributes: true, attributeFilter: ['disabled'] });
    if (!selector.disabled) {
      observer.disconnect();
      selector.focus();
    }
  };
  return (
    <div>
      <ProjectPicker
        value={projectId}
        selectedLabel={currentProjectLabel}
        selectedArchived={projectArchived}
        projects={projects}
        disabled={pending}
        triggerRef={selectorRef}
        className={
          quiet
            ? 'h-8 border-0 bg-transparent px-1.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg'
            : undefined
        }
        onValueChange={(nextProject) => {
          const nextProjectId = nextProject?.id ?? null;
          onProjectChange?.(nextProject);
          startTransition(async () => {
            const result = await notifyAction({
              id: `object:${taskId}`,
              loading: 'Updating project…',
              success: 'Project updated',
              error: 'Couldn’t update project',
              run: () => setTaskProjectAction({ id: taskId, projectId: nextProjectId }),
              undo: {
                run: async () => {
                  onProjectChangeReverted?.();
                  const undoResult = await setTaskProjectAction({
                    id: taskId,
                    projectId,
                  });
                  if (!undoResult.error) router.refresh();
                  return undoResult;
                },
              },
            });
            if (result.error) {
              onProjectChangeReverted?.();
              restoreSelectorFocus();
            } else {
              onProjectChangeCommitted?.();
              router.refresh();
            }
          });
        }}
      />
    </div>
  );
}
