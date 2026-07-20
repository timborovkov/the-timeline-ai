'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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
}: {
  taskId: string;
  projectId: string | null;
  currentProjectLabel?: string | undefined;
  projectArchived?: boolean;
  projects: { id: string; label: string }[];
  onProjectChange?: (project: { id: string; label: string } | null) => void;
  onProjectChangeCommitted?: () => void;
  onProjectChangeReverted?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <ProjectPicker
        value={projectId}
        selectedLabel={currentProjectLabel}
        selectedArchived={projectArchived}
        projects={projects}
        disabled={pending}
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
              } else {
                onProjectChangeCommitted?.();
                router.refresh();
              }
            } catch (cause) {
              onProjectChangeReverted?.();
              setError(errorMessage(cause, 'Project update failed'));
            }
          });
        }}
      />
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
