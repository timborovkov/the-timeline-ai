'use client';

import { useRouter } from 'next/navigation';
import { useReducer, useTransition } from 'react';

import { createObjectAction } from '@/app/actions/objects';
import { DueDateDisplay } from '@/components/due-date-display';
import { ProjectPicker } from '@/components/tasks/project-picker';
import { isSchedulableObjectType } from '@/lib/due-dates';
import { OBJECT_TYPES as TYPES } from '@/lib/object-types';

const EMPTY_PROJECTS: { id: string; label: string }[] = [];

interface FormState {
  error: string | null;
  type: (typeof TYPES)[number];
  name: string;
  dueAt: string;
  projectId: string;
  projectLabel: string;
}

export function NewObjectForm({
  projects = EMPTY_PROJECTS,
  defaultProjectId = '',
  returnTo,
}: {
  projects?: { id: string; label: string }[];
  defaultProjectId?: string;
  returnTo?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, updateForm] = useReducer(
    (state: FormState, patch: Partial<FormState>) => ({ ...state, ...patch }),
    {
      error: null,
      type: 'task',
      name: '',
      dueAt: '',
      projectId: defaultProjectId,
      projectLabel: projects.find((project) => project.id === defaultProjectId)?.label ?? '',
    },
  );
  const { error, type, name, dueAt, projectId, projectLabel } = form;
  function submit(): void {
    if (!name.trim()) {
      updateForm({ error: 'Name required' });
      return;
    }
    updateForm({ error: null });
    startTransition(async () => {
      const result = await createObjectAction({
        type,
        canonicalName: name.trim(),
        ...(isSchedulableObjectType(type) && dueAt
          ? { dueAt: new Date(`${dueAt}T00:00:00.000Z`).toISOString() }
          : {}),
        ...(type === 'task' && projectId ? { parentObjectId: projectId } : {}),
      });
      if ('error' in result && result.error) {
        updateForm({ error: result.error });
        return;
      }
      if ('id' in result && result.id) router.push(returnTo ?? `/app/objects/${result.id}`);
    });
  }

  return (
    <div className="max-w-xl space-y-5">
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
          Type
        </span>
        <select
          aria-label="Object type"
          value={type}
          onChange={(e) => {
            updateForm({ type: e.target.value as (typeof TYPES)[number] });
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {type === 'task' ? (
        <div>
          <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
            Project (optional)
          </span>
          <ProjectPicker
            value={projectId || null}
            selectedLabel={projectLabel}
            projects={projects}
            onValueChange={(project) => {
              updateForm({
                projectId: project?.id ?? '',
                projectLabel: project?.label ?? '',
              });
            }}
          />
        </div>
      ) : null}
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
          Name
        </span>
        <input
          value={name}
          onChange={(e) => {
            updateForm({ name: e.target.value });
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="e.g. Acme deal, Q2 OKRs, post-mortem 2026-05-15"
        />
      </label>
      {isSchedulableObjectType(type) ? (
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
            Due (optional)
          </span>
          <input
            aria-label="Due date"
            type="date"
            value={dueAt}
            onChange={(e) => {
              updateForm({ dueAt: e.target.value });
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <DueDateDisplay value={dueAt || null} variant="field-hint" className="mt-1 block" />
        </label>
      ) : null}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending || !name.trim()}
        className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create object'}
      </button>
    </div>
  );
}
