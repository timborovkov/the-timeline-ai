'use client';
import { presentDueDate } from '@timeline/shared/time';
import { ArrowUpRight, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useReducer, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects/types';

import { createNoteAction, deleteNoteAction, updateNoteAction } from '@/app/actions/objects';
import { CollectionStatus } from '@/components/collections/collection-status';
import { priorityTone } from '@/components/collections/collection-status-tone';
import { EditableMetadata } from '@/components/collections/editable-metadata';
import { MetadataDateEditor } from '@/components/collections/metadata-date-editor';
import { DueDateDisplay } from '@/components/due-date-display';
import { ObjectDiscussionPanel } from '@/components/objects/object-discussion-panel';
import { ObjectOrigin } from '@/components/objects/object-origin';
import { ObjectPeekFrame } from '@/components/objects/object-peek-frame';
import { ObjectPinButton } from '@/components/objects/object-pin-button';
import { ObjectRelatedContext } from '@/components/objects/object-related-context';
import { TaskCategorySelect } from '@/components/tasks/task-category-select';
import { TaskProjectSelect } from '@/components/tasks/task-project-select';
import { DetailRail } from '@/components/ui/detail-rail';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { displayText } from '@/lib/display-dates';
import { isSchedulableObjectType } from '@/lib/due-dates';
import { notifyAction } from '@/lib/notify';
import { displayObjectTitle } from '@/lib/object-title';
import { statusLabel } from '@/lib/status-labels';
import { taskDisplayStatus } from '@/lib/task-statuses';
interface TaskMemberOption {
  id: string;
  label: string;
}
type TaskPatch = Partial<
  Pick<objects.ObjectRow, 'status' | 'assigneeUserId' | 'dueAt' | 'priority'>
>;
interface TaskDetailUiState {
  saving: string | null;
  error: string | null;
  noteBody: string;
  editingNoteId: string | null;
  editingBody: string;
}

type TaskDetailUiAction =
  | { type: 'save-start'; field: string }
  | { type: 'save-end' }
  | { type: 'error'; error: string | null }
  | { noteBody: string }
  | { editingNoteId: string | null; editingBody?: string }
  | { editingBody: string };

function taskDetailUiReducer(
  state: TaskDetailUiState,
  action: TaskDetailUiAction,
): TaskDetailUiState {
  if ('type' in action) {
    if (action.type === 'save-start') {
      return { ...state, saving: action.field, error: null };
    }
    if (action.type === 'save-end') {
      return { ...state, saving: null };
    }
    return { ...state, error: action.error };
  }
  if ('noteBody' in action) {
    return { ...state, noteBody: action.noteBody };
  }
  if ('editingBody' in action && !('editingNoteId' in action)) {
    return { ...state, editingBody: action.editingBody };
  }
  return {
    ...state,
    editingNoteId: action.editingNoteId,
    editingBody: action.editingBody ?? state.editingBody,
  };
}

export function ObjectPeekPanel({
  task,
  connectedWork,
  provenance,
  notes,
  recentChanges,
  initialPinned,
  currentUserId,
  columns,
  members,
  projects,
  taskCategoriesEnabled,
  primaryProject,
  closeHref,
  objectHref,
  onUpdate,
  onProjectChange,
  onProjectChangeCommitted,
  onProjectChangeReverted,
}: {
  task: objects.ObjectRow;
  connectedWork?: objects.ObjectDetail['connectedWork'] | null;
  provenance?: objects.ObjectDetail['provenance'] | null;
  notes?: objects.ObjectDetail['notes'];
  recentChanges?: objects.ObjectDetail['recentChanges'];
  initialPinned: boolean;
  currentUserId?: string;
  columns: string[];
  members: TaskMemberOption[];
  projects: TaskMemberOption[];
  taskCategoriesEnabled: boolean;
  primaryProject: objects.TaskPrimaryProjectRow | null;
  closeHref: string;
  objectHref: string;
  onUpdate: (id: string, patch: TaskPatch) => Promise<{ ok?: boolean; error?: string }>;
  onProjectChange: (project: { id: string; label: string } | null) => void;
  onProjectChangeCommitted: () => void;
  onProjectChangeReverted: () => void;
}) {
  const [panelUi, dispatchPanelUi] = useReducer(taskDetailUiReducer, {
    saving: null,
    error: null,
    noteBody: '',
    editingNoteId: null,
    editingBody: '',
  });
  const { saving, error, noteBody, editingNoteId, editingBody } = panelUi;
  const [notePending, startNoteTransition] = useTransition();
  const timezone = useWorkspaceTimezone();
  const router = useRouter();
  const title = displayObjectTitle(task);
  const assignee = members.find((member) => member.id === task.assigneeUserId);

  function dispatchObjectUi(
    action:
      | { noteBody: string }
      | { editingNoteId: string | null; editingBody?: string }
      | { editingBody: string },
  ): void {
    dispatchPanelUi(action);
  }

  function addNote(): void {
    if (!noteBody.trim()) return;
    const body = noteBody.trim();
    dispatchPanelUi({ noteBody: '' });
    startNoteTransition(async () => {
      const result = await notifyAction({
        id: `task:${task.id}:note`,
        loading: 'Adding comment…',
        success: 'Comment added',
        error: 'Couldn’t add comment',
        run: () => createNoteAction({ entityId: task.id, body }),
      });
      if (result.error) dispatchPanelUi({ noteBody: body });
      else router.refresh();
    });
  }

  function saveNote(noteId: string, body: string): void {
    const trimmed = body.trim();
    if (!trimmed) return;
    dispatchPanelUi({ editingNoteId: null });
    startNoteTransition(async () => {
      const result = await notifyAction({
        id: `task:${task.id}:note`,
        loading: 'Updating comment…',
        success: 'Comment updated',
        error: 'Couldn’t update comment',
        run: () => updateNoteAction({ noteId, entityId: task.id, body: trimmed }),
      });
      if (result.error) {
        dispatchPanelUi({ editingNoteId: noteId, editingBody: body });
      } else router.refresh();
    });
  }

  function deleteNote(noteId: string): void {
    startNoteTransition(async () => {
      const result = await notifyAction({
        id: `task:${task.id}:note`,
        loading: 'Deleting comment…',
        success: 'Comment deleted',
        error: 'Couldn’t delete comment',
        run: () => deleteNoteAction({ noteId, entityId: task.id }),
      });
      if (!result.error) router.refresh();
    });
  }

  function save(field: string, patch: TaskPatch): void {
    dispatchPanelUi({ type: 'save-start', field });
    void onUpdate(task.id, patch)
      .then((result) => {
        if (result.error) {
          dispatchPanelUi({ type: 'error', error: result.error });
        }
      })
      .catch((err: unknown) => {
        dispatchPanelUi({
          type: 'error',
          error: err instanceof Error && err.message ? err.message : 'Save failed',
        });
      })
      .finally(() => {
        dispatchPanelUi({ type: 'save-end' });
      });
  }

  return (
    <ObjectPeekFrame title={displayText(title)} closeHref={closeHref}>
      <DetailRail
        className="h-full min-h-0 overflow-y-auto"
        aria-label={task.type === 'task' ? 'Task detail' : 'Object detail'}
      >
        <div className="sticky top-0 z-20 flex flex-wrap items-start gap-2 border-b border-border bg-surface px-3 py-3">
          <h2 className="min-w-0 flex-1 whitespace-normal break-words text-sm font-semibold leading-snug text-fg">
            {displayText(title)}
          </h2>
          <div className="flex shrink-0 items-center">
            <ObjectPinButton key={task.id} objectId={task.id} initialPinned={initialPinned} />
            <Link
              href={closeHref}
              scroll={false}
              aria-label="Close"
              data-peek-close
              className="inline-flex size-8 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              <X aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
          <Link
            href={objectHref}
            className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-sm border border-border px-3 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowUpRight className="size-4" aria-hidden="true" />
            Open object
          </Link>
        </div>

        {
          <TaskDetailMetadata
            saving={saving}
            task={task}
            save={save}
            columns={columns}
            assignee={assignee}
            members={members}
            timezone={timezone}
            primaryProject={primaryProject}
            projects={projects}
            onProjectChange={onProjectChange}
            onProjectChangeCommitted={onProjectChangeCommitted}
            onProjectChangeReverted={onProjectChangeReverted}
            taskCategoriesEnabled={taskCategoriesEnabled}
          />
        }

        {saving || error ? (
          <div className="px-3 py-1 text-xs">
            {saving ? <span className="text-fg-dim">Saving {saving}…</span> : null}
            {error ? <span className="text-danger">{error}</span> : null}
          </div>
        ) : null}

        <ObjectOrigin provenance={provenance} compact />

        <div className="px-3 py-1.5">
          <ObjectDiscussionPanel
            notes={notes ?? []}
            recentChanges={recentChanges ?? []}
            userId={currentUserId ?? ''}
            members={members}
            pending={notePending}
            noteBody={noteBody}
            editingNoteId={editingNoteId}
            editingBody={editingBody}
            dispatchObjectUi={dispatchObjectUi}
            onAddNote={addNote}
            onSaveNote={saveNote}
            onDeleteNote={deleteNote}
          />
        </div>

        <ObjectRelatedContext connectedWork={connectedWork} compact />
      </DetailRail>
    </ObjectPeekFrame>
  );
}

function TaskDetailMetadata({
  saving,
  task,
  save,
  columns,
  assignee,
  members,
  timezone,
  primaryProject,
  projects,
  onProjectChange,
  onProjectChangeCommitted,
  onProjectChangeReverted,
  taskCategoriesEnabled,
}: {
  saving: string | null;
  task: objects.ObjectRow;
  save: (field: string, patch: TaskPatch) => void;
  columns: string[];
  assignee: TaskMemberOption | undefined;
  members: TaskMemberOption[];
  timezone: string;
  primaryProject: objects.TaskPrimaryProjectRow | null;
  projects: TaskMemberOption[];
  onProjectChange: (project: { id: string; label: string } | null) => void;
  onProjectChangeCommitted: () => void;
  onProjectChangeReverted: () => void;
  taskCategoriesEnabled: boolean;
}) {
  const displayedStatus = task.type === 'task' ? taskDisplayStatus(task.status) : task.status;
  return (
    <div className="mt-0.5 flex flex-col px-1.5">
      <EditableMetadata
        label={task.type === 'task' ? 'Task status' : 'Object status'}
        className="min-h-8 px-1.5"
        pending={saving === 'status'}
      >
        <EditableMetadata.Value>
          <CollectionStatus value={task.status} label={statusLabel(displayedStatus)} />
        </EditableMetadata.Value>
        <EditableMetadata.Editor>
          <select
            value={displayedStatus}
            onChange={(event) => {
              save('status', { status: event.currentTarget.value });
            }}
            className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
            aria-label="Status"
          >
            {columns.map((column) => (
              <option key={column} value={column}>
                {statusLabel(column)}
              </option>
            ))}
            {!columns.includes(displayedStatus) ? (
              <option value={task.status}>{statusLabel(task.status)}</option>
            ) : null}
          </select>
        </EditableMetadata.Editor>
      </EditableMetadata>
      <EditableMetadata
        label={task.type === 'task' ? 'Task priority' : 'Object priority'}
        className="min-h-8 px-1.5"
        pending={saving === 'priority'}
      >
        <EditableMetadata.Value>
          <CollectionStatus
            value={task.priority ? `p${task.priority}` : 'none'}
            tone={priorityTone(task.priority)}
            label={task.priority ? `P${task.priority}` : 'No priority'}
          />
        </EditableMetadata.Value>
        <EditableMetadata.Editor>
          <select
            value={task.priority ?? ''}
            onChange={(event) => {
              save('priority', {
                priority: event.currentTarget.value ? Number(event.currentTarget.value) : null,
              });
            }}
            className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
            aria-label={task.type === 'task' ? 'Task priority' : 'Object priority'}
          >
            <option value="">No priority</option>
            {[1, 2, 3, 4].map((priority) => (
              <option key={priority} value={priority}>
                P{priority}
              </option>
            ))}
          </select>
        </EditableMetadata.Editor>
      </EditableMetadata>
      {isSchedulableObjectType(task.type) ? (
        <ObjectScheduleMetadata
          task={task}
          saving={saving}
          save={save}
          assignee={assignee}
          members={members}
          timezone={timezone}
        />
      ) : null}
      {task.type === 'task' ? (
        <div className="px-2 py-1">
          <TaskProjectSelect
            taskId={task.id}
            projectId={primaryProject?.projectId ?? null}
            currentProjectLabel={primaryProject?.projectName}
            projectArchived={Boolean(primaryProject?.archivedAt)}
            projects={projects}
            onProjectChange={onProjectChange}
            onProjectChangeCommitted={onProjectChangeCommitted}
            onProjectChangeReverted={onProjectChangeReverted}
            quiet
          />
        </div>
      ) : null}
      {task.type === 'task' && taskCategoriesEnabled ? (
        <div className="px-2 py-1">
          <TaskCategorySelect
            taskId={task.id}
            category={task.taskCategory}
            mode={task.taskCategoryMode}
            status={task.taskCategoryStatus}
            updatedAt={task.taskCategoryUpdatedAt}
            quiet
          />
        </div>
      ) : null}
    </div>
  );
}

function ObjectScheduleMetadata({
  task,
  saving,
  save,
  assignee,
  members,
  timezone,
}: {
  task: objects.ObjectRow;
  saving: string | null;
  save: (field: string, patch: TaskPatch) => void;
  assignee: TaskMemberOption | undefined;
  members: TaskMemberOption[];
  timezone: string;
}) {
  return (
    <>
      <EditableMetadata
        label="Task assignee"
        className="min-h-8 px-1.5"
        pending={saving === 'assignee'}
      >
        <EditableMetadata.Value>{assignee?.label ?? 'Unassigned'}</EditableMetadata.Value>
        <EditableMetadata.Editor>
          <select
            value={task.assigneeUserId ?? ''}
            onChange={(event) => {
              save('assignee', { assigneeUserId: event.currentTarget.value || null });
            }}
            className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
            aria-label="Task assignee"
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.label}
              </option>
            ))}
          </select>
        </EditableMetadata.Editor>
      </EditableMetadata>
      <EditableMetadata
        label="Task due date"
        className="min-h-8 px-1.5"
        pending={saving === 'due date'}
      >
        <EditableMetadata.Value>
          <DueDateDisplay value={task.dueAt} variant="field-hint" />
        </EditableMetadata.Value>
        <EditableMetadata.Editor>
          <MetadataDateEditor
            defaultValue={
              task.dueAt ? (presentDueDate(task.dueAt, { timezone }).dateKey ?? '') : ''
            }
            label="Due date"
            onApply={(value) => {
              save('due date', {
                dueAt: value ? new Date(`${value}T00:00:00.000Z`) : null,
              });
            }}
          />
        </EditableMetadata.Editor>
      </EditableMetadata>
    </>
  );
}
