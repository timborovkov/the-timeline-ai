'use client';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useTransition,
} from 'react';

import type { SaveState } from '@/lib/utils';
import type * as objects from '@timeline/shared/objects';

import {
  acceptObjectChangeAction,
  addRelationshipAction,
  archiveObjectAction,
  createNoteAction,
  deleteNoteAction,
  rejectObjectChangeAction,
  removeRelationshipAction,
  updateNoteAction,
  updateObjectAction,
} from '@/app/actions/objects';
import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { ObjectSectionFeed } from '@/components/objects/object-section-feed';
import { readJson } from '@/lib/paginated-api';
import { queryKeys } from '@/lib/query-keys';
import { errorMessage } from '@/lib/utils';

const RELATIONSHIP_KINDS = [
  'related',
  'parent',
  'child',
  'blocks',
  'blocked_by',
  'duplicate_of',
] as const;

type ObjectDetail = objects.ObjectDetail;
type LocalSuggestion = ComponentProps<typeof ApprovalsClient>['suggestions'][number];
type EditableField = 'status' | 'stage' | 'priority' | 'dueAt';
type EditableValue = string | number | Date | null;
type DraftField = 'stage' | 'dueAt';

interface Props {
  detail: ObjectDetail;
  userId: string;
  suggestions: LocalSuggestion[];
}

interface ObjectDetailUiState {
  overrides: Partial<Record<EditableField, EditableValue>>;
  stageDraft: string;
  dueDraft: string;
  saveState: SaveState;
  savingCount: number;
  error: string | null;
  noteBody: string;
  editingNoteId: string | null;
  editingBody: string;
  linkKind: (typeof RELATIONSHIP_KINDS)[number];
}

interface ObjectSearchResult {
  id: string;
  canonicalName: string;
  type: string;
}

type ObjectDetailUiAction =
  | Partial<ObjectDetailUiState>
  | ((state: ObjectDetailUiState) => ObjectDetailUiState);

// Per-type status vocabulary. Free-form text in the DB so callers can extend
// without a migration; the dropdown lives in the UI.
const STATUS_BY_TYPE: Record<string, string[]> = {
  deal: ['open', 'qualified', 'proposal', 'won', 'lost'],
  task: ['suggested', 'todo', 'doing', 'done', 'blocked', 'cancelled'],
  follow_up: ['todo', 'doing', 'done', 'cancelled'],
  project: ['planning', 'active', 'on_hold', 'shipped', 'cancelled'],
  incident: ['open', 'mitigated', 'resolved', 'postmortem'],
  hiring_loop: ['sourcing', 'interviewing', 'offer', 'hired', 'closed'],
  decision: ['draft', 'proposed', 'accepted', 'rejected'],
};

function statusOptions(type: string): string[] {
  return STATUS_BY_TYPE[type] ?? ['open', 'active', 'archived'];
}

function isDraftField(field: EditableField): field is DraftField {
  return field === 'stage' || field === 'dueAt';
}

function isObjectSearchResult(value: unknown): value is ObjectSearchResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.canonicalName === 'string' &&
    typeof row.type === 'string'
  );
}

function initObjectDetailUiState(detail: ObjectDetail): ObjectDetailUiState {
  return {
    overrides: {},
    stageDraft: detail.stage ?? '',
    dueDraft: toLocalInputValue(detail.dueAt),
    saveState: 'idle',
    savingCount: 0,
    error: null,
    noteBody: '',
    editingNoteId: null,
    editingBody: '',
    linkKind: 'related',
  };
}

function objectDetailUiReducer(
  state: ObjectDetailUiState,
  action: ObjectDetailUiAction,
): ObjectDetailUiState {
  return typeof action === 'function' ? action(state) : { ...state, ...action };
}

function applyObjectDetailOverrides(
  detail: ObjectDetail,
  overrides: Partial<Record<EditableField, EditableValue>>,
): ObjectDetail {
  return { ...detail, ...overrides } as ObjectDetail;
}

export function ObjectDetailClient({ detail, userId, suggestions }: Props) {
  return useObjectDetailView({ detail, userId, suggestions });
}

