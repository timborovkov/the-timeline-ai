'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { setTaskProjectAction } from '@/app/actions/objects';
import { useProjectSearch } from '@/hooks/use-project-search';
import { errorMessage } from '@/lib/utils';

export function TaskProjectSelect({
  taskId,
  projectId,
  currentProjectLabel,
  projects,
  onProjectChange,
}: {
  taskId: string;
  projectId: string | null;
  currentProjectLabel?: string | undefined;
  projects: { id: string; label: string }[];
  onProjectChange?: (project: { id: string; label: string } | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { query, setQuery, projects: remoteProjects } = useProjectSearch();
  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const candidates = normalized
      ? [
          ...projects.filter(
            (project) =>
              project.id === projectId || project.label.toLowerCase().includes(normalized),
          ),
          ...remoteProjects,
        ]
      : projects;
    return [...new Map(candidates.map((project) => [project.id, project])).values()];
  }, [projectId, projects, query, remoteProjects]);
  return (
    <div className="space-y-2">
      <input
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
        }}
        placeholder="Search projects…"
        aria-label="Search task projects"
        className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs text-fg"
      />
      <select
        aria-label="Task project"
        value={projectId ?? ''}
        disabled={pending}
        onChange={(event) => {
          const nextProjectId = event.currentTarget.value || null;
          const previousProject = projectId
            ? { id: projectId, label: currentProjectLabel ?? projectId }
            : null;
          const nextProject = nextProjectId
            ? (visibleProjects.find((project) => project.id === nextProjectId) ?? {
                id: nextProjectId,
                label: nextProjectId,
              })
            : null;
          setError(null);
          onProjectChange?.(nextProject);
          startTransition(() => {
            void setTaskProjectAction({ id: taskId, projectId: nextProjectId })
              .then((result) => {
                if (result.error) {
                  onProjectChange?.(previousProject);
                  setError(result.error);
                } else {
                  router.refresh();
                }
              })
              .catch((cause: unknown) => {
                onProjectChange?.(previousProject);
                setError(errorMessage(cause, 'Project update failed'));
              });
          });
        }}
        className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm text-fg disabled:cursor-progress disabled:opacity-60"
      >
        <option value="">No project</option>
        {projectId && !projects.some((project) => project.id === projectId) ? (
          <option value={projectId}>{currentProjectLabel ?? projectId} · Archived</option>
        ) : null}
        {visibleProjects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.label}
          </option>
        ))}
      </select>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
