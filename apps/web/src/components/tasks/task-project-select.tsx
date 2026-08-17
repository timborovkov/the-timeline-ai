'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';

import { setTaskProjectAction } from '@/app/actions/objects';
import { ProjectPicker } from '@/components/tasks/project-picker';
import { errorMessage } from '@/lib/utils';

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
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
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
        ariaDescribedBy={error ? errorId : undefined}
        triggerRef={selectorRef}
        className={
          quiet
            ? 'h-8 border-0 bg-transparent px-1.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg'
            : undefined
        }
        onValueChange={(nextProject) => {
          const nextProjectId = nextProject?.id ?? null;
          setError(null);
          onProjectChange?.(nextProject);
          startTransition(async () => {
            try {
              const result = await setTaskProjectAction({ id: taskId, projectId: nextProjectId });
              if (result.error) {
                onProjectChangeReverted?.();
                setError(result.error);
                restoreSelectorFocus();
              } else {
                onProjectChangeCommitted?.();
                router.refresh();
              }
            } catch (cause) {
              onProjectChangeReverted?.();
              setError(errorMessage(cause, 'Project update failed'));
              restoreSelectorFocus();
            }
          });
        }}
      />
      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
