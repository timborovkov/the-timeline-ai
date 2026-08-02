'use client';

import { LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useReducer, useRef, useTransition, type SyntheticEvent } from 'react';

import { createObjectAction } from '@/app/actions/objects';
import { DueDateDisplay } from '@/components/due-date-display';
import { ProjectPicker } from '@/components/tasks/project-picker';
import { isSchedulableObjectType } from '@/lib/due-dates';
import { OBJECT_TYPES as TYPES } from '@/lib/object-types';

const EMPTY_PROJECTS: { id: string; label: string }[] = [];

interface FormState {
  error: string | null;
  nameError: string | null;
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
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [form, updateForm] = useReducer(
    (state: FormState, patch: Partial<FormState>) => ({ ...state, ...patch }),
    {
      error: null,
      nameError: null,
      type: 'task',
      name: '',
      dueAt: '',
      projectId: defaultProjectId,
      projectLabel: projects.find((project) => project.id === defaultProjectId)?.label ?? '',
    },
  );
  const { error, nameError, type, name, dueAt, projectId, projectLabel } = form;

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const canonicalName = name.trim();
    if (!canonicalName) {
      updateForm({ error: null, nameError: 'Enter an object name.' });
      nameInputRef.current?.focus();
      return;
    }
    updateForm({ error: null, nameError: null });
    startTransition(async () => {
      const result = await createObjectAction({
        type,
        canonicalName,
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
    <form className="max-w-xl space-y-5" noValidate onSubmit={submit} aria-busy={pending}>
      <label className="block" htmlFor="object-type">
        <span className="mb-1 block text-xs text-fg-muted">Object type</span>
        <select
          id="object-type"
          name="type"
          value={type}
          onChange={(e) => {
            updateForm({ type: e.target.value as (typeof TYPES)[number] });
          }}
          className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
          <span className="mb-1 block text-xs text-fg-muted">Project (optional)</span>
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
      <div>
        <label className="block" htmlFor="object-name">
          <span className="mb-1 block text-xs text-fg-muted">
            Name <span aria-hidden="true">(required)</span>
          </span>
          <input
            ref={nameInputRef}
            id="object-name"
            name="canonicalName"
            required
            value={name}
            onChange={(e) => {
              const nextName = e.target.value;
              updateForm({
                name: nextName,
                ...(nextName.trim() ? { nameError: null } : {}),
                ...(error ? { error: null } : {}),
              });
            }}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'object-name-error' : undefined}
            className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            placeholder="e.g. Acme deal, Q2 OKRs, post-mortem 2026-05-15"
          />
        </label>
        {nameError ? (
          <p id="object-name-error" role="alert" className="mt-1 text-xs text-danger">
            {nameError}
          </p>
        ) : null}
      </div>
      {isSchedulableObjectType(type) ? (
        <label className="block" htmlFor="object-due-at">
          <span className="mb-1 block text-xs text-fg-muted">Due date (optional)</span>
          <input
            id="object-due-at"
            name="dueAt"
            type="date"
            value={dueAt}
            onChange={(e) => {
              updateForm({ dueAt: e.target.value });
            }}
            className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          />
          <DueDateDisplay value={dueAt || null} variant="field-hint" className="mt-1 block" />
        </label>
      ) : null}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-sm bg-signal px-3 text-sm font-medium text-signal-fg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-progress disabled:opacity-60"
      >
        Create object
        {pending ? (
          <>
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            <span className="sr-only">Creating</span>
          </>
        ) : null}
      </button>
    </form>
  );
}