function useObjectDetailView({ detail, userId, suggestions }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [
    {
      overrides,
      stageDraft,
      dueDraft,
      saveState,
      savingCount,
      error,
      noteBody,
      editingNoteId,
      editingBody,
      linkKind,
    },
    dispatchObjectUi,
  ] = useReducer(objectDetailUiReducer, detail, initObjectDetailUiState);
  const [linkQuery, setLinkQuery] = useState('');
  const [selectedLink, setSelectedLink] = useState<ObjectSearchResult | null>(null);
  const localDetail = useMemo(
    () => applyObjectDetailOverrides(detail, overrides),
    [detail, overrides],
  );
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localDetailRef = useRef(detail);
  const serverDetailRef = useRef(detail);
  const queuedFieldValuesRef = useRef<Record<EditableField, EditableValue | undefined>>({
    status: undefined,
    stage: undefined,
    priority: undefined,
    dueAt: undefined,
  });
  const savingCountRef = useRef(0);
  const batchHadFailureRef = useRef(false);
  const focusedDraftsRef = useRef<Record<DraftField, boolean>>({ stage: false, dueAt: false });
  const savingDraftsRef = useRef<Record<DraftField, number>>({ stage: 0, dueAt: 0 });
  const savingFieldsRef = useRef<Record<EditableField, number>>({
    status: 0,
    stage: 0,
    priority: 0,
    dueAt: 0,
  });
  localDetailRef.current = localDetail;
  serverDetailRef.current = detail;

  function updateLocalDetail(updater: (current: ObjectDetail) => ObjectDetail): void {
    const next = updater(localDetailRef.current);
    localDetailRef.current = next;
    dispatchObjectUi((current) => ({
      ...current,
      overrides: {
        ...current.overrides,
        status: next.status,
        stage: next.stage,
        priority: next.priority,
        dueAt: next.dueAt,
      },
    }));
  }

  const trimmedLinkQuery = linkQuery.trim();
  const { data: linkResultsData } = useQuery({
    queryKey: queryKeys.objectSearch(trimmedLinkQuery, detail.id),
    enabled: trimmedLinkQuery.length > 0,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const params = new URLSearchParams({ q: trimmedLinkQuery, exclude: detail.id });
      return readJson<{ results?: ObjectSearchResult[] }>(
        await fetch(`/api/objects/search?${params.toString()}`),
      );
    },
  });
  const visibleLinkResults = trimmedLinkQuery
    ? (linkResultsData?.results?.filter(isObjectSearchResult) ?? [])
    : [];

  function searchLinkObjects(value: string): void {
    setLinkQuery(value);
    setSelectedLink(null);
  }

  function selectLinkResult(result: ObjectSearchResult): void {
    setLinkQuery(result.canonicalName);
    setSelectedLink(result);
  }

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  function patch(field: EditableField, value: EditableValue): void {
    const currentValue = localDetailRef.current[field];
    if (sameEditableValue(field, currentValue, value)) return;
    dispatchObjectUi({ error: null });
    updateLocalDetail((current) => ({ ...current, [field]: value }));
    if (savingFieldsRef.current[field] > 0) {
      queuedFieldValuesRef.current[field] = value;
      return;
    }
    beginFieldSave(field, value);
  }

  function beginFieldSave(
    field: EditableField,
    value: EditableValue,
    options: { preserveBatchFailure?: boolean } = {},
  ): void {
    savingFieldsRef.current[field] += 1;
    if (isDraftField(field)) savingDraftsRef.current[field] += 1;
    if (savedTimer.current) clearTimeout(savedTimer.current);
    dispatchObjectUi({ saveState: 'saving' });
    if (savingCountRef.current === 0 && !options.preserveBatchFailure) {
      batchHadFailureRef.current = false;
    }
    savingCountRef.current += 1;
    dispatchObjectUi({ savingCount: savingCountRef.current });
    startTransition(async () => {
      try {
        const actionValue = value instanceof Date ? value.toISOString() : value;
        const result = await updateObjectAction({ id: detail.id, [field]: actionValue });
        const failed = 'error' in result && result.error;
        if (failed) {
          handleFieldSaveFailure(field, value, result.error ?? 'Update failed');
        } else if (!batchHadFailureRef.current) {
          dispatchObjectUi({ error: null });
        }
        router.refresh();
      } catch (err) {
        handleFieldSaveFailure(field, value, errorMessage(err, 'Update failed'));
        router.refresh();
      } finally {
        finishFieldSave(field);
      }
    });
  }

  function handleFieldSaveFailure(field: EditableField, value: EditableValue, message: string) {
    batchHadFailureRef.current = true;
    dispatchObjectUi({ error: message });
    const rollbackValue = serverDetailRef.current[field];
    if (
      queuedFieldValuesRef.current[field] === undefined &&
      sameEditableValue(field, localDetailRef.current[field], value)
    ) {
      updateLocalDetail((current) => ({
        ...current,
        [field]: field === 'dueAt' ? toDateOrNull(rollbackValue) : rollbackValue,
      }));
      if (field === 'stage') {
        dispatchObjectUi({ stageDraft: rollbackValue === null ? '' : String(rollbackValue) });
      }
      if (field === 'dueAt') {
        dispatchObjectUi({ dueDraft: toLocalInputValue(rollbackValue) });
      }
    }
  }

  function finishFieldSave(field: EditableField): void {
    savingCountRef.current = Math.max(0, savingCountRef.current - 1);
    if (isDraftField(field)) {
      savingDraftsRef.current[field] = Math.max(0, savingDraftsRef.current[field] - 1);
    }
    savingFieldsRef.current[field] = Math.max(0, savingFieldsRef.current[field] - 1);

    const queuedValue = queuedFieldValuesRef.current[field];
    queuedFieldValuesRef.current[field] = undefined;
    if (queuedValue !== undefined) {
      beginFieldSave(field, queuedValue, { preserveBatchFailure: batchHadFailureRef.current });
      dispatchObjectUi({ savingCount: savingCountRef.current });
      return;
    }

    dispatchObjectUi({ savingCount: savingCountRef.current });
    if (savingCountRef.current === 0) {
      if (batchHadFailureRef.current) {
        dispatchObjectUi({ saveState: 'idle' });
      } else {
        dispatchObjectUi({ saveState: 'saved' });
        savedTimer.current = setTimeout(() => {
          dispatchObjectUi({ saveState: 'idle' });
        }, 1600);
      }
    }
  }

  function addNote(): void {
    if (!noteBody.trim()) return;
    dispatchObjectUi({ error: null });
    const body = noteBody;
    startTransition(async () => {
      const result = await createNoteAction({ entityId: detail.id, body });
      if ('error' in result && result.error) {
        // Keep the textarea contents so the user can retry without
        // re-typing — mirrors the edit-note flow.
        dispatchObjectUi({ error: result.error });
      } else {
        dispatchObjectUi({ noteBody: '' });
        router.refresh();
      }
    });
  }

  function saveNote(noteId: string, body: string): void {
    dispatchObjectUi({ error: null });
    startTransition(async () => {
      const result = await updateNoteAction({ noteId, entityId: detail.id, body });
      if ('error' in result && result.error) {
        // Keep the editor open so the user can fix their input rather than
        // losing the draft.
        dispatchObjectUi({ error: result.error });
      } else {
        dispatchObjectUi({ editingNoteId: null });
        router.refresh();
      }
    });
  }

  function deleteNote(noteId: string): void {
    dispatchObjectUi({ error: null });
    startTransition(async () => {
      const result = await deleteNoteAction({ noteId, entityId: detail.id });
      if ('error' in result && result.error) dispatchObjectUi({ error: result.error });
      else router.refresh();
    });
  }

  function addRelationship(): void {
    const toId = selectedLink?.id;
    if (!toId) return;
    dispatchObjectUi({ error: null });
    startTransition(async () => {
      const result = await addRelationshipAction({
        fromEntityId: detail.id,
        toEntityId: toId,
        kind: linkKind,
      });
      if ('error' in result && result.error) {
        dispatchObjectUi({ error: result.error });
      } else {
        setLinkQuery('');
        setSelectedLink(null);
        router.refresh();
      }
    });
  }

  function removeRelationship(id: string, otherEntityId: string): void {
    dispatchObjectUi({ error: null });
    startTransition(async () => {
      const result = await removeRelationshipAction({ id, entityId: detail.id, otherEntityId });
      if ('error' in result && result.error) dispatchObjectUi({ error: result.error });
      else router.refresh();
    });
  }

  function acceptChange(changeId: string): void {
    dispatchObjectUi({ error: null });
    startTransition(async () => {
      const result = await acceptObjectChangeAction({ changeId, entityId: detail.id });
      if ('error' in result && result.error) dispatchObjectUi({ error: result.error });
      else router.refresh();
    });
  }

  function rejectChange(changeId: string): void {
    dispatchObjectUi({ error: null });
    startTransition(async () => {
      const result = await rejectObjectChangeAction({ changeId, entityId: detail.id });
      if ('error' in result && result.error) dispatchObjectUi({ error: result.error });
      else router.refresh();
    });
  }

  function archiveObject(): void {
    dispatchObjectUi({ error: null });
    startTransition(async () => {
      const result = await archiveObjectAction({ id: detail.id });
      if ('error' in result && result.error) dispatchObjectUi({ error: result.error });
      else router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      <ObjectDetailHeader
        detail={detail}
        error={error}
        saveState={saveState}
        savingCount={savingCount}
      />

      {suggestions.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium tracking-tight">Pending approvals</h2>
          <ApprovalsClient suggestions={suggestions} allowBulkAccept={false} />
        </section>
      ) : null}

      <ObjectEditableFields
        detail={localDetail}
        stageDraft={stageDraft}
        dueDraft={dueDraft}
        focusedDraftsRef={focusedDraftsRef}
        patch={patch}
        dispatchObjectUi={dispatchObjectUi}
      />

      <ObjectSectionFeed objectId={detail.id} section="events" title="Timeline events" />
      <ObjectSectionFeed objectId={detail.id} section="facts" title="Facts" />

      <ObjectNotesSection
        notes={detail.notes}
        userId={userId}
        pending={pending}
        noteBody={noteBody}
        editingNoteId={editingNoteId}
        editingBody={editingBody}
        dispatchObjectUi={dispatchObjectUi}
        onAddNote={addNote}
        onSaveNote={saveNote}
        onDeleteNote={deleteNote}
      />

      <ObjectOpenTasksSection tasks={detail.openTasks} />

      <ObjectRelationshipsSection
        relationships={detail.relationships}
        pending={pending}
        linkQuery={linkQuery}
        linkResults={visibleLinkResults}
        selectedLink={selectedLink}
        linkKind={linkKind}
        onLinkQueryChange={searchLinkObjects}
        onSelectLink={selectLinkResult}
        dispatchObjectUi={dispatchObjectUi}
        onAddRelationship={addRelationship}
        onRemoveRelationship={removeRelationship}
      />

      <ObjectRecentChangesSection
        changes={detail.recentChanges}
        pending={pending}
        onAcceptChange={acceptChange}
        onRejectChange={rejectChange}
      />

      <ObjectArchiveFooter
        archivedAt={detail.archivedAt}
        pending={pending}
        onArchiveObject={archiveObject}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function ObjectDetailHeader({
  detail,
  error,
  saveState,
  savingCount,
}: {
  detail: ObjectDetail;
  error: string | null;
  saveState: SaveState;
  savingCount: number;
}) {
  const pendingCount = detail.recentChanges.filter((c) => c.status === 'suggested').length;
  return (
    <header>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-y border-border py-3 font-mono text-xs uppercase tracking-[0.12em] text-fg-muted">
        <span className="text-fg">{detail.type}</span>
        <span className="text-fg-dim">·</span>
        <span className="text-signal">{detail.canonicalName}</span>
        <span className="ml-auto text-fg-dim">id&nbsp;{detail.id.slice(0, 8)}</span>
      </div>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{detail.canonicalName}</h1>
      {detail.aliases.length > 0 && (
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
          aka {detail.aliases.join(' · ')}
        </p>
      )}
      {detail.newSinceLastVisit > 0 && (
        <output className="mt-4 rounded-sm border border-signal/40 bg-signal-soft px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-signal">
          {detail.newSinceLastVisit} new change{detail.newSinceLastVisit === 1 ? '' : 's'} since
          your last visit
        </output>
      )}
      {pendingCount > 0 ? (
        <output className="mt-3 rounded-sm border border-signal/40 bg-signal-soft px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-signal">
          {pendingCount} agent suggestion{pendingCount === 1 ? '' : 's'} awaiting review below
        </output>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-sm border border-danger/40 bg-bg px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-danger"
        >
          {error}
        </div>
      ) : null}
      {saveState !== 'idle' ? (
        <output
          aria-live="polite"
          className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim"
        >
          {saveState === 'saving'
            ? `Saving${savingCount > 1 ? ` ${savingCount} changes` : ''}...`
            : 'Saved'}
        </output>
      ) : null}
    </header>
  );
}

function ObjectEditableFields({
  detail,
  stageDraft,
  dueDraft,
  focusedDraftsRef,
  patch,
  dispatchObjectUi,
}: {
  detail: ObjectDetail;
  stageDraft: string;
  dueDraft: string;
  focusedDraftsRef: RefObject<Record<DraftField, boolean>>;
  patch: (field: EditableField, value: EditableValue) => void;
  dispatchObjectUi: Dispatch<ObjectDetailUiAction>;
}) {
  const options = statusOptions(detail.type);
  return (
    <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      <Field label="Status">
        <select
          value={detail.status}
          onChange={(e) => {
            patch('status', e.target.value);
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          {!options.includes(detail.status) && (
            <option value={detail.status}>{detail.status}</option>
          )}
        </select>
      </Field>
      <Field label="Stage">
        <input
          aria-label="Stage"
          value={stageDraft}
          onFocus={() => {
            focusedDraftsRef.current.stage = true;
          }}
          onChange={(e) => {
            dispatchObjectUi({ stageDraft: e.target.value });
          }}
          onBlur={(e) => {
            focusedDraftsRef.current.stage = false;
            const v = e.target.value.trim();
            dispatchObjectUi({ stageDraft: v });
            patch('stage', v === '' ? null : v);
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="e.g. discovery"
        />
      </Field>
      <Field label="Priority">
        <select
          value={detail.priority ?? ''}
          onChange={(e) => {
            patch('priority', e.target.value === '' ? null : Number(e.target.value));
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">None</option>
          <option value="1">1 (urgent)</option>
          <option value="2">2 (high)</option>
          <option value="3">3 (normal)</option>
          <option value="4">4 (low)</option>
        </select>
      </Field>
      <Field label="Due date">
        <input
          aria-label="Due date"
          type="datetime-local"
          value={dueDraft}
          onFocus={() => {
            focusedDraftsRef.current.dueAt = true;
          }}
          onChange={(e) => {
            dispatchObjectUi({ dueDraft: e.target.value });
          }}
          onBlur={(e) => {
            focusedDraftsRef.current.dueAt = false;
            const v = e.target.value;
            patch('dueAt', v === '' ? null : new Date(v));
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </Field>
    </section>
  );
}

function ObjectNotesSection({
  notes,
  userId,
  pending,
  noteBody,
  editingNoteId,
  editingBody,
  dispatchObjectUi,
  onAddNote,
  onSaveNote,
  onDeleteNote,
}: {
  notes: ObjectDetail['notes'];
  userId: string;
  pending: boolean;
  noteBody: string;
  editingNoteId: string | null;
  editingBody: string;
  dispatchObjectUi: Dispatch<ObjectDetailUiAction>;
  onAddNote: () => void;
  onSaveNote: (noteId: string, body: string) => void;
  onDeleteNote: (noteId: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium tracking-tight">Notes</h2>
      <div className="mb-4 space-y-2">
        <textarea
          aria-label="New note"
          value={noteBody}
          onChange={(e) => {
            dispatchObjectUi({ noteBody: e.target.value });
          }}
          placeholder="Add a note. Each note also lands on the timeline."
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          rows={3}
        />
        <button
          type="button"
          onClick={onAddNote}
          disabled={pending || !noteBody.trim()}
          className="rounded-md border border-signal/40 bg-signal-soft px-3 py-1.5 text-sm text-signal hover:bg-signal/25 disabled:opacity-50"
        >
          Add note
        </button>
      </div>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <ObjectNoteItem
              key={note.id}
              note={note}
              isOwner={note.authorUserId === userId}
              isEditing={editingNoteId === note.id}
              editingBody={editingBody}
              pending={pending}
              dispatchObjectUi={dispatchObjectUi}
              onSaveNote={onSaveNote}
              onDeleteNote={onDeleteNote}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ObjectNoteItem({
  note,
  isOwner,
  isEditing,
  editingBody,
  pending,
  dispatchObjectUi,
  onSaveNote,
  onDeleteNote,
}: {
  note: ObjectDetail['notes'][number];
  isOwner: boolean;
  isEditing: boolean;
  editingBody: string;
  pending: boolean;
  dispatchObjectUi: Dispatch<ObjectDetailUiAction>;
  onSaveNote: (noteId: string, body: string) => void;
  onDeleteNote: (noteId: string) => void;
}) {
  return (
    <li className="rounded-sm border border-border bg-surface px-4 py-3 text-sm">
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            aria-label="Edit note"
            value={editingBody}
            onChange={(e) => {
              dispatchObjectUi({ editingBody: e.target.value });
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || !editingBody.trim()}
              onClick={() => {
                onSaveNote(note.id, editingBody);
              }}
              className="rounded-md border border-signal/40 bg-signal-soft px-3 py-1 text-xs text-signal hover:bg-signal/25 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                dispatchObjectUi({ editingNoteId: null });
              }}
              className="rounded-md border px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="whitespace-pre-wrap">{note.body}</div>
      )}
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{new Date(note.createdAt).toLocaleString()}</span>
        {isOwner && !isEditing ? (
          <div className="flex gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                dispatchObjectUi({ editingNoteId: note.id, editingBody: note.body });
              }}
              className="hover:underline"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                onDeleteNote(note.id);
              }}
              className="text-destructive hover:underline"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ObjectOpenTasksSection({ tasks }: { tasks: ObjectDetail['openTasks'] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium tracking-tight">Open tasks</h2>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open tasks linked to this object.</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center justify-between rounded-sm border border-border bg-surface px-4 py-2 text-sm"
            >
              <a href={`/app/objects/${task.id}`} className="font-medium hover:underline">
                {task.canonicalName}
              </a>
              <span className="text-xs text-muted-foreground">
                {task.status}
                {task.dueAt ? ` · due ${new Date(task.dueAt).toLocaleDateString()}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ObjectRelationshipsSection({
  relationships,
  pending,
  linkQuery,
  linkResults,
  selectedLink,
  linkKind,
  onLinkQueryChange,
  onSelectLink,
  dispatchObjectUi,
  onAddRelationship,
  onRemoveRelationship,
}: {
  relationships: ObjectDetail['relationships'];
  pending: boolean;
  linkQuery: string;
  linkResults: ObjectSearchResult[];
  selectedLink: ObjectSearchResult | null;
  linkKind: (typeof RELATIONSHIP_KINDS)[number];
  onLinkQueryChange: (value: string) => void;
  onSelectLink: (result: ObjectSearchResult) => void;
  dispatchObjectUi: Dispatch<ObjectDetailUiAction>;
  onAddRelationship: () => void;
  onRemoveRelationship: (id: string, otherEntityId: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium tracking-tight">Related</h2>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="min-w-64 flex-1">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
            Link to object
          </span>
          <input
            value={linkQuery}
            onChange={(e) => {
              onLinkQueryChange(e.target.value);
            }}
            placeholder="Search objects"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label>
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
            Kind
          </span>
          <select
            value={linkKind}
            onChange={(e) => {
              dispatchObjectUi({
                linkKind: e.target.value as (typeof RELATIONSHIP_KINDS)[number],
              });
            }}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            {RELATIONSHIP_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={pending || !selectedLink}
          onClick={onAddRelationship}
          className="rounded-md border border-signal/40 bg-signal-soft px-3 py-2 text-sm text-signal hover:bg-signal/25 disabled:opacity-50"
        >
          Link
        </button>
      </div>
      {selectedLink ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Selected {selectedLink.canonicalName} · {selectedLink.type}
        </p>
      ) : linkResults.length > 0 ? (
        <ul className="mb-3 grid gap-1">
          {linkResults.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                className="w-full rounded-sm border border-border px-3 py-2 text-left text-sm hover:bg-surface"
                onClick={() => {
                  onSelectLink(result);
                }}
              >
                <span className="font-medium">{result.canonicalName}</span>{' '}
                <span className="text-xs text-muted-foreground">{result.type}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {relationships.length === 0 ? (
        <p className="text-sm text-muted-foreground">No relationships yet.</p>
      ) : (
        <ul className="space-y-2">
          {relationships.map((relationship) => (
            <li
              key={`${relationship.direction}-${relationship.id}`}
              className="flex items-center justify-between rounded-sm border border-border bg-surface px-4 py-2 text-sm"
            >
              <a
                href={`/app/objects/${relationship.otherId}`}
                className="font-medium hover:underline"
              >
                {relationship.otherName}
              </a>
              <div className="flex items-center gap-3">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {relationship.kind === 'related'
                    ? relationship.kind
                    : relationship.direction === 'out'
                      ? relationship.kind
                      : `← ${relationship.kind}`}{' '}
                  · {relationship.otherType}
                </span>
                {relationship.direction === 'out' || relationship.kind === 'related' ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      onRemoveRelationship(relationship.id, relationship.otherId);
                    }}
                    className="text-xs text-destructive hover:underline"
                  >
                    Unlink
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ObjectRecentChangesSection({
  changes,
  pending,
  onAcceptChange,
  onRejectChange,
}: {
  changes: ObjectDetail['recentChanges'];
  pending: boolean;
  onAcceptChange: (changeId: string) => void;
  onRejectChange: (changeId: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium tracking-tight">Recent changes</h2>
      {changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes recorded.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {changes.slice(0, 20).map((change) => (
            <ObjectRecentChangeItem
              key={change.id}
              change={change}
              pending={pending}
              onAcceptChange={onAcceptChange}
              onRejectChange={onRejectChange}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ObjectRecentChangeItem({
  change,
  pending,
  onAcceptChange,
  onRejectChange,
}: {
  change: ObjectDetail['recentChanges'][number];
  pending: boolean;
  onAcceptChange: (changeId: string) => void;
  onRejectChange: (changeId: string) => void;
}) {
  const isSuggested = change.status === 'suggested';
  const isRejected = change.status === 'rejected';
  return (
    <li
      className={`rounded-sm border border-border bg-surface px-4 py-2 ${isSuggested ? 'border-signal/40 bg-signal-soft' : ''} ${isRejected ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{change.field}</span>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {change.actorKind} · {change.status}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {formatValue(change.previousValue)} → {formatValue(change.newValue)}
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{new Date(change.changedAt).toLocaleString()}</span>
        {isSuggested ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                onAcceptChange(change.id);
              }}
              className="rounded-md border border-signal/40 bg-signal-soft px-2 py-0.5 text-signal hover:bg-signal/25 disabled:opacity-50"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                onRejectChange(change.id);
              }}
              className="rounded-md border px-2 py-0.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ObjectArchiveFooter({
  archivedAt,
  pending,
  onArchiveObject,
}: {
  archivedAt: ObjectDetail['archivedAt'];
  pending: boolean;
  onArchiveObject: () => void;
}) {
  return (
    <footer className="border-t pt-6">
      <button
        type="button"
        disabled={pending || archivedAt !== null}
        onClick={onArchiveObject}
        className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
      >
        {archivedAt ? 'Archived' : 'Archive object'}
      </button>
    </footer>
  );
}

function sameEditableValue(field: EditableField, a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return Object.is(a, b);
  if (field !== 'dueAt') return Object.is(a, b);
  const aDate = toDateOrNull(a);
  const bDate = toDateOrNull(b);
  if (aDate !== null || bDate !== null) {
    return aDate !== null && bDate !== null && aDate.getTime() === bDate.getTime();
  }
  return Object.is(a, b);
}

function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toLocalInputValue(value: unknown): string {
  const d = toDateOrNull(value);
  return d ? toLocalInput(d) : '';
}

function toLocalInput(d: Date): string {
  // <input type="datetime-local"> expects YYYY-MM-DDTHH:mm in *local* time
  // (no Z). Convert manually rather than slicing toISOString — that returns
  // UTC and the picker would show the wrong wall-clock time for any user
  // not on UTC.
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}
