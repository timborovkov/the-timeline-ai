'use client';
import { useQuery } from '@tanstack/react-query';
import { truncateFilenameMiddle } from '@timeline/shared/documents/presentation';
import { presentDueDate } from '@timeline/shared/time';
import Link from 'next/link';
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
import type { ArtifactRef } from '@timeline/shared/citation';
import type * as objects from '@timeline/shared/objects/types';

import {
  acceptObjectChangeAction,
  addRelationshipAction,
  archiveObjectAction,
  createNoteAction,
  deleteNoteAction,
  generateObjectSummaryAction,
  rejectObjectChangeAction,
  removeRelationshipAction,
  repairObjectMemoryAction,
  updateNoteAction,
  updateObjectAction,
} from '@/app/actions/objects';
import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { ArtifactReferenceChip } from '@/components/artifact-reference-chip';
import { ChatViewContextBinder } from '@/components/chat/chat-view-context';
import { DueDateDisplay } from '@/components/due-date-display';
import { ObjectPinButton } from '@/components/objects/object-pin-button';
import {
  type ObjectSearchResponse,
  type ObjectSearchResult,
  visibleObjectSearchResultsForQuery,
} from '@/components/objects/object-search-results';
import { ObjectSectionFeed } from '@/components/objects/object-section-feed';
import { LiveTaskCategoryBadge } from '@/components/tasks/task-category-badge';
import { TaskCategorySelect } from '@/components/tasks/task-category-select';
import { TaskProjectSelect } from '@/components/tasks/task-project-select';
import { TechnicalDetails } from '@/components/technical-details';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { WorkSubnav } from '@/components/work-subnav';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { displayText, formatDisplayDateTime } from '@/lib/display-dates';
import { isInternalIdentifier } from '@/lib/display-labels';
import { isSchedulableObjectType } from '@/lib/due-dates';
import { formatTaskCategoryChangeValue } from '@/lib/object-change-format';
import { displayObjectTitle } from '@/lib/object-title';
import { readJson } from '@/lib/paginated-api';
import { queryKeys } from '@/lib/query-keys';
import { statusLabel } from '@/lib/status-labels';
import { cn, errorMessage } from '@/lib/utils';

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
type EditableField = 'canonicalName' | 'aliases' | 'status' | 'stage' | 'priority' | 'dueAt';
type EditableValue = string | number | Date | readonly string[] | null;
type DraftField = 'canonicalName' | 'aliases' | 'stage' | 'dueAt';

interface Props {
  detail: ObjectDetail;
  userId: string;
  initialPinned?: boolean;
  suggestions: LocalSuggestion[];
  projects?: { id: string; label: string }[];
  primaryProject?: objects.TaskPrimaryProjectRow | null;
  taskCategoriesEnabled?: boolean;
}

interface ObjectDetailUiState {
  overrides: Partial<Record<EditableField, EditableValue>>;
  nameDraft: string;
  aliasesDraft: string;
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

type ObjectDetailUiAction =
  | Partial<ObjectDetailUiState>
  | ((state: ObjectDetailUiState) => ObjectDetailUiState);

interface ObjectDetailLocalState {
  linkQuery: string;
  selectedLink: ObjectSearchResult | null;
  pendingNotes: ObjectDetail['notes'];
  noteUpdates: Record<string, ObjectDetail['notes'][number]>;
  deletedNoteIds: readonly string[];
  pendingRelationships: ObjectDetail['relationships'];
  deletedRelationshipIds: readonly string[];
  recentChangeStatuses: Record<string, ObjectDetail['recentChanges'][number]['status']>;
  archivedAtOverride: ObjectDetail['archivedAt'] | undefined;
}

type ObjectDetailLocalAction =
  | Partial<ObjectDetailLocalState>
  | ((state: ObjectDetailLocalState) => ObjectDetailLocalState);

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
const EMPTY_PROJECT_OPTIONS: { id: string; label: string }[] = [];

function statusOptions(type: string): string[] {
  return STATUS_BY_TYPE[type] ?? ['open', 'active', 'archived'];
}

function isDraftField(field: EditableField): field is DraftField {
  return field === 'canonicalName' || field === 'aliases' || field === 'stage' || field === 'dueAt';
}

function isEditableFieldName(field: string): field is EditableField {
  return (
    field === 'canonicalName' ||
    field === 'aliases' ||
    field === 'status' ||
    field === 'stage' ||
    field === 'priority' ||
    field === 'dueAt'
  );
}

function editableValueFromChange(field: EditableField, value: unknown): EditableValue {
  if (field === 'aliases') return normalizeAliases(value);
  if (field === 'dueAt') return toDateOrNull(value);
  if (field === 'priority') {
    if (value === null) return null;
    const priority = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(priority) ? priority : null;
  }
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value.toString();
  return null;
}

function localMutationId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isOptimisticRelationship(relationship: ObjectDetail['relationships'][number]): boolean {
  return relationship.id.startsWith('optimistic-relationship-');
}

function initObjectDetailUiState(detail: ObjectDetail, timezone: string): ObjectDetailUiState {
  return {
    overrides: {},
    nameDraft: editableObjectName(detail),
    aliasesDraft: detail.aliases.join(', '),
    stageDraft: detail.stage ?? '',
    dueDraft: toLocalInputValue(detail.dueAt, timezone),
    saveState: 'idle',
    savingCount: 0,
    error: null,
    noteBody: '',
    editingNoteId: null,
    editingBody: '',
    linkKind: 'related',
  };
}

function editableObjectName(detail: Pick<ObjectDetail, 'canonicalName' | 'metadata'>): string {
  return displayObjectTitle(detail);
}

function objectDetailUiReducer(
  state: ObjectDetailUiState,
  action: ObjectDetailUiAction,
): ObjectDetailUiState {
  return typeof action === 'function' ? action(state) : { ...state, ...action };
}

function initObjectDetailLocalState(): ObjectDetailLocalState {
  return {
    linkQuery: '',
    selectedLink: null,
    pendingNotes: [],
    noteUpdates: {},
    deletedNoteIds: [],
    pendingRelationships: [],
    deletedRelationshipIds: [],
    recentChangeStatuses: {},
    archivedAtOverride: undefined,
  };
}

function objectDetailLocalReducer(
  state: ObjectDetailLocalState,
  action: ObjectDetailLocalAction,
): ObjectDetailLocalState {
  return typeof action === 'function' ? action(state) : { ...state, ...action };
}

function applyObjectDetailOverrides(
  detail: ObjectDetail,
  overrides: Partial<Record<EditableField, EditableValue>>,
): ObjectDetail {
  return { ...detail, ...overrides } as ObjectDetail;
}

function applyObjectDetailLocalState(
  detail: ObjectDetail,
  localState: ObjectDetailLocalState,
): ObjectDetail {
  const serverNoteIds = new Set(detail.notes.map((note) => note.id));
  const deletedNoteIds = new Set(localState.deletedNoteIds);
  const pendingNotes = localState.pendingNotes.filter(
    (note) => !serverNoteIds.has(note.id) && !deletedNoteIds.has(note.id),
  );
  const notes = [...pendingNotes];
  for (const note of detail.notes) {
    if (!deletedNoteIds.has(note.id)) notes.push(localState.noteUpdates[note.id] ?? note);
  }
  const serverRelationshipIds = new Set(
    detail.relationships.map((relationship) => relationship.id),
  );
  const deletedRelationshipIds = new Set(localState.deletedRelationshipIds);
  const pendingRelationships = localState.pendingRelationships.filter(
    (relationship) =>
      !serverRelationshipIds.has(relationship.id) && !deletedRelationshipIds.has(relationship.id),
  );
  const relationships = [
    ...pendingRelationships,
    ...detail.relationships.filter((relationship) => !deletedRelationshipIds.has(relationship.id)),
  ];
  const recentChanges = detail.recentChanges.map((change) => {
    const status = localState.recentChangeStatuses[change.id];
    return status && change.status === 'suggested' ? { ...change, status } : change;
  });
  const archivedAt = detail.archivedAt ?? localState.archivedAtOverride ?? null;

  return { ...detail, notes, relationships, recentChanges, archivedAt };
}

export function ObjectDetailClient(props: Props) {
  return <ObjectDetailView key={props.detail.id} {...props} />;
}

function useObjectDetailController({ detail, userId, suggestions }: Props) {
  const router = useRouter();
  const timezone = useWorkspaceTimezone();
  const [pending, startTransition] = useTransition();
  const [repairPending, setRepairPending] = useState(false);
  const [
    {
      overrides,
      nameDraft,
      aliasesDraft,
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
  ] = useReducer(objectDetailUiReducer, { detail, timezone }, (input) =>
    initObjectDetailUiState(input.detail, input.timezone),
  );
  const [localDetailState, dispatchLocalDetail] = useReducer(
    objectDetailLocalReducer,
    detail,
    initObjectDetailLocalState,
  );
  const { linkQuery, selectedLink } = localDetailState;
  const trimmedLinkQuery = linkQuery.trim();
  const localDetail = useMemo(
    () => applyObjectDetailOverrides(detail, overrides),
    [detail, overrides],
  );
  const viewDetail = useMemo(
    () => applyObjectDetailLocalState(localDetail, localDetailState),
    [localDetail, localDetailState],
  );
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localDetailRef = useRef(detail);
  const serverDetailRef = useRef(detail);
  const queuedFieldValuesRef = useRef<Record<EditableField, EditableValue | undefined>>({
    canonicalName: undefined,
    aliases: undefined,
    status: undefined,
    stage: undefined,
    priority: undefined,
    dueAt: undefined,
  });
  const savingCountRef = useRef(0);
  const batchHadFailureRef = useRef(false);
  const focusedDraftsRef = useRef<Record<DraftField, boolean>>({
    canonicalName: false,
    aliases: false,
    stage: false,
    dueAt: false,
  });
  const savingDraftsRef = useRef<Record<DraftField, number>>({
    canonicalName: 0,
    aliases: 0,
    stage: 0,
    dueAt: 0,
  });
  const savingFieldsRef = useRef<Record<EditableField, number>>({
    canonicalName: 0,
    aliases: 0,
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
        canonicalName: next.canonicalName,
        aliases: next.aliases,
        status: next.status,
        stage: next.stage,
        priority: next.priority,
        dueAt: next.dueAt,
      },
    }));
  }

  const { data: linkResultsData } = useQuery<ObjectSearchResponse>({
    queryKey: queryKeys.objectSearch(trimmedLinkQuery, detail.id),
    enabled: trimmedLinkQuery.length > 0,
    staleTime: 0,
    gcTime: 30_000,
    placeholderData: (previousData) => previousData,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ q: trimmedLinkQuery, exclude: detail.id });
      const data = await readJson<{ results?: ObjectSearchResult[] }>(
        await fetch(`/api/objects/search?${params.toString()}`, { signal }),
      );
      return { query: trimmedLinkQuery, results: data.results };
    },
  });
  const visibleLinkResults = visibleObjectSearchResultsForQuery(linkResultsData, trimmedLinkQuery);

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
      if (field === 'canonicalName') {
        dispatchObjectUi({ nameDraft: editableObjectName(serverDetailRef.current) });
      }
      if (field === 'aliases') {
        dispatchObjectUi({ aliasesDraft: normalizeAliases(rollbackValue).join(', ') });
      }
      if (field === 'stage') {
        dispatchObjectUi({ stageDraft: rollbackValue === null ? '' : String(rollbackValue) });
      }
      if (field === 'dueAt') {
        dispatchObjectUi({ dueDraft: toLocalInputValue(rollbackValue, timezone) });
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
    const body = noteBody.trim();
    const tempId = `optimistic-note-${localMutationId()}`;
    const now = new Date();
    const optimisticNote: ObjectDetail['notes'][number] = {
      id: tempId,
      body,
      authorUserId: userId,
      createdAt: now,
      updatedAt: now,
    };
    dispatchLocalDetail((current) => ({
      ...current,
      pendingNotes: [optimisticNote, ...current.pendingNotes],
    }));
    dispatchObjectUi({ noteBody: '' });
    startTransition(async () => {
      const result = await createNoteAction({ entityId: detail.id, body });
      if ('error' in result && result.error) {
        dispatchLocalDetail((current) => ({
          ...current,
          pendingNotes: current.pendingNotes.filter((note) => note.id !== tempId),
        }));
        dispatchObjectUi({ error: result.error, noteBody: body });
      } else {
        const createdId = 'id' in result && typeof result.id === 'string' ? result.id : null;
        if (createdId) {
          dispatchLocalDetail((current) => ({
            ...current,
            pendingNotes: current.pendingNotes.map((note) =>
              note.id === tempId ? { ...note, id: createdId } : note,
            ),
          }));
        }
        router.refresh();
      }
    });
  }

  function saveNote(noteId: string, body: string): void {
    dispatchObjectUi({ error: null });
    const trimmedBody = body.trim();
    const currentNote = viewDetail.notes.find((note) => note.id === noteId);
    if (!currentNote) return;
    const previousNoteUpdates = localDetailState.noteUpdates;
    dispatchLocalDetail((current) => ({
      ...current,
      noteUpdates: {
        ...current.noteUpdates,
        [noteId]: {
          ...currentNote,
          id: noteId,
          body: trimmedBody,
          updatedAt: new Date(),
        },
      },
    }));
    dispatchObjectUi({ editingNoteId: null });
    startTransition(async () => {
      const result = await updateNoteAction({ noteId, entityId: detail.id, body: trimmedBody });
      if ('error' in result && result.error) {
        dispatchLocalDetail({ noteUpdates: previousNoteUpdates });
        dispatchObjectUi({ error: result.error, editingNoteId: noteId, editingBody: body });
      } else {
        router.refresh();
      }
    });
  }

  function deleteNote(noteId: string): void {
    dispatchObjectUi({ error: null });
    const previousDeletedNoteIds = localDetailState.deletedNoteIds;
    const previousPendingNotes = localDetailState.pendingNotes;
    dispatchLocalDetail((current) => ({
      ...current,
      deletedNoteIds: [...current.deletedNoteIds, noteId],
      pendingNotes: current.pendingNotes.filter((note) => note.id !== noteId),
    }));
    startTransition(async () => {
      const result = await deleteNoteAction({ noteId, entityId: detail.id });
      if ('error' in result && result.error) {
        dispatchLocalDetail({
          deletedNoteIds: previousDeletedNoteIds,
          pendingNotes: previousPendingNotes,
        });
        dispatchObjectUi({ error: result.error });
      } else router.refresh();
    });
  }

  function addRelationship(): void {
    const link = selectedLink;
    if (!link) return;
    dispatchObjectUi({ error: null });
    const tempId = `optimistic-relationship-${localMutationId()}`;
    const optimisticRelationship: ObjectDetail['relationships'][number] = {
      id: tempId,
      direction: 'out',
      kind: linkKind,
      otherId: link.id,
      otherName: link.canonicalName,
      otherType: link.type as ObjectDetail['relationships'][number]['otherType'],
    };
    dispatchLocalDetail((current) => ({
      ...current,
      linkQuery: '',
      selectedLink: null,
      pendingRelationships: [optimisticRelationship, ...current.pendingRelationships],
    }));
    startTransition(async () => {
      const result = await addRelationshipAction({
        fromEntityId: detail.id,
        toEntityId: link.id,
        kind: linkKind,
      });
      if ('error' in result && result.error) {
        dispatchLocalDetail((current) => ({
          ...current,
          pendingRelationships: current.pendingRelationships.filter(
            (relationship) => relationship.id !== tempId,
          ),
        }));
        dispatchObjectUi({ error: result.error });
      } else {
        const relationshipId = 'id' in result && typeof result.id === 'string' ? result.id : null;
        if (relationshipId) {
          dispatchLocalDetail((current) => ({
            ...current,
            pendingRelationships: current.pendingRelationships.map((relationship) =>
              relationship.id === tempId ? { ...relationship, id: relationshipId } : relationship,
            ),
          }));
        }
        router.refresh();
      }
    });
  }

  function removeRelationship(id: string, otherEntityId: string): void {
    dispatchObjectUi({ error: null });
    const previousDeletedRelationshipIds = localDetailState.deletedRelationshipIds;
    const previousPendingRelationships = localDetailState.pendingRelationships;
    dispatchLocalDetail((current) => ({
      ...current,
      deletedRelationshipIds: [...current.deletedRelationshipIds, id],
      pendingRelationships: current.pendingRelationships.filter(
        (relationship) => relationship.id !== id,
      ),
    }));
    startTransition(async () => {
      const result = await removeRelationshipAction({ id, entityId: detail.id, otherEntityId });
      if ('error' in result && result.error) {
        dispatchLocalDetail({
          deletedRelationshipIds: previousDeletedRelationshipIds,
          pendingRelationships: previousPendingRelationships,
        });
        dispatchObjectUi({ error: result.error });
      } else router.refresh();
    });
  }

  function acceptChange(changeId: string): void {
    dispatchObjectUi({ error: null });
    const previousRecentChangeStatuses = localDetailState.recentChangeStatuses;
    const previousDetail = localDetailRef.current;
    const change = viewDetail.recentChanges.find((item) => item.id === changeId);
    dispatchLocalDetail((current) => ({
      ...current,
      recentChangeStatuses: { ...current.recentChangeStatuses, [changeId]: 'applied' },
    }));
    if (change && isEditableFieldName(change.field)) {
      const localValue = editableValueFromChange(change.field, change.newValue);
      updateLocalDetail((current) => ({ ...current, [change.field]: localValue }));
      if (change.field === 'stage') {
        dispatchObjectUi({ stageDraft: localValue === null ? '' : String(localValue) });
      }
      if (change.field === 'canonicalName') {
        dispatchObjectUi({ nameDraft: localValue === null ? '' : String(localValue) });
      }
      if (change.field === 'aliases') {
        dispatchObjectUi({ aliasesDraft: normalizeAliases(localValue).join(', ') });
      }
      if (change.field === 'dueAt') {
        dispatchObjectUi({ dueDraft: toLocalInputValue(localValue, timezone) });
      }
    }
    startTransition(async () => {
      const result = await acceptObjectChangeAction({ changeId, entityId: detail.id });
      if ('error' in result && result.error) {
        dispatchLocalDetail({ recentChangeStatuses: previousRecentChangeStatuses });
        updateLocalDetail(() => previousDetail);
        dispatchObjectUi({
          nameDraft: editableObjectName(previousDetail),
          aliasesDraft: previousDetail.aliases.join(', '),
          stageDraft: previousDetail.stage ?? '',
          dueDraft: toLocalInputValue(previousDetail.dueAt, timezone),
        });
        dispatchObjectUi({ error: result.error });
      } else router.refresh();
    });
  }

  function rejectChange(changeId: string): void {
    dispatchObjectUi({ error: null });
    const previousRecentChangeStatuses = localDetailState.recentChangeStatuses;
    dispatchLocalDetail((current) => ({
      ...current,
      recentChangeStatuses: { ...current.recentChangeStatuses, [changeId]: 'rejected' },
    }));
    startTransition(async () => {
      const result = await rejectObjectChangeAction({ changeId, entityId: detail.id });
      if ('error' in result && result.error) {
        dispatchLocalDetail({ recentChangeStatuses: previousRecentChangeStatuses });
        dispatchObjectUi({ error: result.error });
      } else router.refresh();
    });
  }

  function archiveObject(): void {
    dispatchObjectUi({ error: null });
    const previousArchivedAtOverride = localDetailState.archivedAtOverride;
    dispatchLocalDetail({ archivedAtOverride: new Date() });
    startTransition(async () => {
      const result = await archiveObjectAction({ id: detail.id });
      if ('error' in result && result.error) {
        dispatchLocalDetail({ archivedAtOverride: previousArchivedAtOverride });
        dispatchObjectUi({ error: result.error });
      } else router.refresh();
    });
  }

  function repairMemory(): void {
    dispatchObjectUi({ error: null });
    setRepairPending(true);
    startTransition(async () => {
      try {
        const result = await repairObjectMemoryAction({ id: detail.id });
        if ('error' in result && result.error) {
          dispatchObjectUi({ error: result.error });
        } else router.refresh();
      } finally {
        setRepairPending(false);
      }
    });
  }

  return {
    acceptChange,
    addNote,
    addRelationship,
    archiveObject,
    detail,
    dispatchLocalDetail,
    dispatchObjectUi,
    dueDraft,
    editingBody,
    editingNoteId,
    error,
    focusedDraftsRef,
    aliasesDraft,
    linkKind,
    linkQuery,
    localDetail,
    nameDraft,
    noteBody,
    patch,
    pending,
    repairPending,
    rejectChange,
    repairMemory,
    removeRelationship,
    saveNote,
    savingCount,
    saveState,
    selectedLink,
    stageDraft,
    suggestions,
    userId,
    viewDetail,
    visibleLinkResults,
    deleteNote,
  };
}

function ObjectDetailView(props: Props) {
  const view = useObjectDetailController(props);
  return (
    <div className="space-y-5">
      <ObjectDetailHeader
        detail={view.viewDetail}
        initialPinned={props.initialPinned ?? false}
        error={view.error}
        pending={view.pending}
        repairPending={view.repairPending}
        saveState={view.saveState}
        savingCount={view.savingCount}
        onRepairMemory={view.repairMemory}
      />
      <WorkSubnav current={`/app/objects/${view.detail.id}`} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <main className="min-w-0 space-y-6">
          {view.suggestions.length > 0 ? (
            <ApprovalsClient
              suggestions={view.suggestions}
              allowBulkAccept={false}
              taskCategoriesEnabled={props.taskCategoriesEnabled}
              folded={{
                title: 'Pending approvals',
                summary: {
                  singular: 'waiting',
                  plural: 'waiting',
                },
                className: 'border border-signal/40 bg-signal-soft/20',
                summaryClassName: 'cursor-pointer list-none px-4 py-3',
                bodyClassName: 'border-t border-border p-4',
                titleClassName: 'text-sm font-semibold tracking-tight',
                countClassName: 'mt-1 text-xs text-fg-muted',
                openLabelClassName: 'text-[11px] text-fg-dim',
              }}
            />
          ) : null}

          <ObjectSummaryPanel detail={view.viewDetail} />
          <ObjectProvenancePanel provenance={view.viewDetail.provenance} />
          <ObjectConnectedWorkSection connectedWork={view.detail.connectedWork} />

          <ObjectPanel title="Evidence" eyebrow="events">
            <ObjectSectionFeed
              objectId={view.detail.id}
              section="events"
              title="Timeline events"
              showTitle={false}
            />
          </ObjectPanel>

          <ObjectPanel title="Facts" eyebrow="extracted">
            <ObjectSectionFeed
              objectId={view.detail.id}
              section="facts"
              title="Facts"
              showTitle={false}
            />
          </ObjectPanel>

          <ObjectNotesSection
            notes={view.viewDetail.notes}
            userId={view.userId}
            pending={view.pending}
            noteBody={view.noteBody}
            editingNoteId={view.editingNoteId}
            editingBody={view.editingBody}
            dispatchObjectUi={view.dispatchObjectUi}
            onAddNote={view.addNote}
            onSaveNote={view.saveNote}
            onDeleteNote={view.deleteNote}
          />
        </main>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-6">
          <ObjectContactSection detail={view.viewDetail} />

          <ObjectPanel title="Fields" eyebrow="editable">
            <ObjectEditableFields
              detail={view.localDetail}
              nameDraft={view.nameDraft}
              aliasesDraft={view.aliasesDraft}
              stageDraft={view.stageDraft}
              dueDraft={view.dueDraft}
              focusedDraftsRef={view.focusedDraftsRef}
              patch={view.patch}
              dispatchObjectUi={view.dispatchObjectUi}
              projects={props.projects}
              primaryProject={props.primaryProject}
              taskCategoriesEnabled={props.taskCategoriesEnabled}
              className="grid-cols-1 gap-4"
            />
          </ObjectPanel>

          <ObjectRelationshipsSection
            sourceType={view.viewDetail.type}
            relationships={view.viewDetail.relationships}
            pending={view.pending}
            linkQuery={view.linkQuery}
            linkResults={view.visibleLinkResults}
            selectedLink={view.selectedLink}
            linkKind={view.linkKind}
            onLinkQueryChange={(value) => {
              view.dispatchLocalDetail({ linkQuery: value, selectedLink: null });
            }}
            onSelectLink={(link) => {
              view.dispatchLocalDetail({ selectedLink: link });
            }}
            dispatchObjectUi={view.dispatchObjectUi}
            onAddRelationship={view.addRelationship}
            onRemoveRelationship={view.removeRelationship}
          />

          <ObjectRecentChangesSection
            changes={view.viewDetail.recentChanges}
            pending={view.pending}
            onAcceptChange={view.acceptChange}
            onRejectChange={view.rejectChange}
          />

          <ObjectArchiveFooter
            archivedAt={view.viewDetail.archivedAt}
            pending={view.pending}
            onArchiveObject={view.archiveObject}
          />
        </aside>
      </div>
    </div>
  );
}

function ObjectContactSection({ detail }: { detail: ObjectDetail }) {
  const contacts = detail.identityFacets.filter(
    (facet) => facet.kind === 'email' || facet.kind === 'phone',
  );
  if (detail.type !== 'person' || contacts.length === 0) return null;

  return (
    <ObjectPanel title="Contact" eyebrow={`${contacts.length} saved`}>
      <div className="space-y-2">
        {contacts.map((facet) => {
          const href =
            facet.kind === 'email'
              ? `mailto:${facet.normalizedValue}`
              : `tel:${facet.normalizedValue}`;
          return (
            <a
              key={facet.id}
              href={href}
              className="flex min-w-0 items-center justify-between gap-3 border border-border px-3 py-2 text-sm transition hover:border-signal/60 hover:bg-signal-soft/20"
            >
              <span className="min-w-0 truncate">{facet.value}</span>
              <span className="shrink-0 text-[11px] text-fg-dim">{statusLabel(facet.kind)}</span>
            </a>
          );
        })}
      </div>
    </ObjectPanel>
  );
}

function ObjectPanel({
  title,
  eyebrow,
  className,
  children,
}: {
  title: string;
  eyebrow?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('border border-border bg-bg', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {eyebrow ? <span className="text-[11px] text-fg-dim">{eyebrow}</span> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ObjectSummaryPanel({ detail }: { detail: ObjectDetail }) {
  const timezone = useWorkspaceTimezone();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const summary = detail.summary ?? null;
  const generated = summary?.summary ?? null;
  const [error, setError] = useReducer(
    (_state: string | null, value: string | null) => value,
    null,
  );
  const canRequest =
    Boolean(summary?.canGenerate) &&
    (summary?.status === 'missing' || summary?.status === 'failed' || summary?.status === 'stale');
  const actionLabel = summary?.status === 'failed' ? 'Retry' : 'Generate summary';
  const eyebrow =
    summary?.status === 'ready'
      ? 'generated'
      : summary?.status === 'stale'
        ? 'updating'
        : summary?.status === 'failed'
          ? 'failed'
          : summary?.status === 'pending'
            ? 'pending'
            : 'available';

  function requestSummary(): void {
    setError(null);
    startTransition(() => {
      void generateObjectSummaryAction({ entityId: detail.id }).then((result) => {
        if ('error' in result && result.error) {
          setError(result.error);
          return;
        }
        router.refresh();
      });
    });
  }

  return (
    <ObjectPanel title="Summary" eyebrow={eyebrow}>
      {generated ? (
        <div className="space-y-4">
          <p className="max-w-4xl text-sm leading-6 text-fg">{generated.overview}</p>
          {generated.currentState.length > 0 ? (
            <ul className="space-y-2">
              {generated.currentState.map((item) => (
                <li key={`${item.label}:${item.text}`} className="text-sm leading-6 text-fg-muted">
                  <span className="font-medium text-fg">{item.label}:</span> {item.text}
                  <SourceChips refs={item.sourceRefs} />
                </li>
              ))}
            </ul>
          ) : null}
          {generated.conflicts.length > 0 || generated.openQuestions.length > 0 ? (
            <div className="space-y-2 border-t border-border pt-3">
              {[...generated.conflicts, ...generated.openQuestions].map((item) => (
                <p key={`${item.label}:${item.text}`} className="text-sm leading-6 text-fg-muted">
                  <span className="font-medium text-fg">{item.label}:</span> {item.text}
                  <SourceChips refs={item.sourceRefs} />
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-fg-muted">
          {summary?.canGenerate ? 'Summary is ready to generate.' : 'Not enough object memory yet.'}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-xs text-fg-dim">
          {summary?.generatedAt
            ? `Updated ${formatDisplayDateTime(summary.generatedAt, { timezone })} · ${
                summary.sourceRefs.length
              } sources`
            : summary?.status === 'pending'
              ? 'Generating'
              : summary?.status === 'missing' && summary.canGenerate
                ? 'Ready to generate'
                : summary?.lastErrorCode
                  ? 'Update failed'
                  : 'No summary yet'}
        </p>
        {canRequest ? (
          <button
            type="button"
            className="border border-border bg-bg px-3 py-2 text-xs text-fg transition hover:border-fg disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            onClick={requestSummary}
          >
            {pending ? 'Generating…' : actionLabel}
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </ObjectPanel>
  );
}

function SourceChips({ refs }: { refs: objects.ObjectSummarySourceRef[] }) {
  if (refs.length === 0) return null;
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
      {refs.slice(0, 3).map((ref) => {
        const artifactRef = summaryRefToArtifactRef(ref);
        const className =
          'border border-border bg-bg px-1.5 py-0.5 text-[11px] text-fg-dim hover:border-signal hover:text-signal';
        return artifactRef ? (
          <ArtifactReferenceChip
            key={`${ref.kind}:${ref.id}`}
            refValue={artifactRef}
            className={className}
            title={`Open ${sourceLabel(ref)} source`}
          >
            {sourceLabel(ref)}
          </ArtifactReferenceChip>
        ) : (
          <span key={`${ref.kind}:${ref.id}`} className={className}>
            {sourceLabel(ref)}
          </span>
        );
      })}
    </span>
  );
}

function summaryRefToArtifactRef(ref: objects.ObjectSummarySourceRef): ArtifactRef | null {
  if (ref.kind === 'timeline_event') return { kind: 'timeline_event', id: ref.id };
  if (ref.kind === 'object_note') return { kind: 'object_note', id: ref.id };
  if (ref.kind === 'task') return { kind: 'task', id: ref.id };
  if (ref.kind === 'fact') return { kind: 'fact', id: ref.id };
  if (ref.kind === 'relationship') return { kind: 'relationship', id: ref.id };
  if (ref.kind === 'object_change') return { kind: 'object_change', id: ref.id };
  return null;
}

function sourceLabel(ref: objects.ObjectSummarySourceRef): string {
  if (ref.kind === 'timeline_event') return 'event';
  if (ref.kind === 'object_note') return 'note';
  if (ref.kind === 'object_change') return 'change';
  return ref.kind;
}

function ObjectProvenancePanel({ provenance }: { provenance: ObjectDetail['provenance'] }) {
  const hasProvenance =
    provenance.whyThisExists.length > 0 ||
    provenance.whatChangedIt.length > 0 ||
    provenance.relatedEvidence.length > 0;
  return (
    <ObjectPanel title="Provenance" eyebrow="source backed">
      {!hasProvenance ? (
        <p className="text-sm text-fg-muted">No source provenance linked yet.</p>
      ) : (
        <div className="divide-y divide-border">
          <ProvenanceGroup
            title="Why this exists"
            empty="No accepted creation evidence yet."
            entries={provenance.whyThisExists}
            previewCount={1}
            sourceKind="creation"
          />
          <ProvenanceGroup
            title="What changed it"
            empty="No accepted update evidence yet."
            entries={provenance.whatChangedIt}
            previewCount={2}
            sourceKind="change"
          />
          <ProvenanceGroup
            title="Related evidence"
            empty="No observed related evidence yet."
            entries={provenance.relatedEvidence}
            previewCount={0}
            sourceKind="related"
            muted
          />
        </div>
      )}
    </ObjectPanel>
  );
}

function ProvenanceGroup({
  title,
  empty,
  entries,
  previewCount,
  sourceKind,
  muted = false,
}: {
  title: string;
  empty: string;
  entries: ObjectDetail['provenance']['whyThisExists'];
  previewCount: number;
  sourceKind: 'creation' | 'change' | 'related';
  muted?: boolean;
}) {
  const previewEntries = entries.slice(0, previewCount);
  const remainingEntries = entries.slice(previewCount);
  const sourceCountValue = provenanceEvidenceCount(entries);
  const remainingSourceCount = provenanceEvidenceCount(remainingEntries);
  const sourceCount = `${sourceCountValue} source${sourceCountValue === 1 ? '' : 's'}`;
  const reviewLabel = `Review ${remainingSourceCount}${
    previewCount > 0 ? ' more' : ''
  } ${sourceKind} source${remainingSourceCount === 1 ? '' : 's'}`;
  return (
    <section className="grid min-w-0 gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <div>
        <h3 className="text-xs text-fg-muted">{title}</h3>
        <p className="mt-1 text-[11px] text-fg-dim">{sourceCount}</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-fg-muted">{empty}</p>
      ) : (
        <div className="min-w-0">
          {previewEntries.length > 0 ? (
            <ProvenanceEntryList entries={previewEntries} muted={muted} />
          ) : null}
          {remainingEntries.length > 0 ? (
            <details
              className={cn('group border border-border', previewEntries.length > 0 && 'mt-3')}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-surface px-3 py-2 text-xs text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
                <span>{reviewLabel}</span>
                <span aria-hidden="true" className="text-fg-dim group-open:hidden">
                  +
                </span>
                <span aria-hidden="true" className="hidden text-fg-dim group-open:inline">
                  −
                </span>
              </summary>
              <div className="max-h-80 overflow-y-auto overscroll-contain border-t border-border p-3">
                <ProvenanceEntryList entries={remainingEntries} muted={muted} />
              </div>
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}

function provenanceEvidenceCount(entries: ObjectDetail['provenance']['whyThisExists']): number {
  return entries.reduce((count, entry) => count + entry.evidence.length, 0);
}

function timelinePreview(contentText: string | null): string {
  const cleaned = displayText(contentText ?? 'Timeline event')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= 160) return cleaned;
  return `${cleaned.slice(0, 157)}...`;
}

function ProvenanceEntryList({
  entries,
  muted,
}: {
  entries: ObjectDetail['provenance']['whyThisExists'];
  muted: boolean;
}) {
  return (
    <ul className="space-y-3">
      {entries.map((entry) => (
        <li
          key={`${entry.targetKind}:${entry.operation}:${entry.id}`}
          className={cn(
            'min-w-0 border-l-2 border-signal/50 bg-surface px-3 py-2 text-sm',
            muted && 'border-border bg-bg text-fg-muted',
          )}
        >
          <p className="line-clamp-2 break-words font-medium leading-5 text-fg">
            {timelinePreview(entry.title)}
          </p>
          {entry.reason ? (
            <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-fg-muted">
              {displayText(entry.reason)}
            </p>
          ) : null}
          <ProvenanceSourceLinks evidence={entry.evidence} />
        </li>
      ))}
    </ul>
  );
}

function ProvenanceSourceLinks({
  evidence,
}: {
  evidence: ObjectDetail['provenance']['whyThisExists'][number]['evidence'];
}) {
  const visibleEvidence = evidence.slice(0, 3);
  const remainingEvidence = evidence.slice(3);
  return (
    <div className="mt-2 space-y-1">
      {visibleEvidence.map((source) => (
        <ProvenanceSourceLink key={source.rawEventId} source={source} />
      ))}
      {remainingEvidence.length > 0 ? (
        <details className="pt-1">
          <summary className="cursor-pointer list-none text-[11px] text-fg-dim hover:text-fg">
            Review {remainingEvidence.length} more source
            {remainingEvidence.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto overscroll-contain border-l border-border pl-2">
            {remainingEvidence.map((source) => (
              <ProvenanceSourceLink key={source.rawEventId} source={source} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ProvenanceSourceLink({
  source,
}: {
  source: ObjectDetail['provenance']['whyThisExists'][number]['evidence'][number];
}) {
  const timezone = useWorkspaceTimezone();
  return (
    <Link
      href={`/app/timeline?event=${source.rawEventId}#ev-${source.rawEventId}`}
      className="block break-words text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
    >
      {displayText(source.source)} · {formatDisplayDateTime(source.occurredAt, { timezone })}
    </Link>
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
  initialPinned,
  error,
  pending,
  repairPending,
  saveState,
  savingCount,
  onRepairMemory,
}: {
  detail: ObjectDetail;
  initialPinned: boolean;
  error: string | null;
  pending: boolean;
  repairPending: boolean;
  saveState: SaveState;
  savingCount: number;
  onRepairMemory: () => void;
}) {
  const pendingCount = detail.recentChanges.filter((c) => c.status === 'suggested').length;
  const visibleAliases = detail.aliases.filter((alias) => !isInternalIdentifier(alias));
  const hasAlerts =
    detail.newSinceLastVisit > 0 || pendingCount > 0 || error !== null || saveState !== 'idle';
  return (
    <header className="border-b border-border pb-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-dim">
            <span className="text-fg-muted">{statusLabel(detail.type)}</span>
          </div>
          {detail.type === 'task' ? (
            <LiveTaskCategoryBadge
              taskId={detail.id}
              category={detail.taskCategory}
              status={detail.taskCategoryStatus}
              updatedAt={detail.taskCategoryUpdatedAt}
              className="mt-2"
            />
          ) : null}
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg">
            {displayText(displayObjectTitle(detail))}
          </h1>
          {visibleAliases.length > 0 && (
            <p className="mt-2 text-xs text-fg-dim">
              aka {visibleAliases.map((alias) => displayText(alias)).join(' · ')}
            </p>
          )}
          {hasAlerts ? (
            <div className="mt-3 flex flex-col gap-2">
              {detail.newSinceLastVisit > 0 && (
                <output className="rounded-sm border border-signal/40 bg-signal-soft px-3 py-2 text-xs text-signal">
                  {detail.newSinceLastVisit} new change
                  {detail.newSinceLastVisit === 1 ? '' : 's'} since your last visit
                </output>
              )}
              {pendingCount > 0 ? (
                <output className="rounded-sm border border-signal/40 bg-signal-soft px-3 py-2 text-xs text-signal">
                  {pendingCount} suggestion{pendingCount === 1 ? '' : 's'} awaiting review
                </output>
              ) : null}
              {error ? (
                <div
                  role="alert"
                  className="rounded-sm border border-danger/40 bg-bg px-3 py-2 text-xs text-danger"
                >
                  {error}
                </div>
              ) : null}
              {saveState !== 'idle' ? (
                <output aria-live="polite" className="text-xs text-fg-dim">
                  {saveState === 'saving'
                    ? `Saving${savingCount > 1 ? ` ${savingCount} changes` : ''}...`
                    : 'Saved'}
                </output>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <ObjectPinButton objectId={detail.id} initialPinned={initialPinned} compact />
          <ChatViewContextBinder
            viewKey={`object:${detail.id}`}
            kind="object"
            href={`/app/objects/${detail.id}`}
            label={displayObjectTitle(detail)}
            objectId={detail.id}
          />
          {detail.type === 'project' && detail.archivedAt === null ? (
            <Link
              href={`/app/objects/new?project=${encodeURIComponent(detail.id)}&returnTo=${encodeURIComponent(`/app/objects/${detail.id}`)}`}
              className="rounded-sm border border-signal/40 bg-signal-soft px-3 py-1.5 text-xs font-medium text-signal hover:bg-signal/20"
            >
              Add task
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onRepairMemory}
            disabled={pending || repairPending || detail.archivedAt !== null}
            title={
              detail.archivedAt
                ? 'Unarchive this object before repairing memory'
                : 'Queue object-scoped duplicate cleanup'
            }
            className="rounded-sm border border-border bg-surface px-3 py-1.5 text-xs text-fg-muted transition hover:border-signal/50 hover:text-signal disabled:cursor-not-allowed disabled:opacity-50"
          >
            {detail.archivedAt
              ? 'Repair unavailable'
              : repairPending
                ? 'Repairing…'
                : 'Repair memory'}
          </button>
        </div>
      </div>
      <TechnicalDetails
        className="mt-4"
        items={[{ label: 'Object ID', value: detail.id, copyValue: detail.id }]}
      />
    </header>
  );
}

function ObjectEditableFields({
  detail,
  nameDraft,
  aliasesDraft,
  stageDraft,
  dueDraft,
  focusedDraftsRef,
  patch,
  dispatchObjectUi,
  projects = EMPTY_PROJECT_OPTIONS,
  primaryProject = null,
  taskCategoriesEnabled = true,
  className = 'grid-cols-1 gap-6 sm:grid-cols-2',
}: {
  detail: ObjectDetail;
  nameDraft: string;
  aliasesDraft: string;
  stageDraft: string;
  dueDraft: string;
  focusedDraftsRef: RefObject<Record<DraftField, boolean>>;
  patch: (field: EditableField, value: EditableValue) => void;
  dispatchObjectUi: Dispatch<ObjectDetailUiAction>;
  projects?: { id: string; label: string }[];
  primaryProject?: objects.TaskPrimaryProjectRow | null;
  taskCategoriesEnabled?: boolean;
  className?: string;
}) {
  const options = statusOptions(detail.type);
  return (
    <section className={cn('grid', className)}>
      {detail.type === 'task' && detail.archivedAt ? (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          Unarchive this task to change its project or category.
        </p>
      ) : detail.type === 'task' ? (
        <>
          <Field label="Project">
            <TaskProjectSelect
              taskId={detail.id}
              projectId={primaryProject?.projectId ?? null}
              currentProjectLabel={primaryProject?.projectName}
              projectArchived={Boolean(primaryProject?.archivedAt)}
              projects={projects}
            />
          </Field>
          {taskCategoriesEnabled ? (
            <Field label="Category">
              <TaskCategorySelect
                taskId={detail.id}
                category={detail.taskCategory}
                mode={detail.taskCategoryMode}
                status={detail.taskCategoryStatus}
                updatedAt={detail.taskCategoryUpdatedAt}
              />
            </Field>
          ) : null}
        </>
      ) : null}
      <Field label="Name">
        <input
          aria-label="Name"
          value={nameDraft}
          onFocus={() => {
            focusedDraftsRef.current.canonicalName = true;
          }}
          onChange={(e) => {
            dispatchObjectUi({ nameDraft: e.target.value });
          }}
          onBlur={(e) => {
            focusedDraftsRef.current.canonicalName = false;
            const v = e.target.value.trim();
            if (v === '') {
              dispatchObjectUi({ nameDraft: editableObjectName(detail) });
              return;
            }
            dispatchObjectUi({ nameDraft: v });
            if (v === editableObjectName(detail)) return;
            patch('canonicalName', v);
          }}
          className="w-full rounded-md border bg-surface px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Aliases">
        <input
          aria-label="Aliases"
          value={aliasesDraft}
          onFocus={() => {
            focusedDraftsRef.current.aliases = true;
          }}
          onChange={(e) => {
            dispatchObjectUi({ aliasesDraft: e.target.value });
          }}
          onBlur={(e) => {
            focusedDraftsRef.current.aliases = false;
            const aliases = parseAliases(e.target.value, nameDraft);
            dispatchObjectUi({ aliasesDraft: aliases.join(', ') });
            patch('aliases', aliases);
          }}
          placeholder="Acme, Acme Corp"
          className="w-full rounded-md border bg-surface px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Status">
        <select
          value={detail.status}
          onChange={(e) => {
            patch('status', e.target.value);
          }}
          className="w-full rounded-md border bg-surface px-3 py-2 text-sm"
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
          {!options.includes(detail.status) && (
            <option value={detail.status}>{statusLabel(detail.status)}</option>
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
          className="w-full rounded-md border bg-surface px-3 py-2 text-sm"
          placeholder="e.g. discovery"
        />
      </Field>
      <Field label="Priority">
        <select
          value={detail.priority ?? ''}
          onChange={(e) => {
            patch('priority', e.target.value === '' ? null : Number(e.target.value));
          }}
          className="w-full rounded-md border bg-surface px-3 py-2 text-sm"
        >
          <option value="">None</option>
          <option value="1">1 (urgent)</option>
          <option value="2">2 (high)</option>
          <option value="3">3 (normal)</option>
          <option value="4">4 (low)</option>
        </select>
      </Field>
      {isSchedulableObjectType(detail.type) ? (
        <Field label="Due date">
          <input
            aria-label="Due date"
            type="date"
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
              patch('dueAt', v === '' ? null : new Date(`${v}T00:00:00.000Z`));
            }}
            className="w-full rounded-md border bg-surface px-3 py-2 text-sm"
          />
          <DueDateDisplay value={detail.dueAt} variant="field-hint" className="mt-1 block" />
        </Field>
      ) : null}
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
    <ObjectPanel title="Notes" eyebrow={`${notes.length} saved`}>
      <div className="mb-4 space-y-2">
        <textarea
          aria-label="New note"
          value={noteBody}
          onChange={(e) => {
            dispatchObjectUi({ noteBody: e.target.value });
          }}
          placeholder="Add a note. Each note also lands on the timeline."
          className="w-full rounded-md border bg-surface px-3 py-2 text-sm"
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
    </ObjectPanel>
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
  const timezone = useWorkspaceTimezone();
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
            className="w-full rounded-md border bg-surface px-3 py-2 text-sm"
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
        <div className="whitespace-pre-wrap">{displayText(note.body, { timezone })}</div>
      )}
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{formatDisplayDateTime(note.createdAt, { timezone })}</span>
        {isOwner && !isEditing ? (
          <ItemActionGroup
            label={`Actions for note from ${formatDisplayDateTime(note.createdAt, { timezone })}`}
          >
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
          </ItemActionGroup>
        ) : null}
      </div>
    </li>
  );
}

function ObjectConnectedWorkSection({
  connectedWork,
}: {
  connectedWork: ObjectDetail['connectedWork'];
}) {
  const hasWork =
    connectedWork.openTasks.length > 0 ||
    connectedWork.recentTasks.length > 0 ||
    connectedWork.calendarEvents.length > 0 ||
    connectedWork.objects.length > 0 ||
    connectedWork.boards.length > 0 ||
    connectedWork.pendingApprovals.length > 0 ||
    connectedWork.documents.length > 0 ||
    connectedWork.links.length > 0 ||
    connectedWork.capturedFiles.length > 0;
  return (
    <ObjectPanel title="Connected work" eyebrow="live context">
      {!hasWork ? (
        <p className="text-sm text-muted-foreground">No connected work found yet.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <ConnectedTaskList
            title="Open tasks"
            empty="No open tasks found."
            tasks={connectedWork.openTasks}
          />
          <ConnectedCalendarList events={connectedWork.calendarEvents} />
          <ConnectedObjectList objects={connectedWork.objects} />
          <ConnectedBoardList boards={connectedWork.boards} />
          <ConnectedApprovalList approvals={connectedWork.pendingApprovals} />
          <ConnectedTaskList
            title="Recent history"
            empty="No completed tasks found."
            tasks={connectedWork.recentTasks}
          />
          <ConnectedLinkList links={connectedWork.links} />
          <ConnectedCapturedFileList files={connectedWork.capturedFiles} />
          <ConnectedDocumentList documents={connectedWork.documents} />
        </div>
      )}
    </ObjectPanel>
  );
}

function ConnectedWorkSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 text-xs text-fg-muted">{title}</h3>
      {children}
    </section>
  );
}

function ConnectedTaskList({
  title,
  empty,
  tasks,
}: {
  title: string;
  empty: string;
  tasks: ObjectDetail['connectedWork']['openTasks'];
}) {
  return (
    <ConnectedWorkSection title={title}>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="grid gap-1 rounded-sm border border-border bg-surface px-3 py-2 text-sm"
            >
              <a href={`/app/objects/${task.id}`} className="font-medium hover:underline">
                {displayText(displayObjectTitle(task))}
              </a>
              <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-fg-dim">
                <span>{statusLabel(task.status)}</span>
                <DueDateDisplay value={task.dueAt} variant="compact" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </ConnectedWorkSection>
  );
}

function ConnectedCalendarList({
  events,
}: {
  events: ObjectDetail['connectedWork']['calendarEvents'];
}) {
  const timezone = useWorkspaceTimezone();
  return (
    <ConnectedWorkSection title="Calendar">
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No calendar events found.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="grid gap-1 rounded-sm border border-border bg-surface px-3 py-2 text-sm"
            >
              <span className="font-medium">{displayText(event.title)}</span>
              <span className="text-[11px] text-fg-dim">
                {formatDisplayDateTime(event.startAt, { timezone })} · {statusLabel(event.showAs)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ConnectedWorkSection>
  );
}

function ConnectedObjectList({ objects }: { objects: ObjectDetail['connectedWork']['objects'] }) {
  return (
    <ConnectedWorkSection title="People and objects">
      {objects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No repeated object context found.</p>
      ) : (
        <ul className="space-y-2">
          {objects.map((object) => (
            <li
              key={object.id}
              className="grid gap-1 rounded-sm border border-border bg-surface px-3 py-2 text-sm"
            >
              <a href={`/app/objects/${object.id}`} className="font-medium hover:underline">
                {displayText(object.canonicalName)}
              </a>
              <span className="text-[11px] text-fg-dim">
                {statusLabel(object.type)} · {object.factCount} fact
                {object.factCount === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ConnectedWorkSection>
  );
}

function ConnectedBoardList({ boards }: { boards: ObjectDetail['connectedWork']['boards'] }) {
  return (
    <ConnectedWorkSection title="Boards">
      {boards.length === 0 ? (
        <p className="text-sm text-muted-foreground">No board context found.</p>
      ) : (
        <ul className="space-y-2">
          {boards.map((board) => (
            <li
              key={board.itemId}
              className="grid gap-1 rounded-sm border border-border bg-surface px-3 py-2 text-sm"
            >
              <a
                href={`/app/boards/${board.boardId}?item=${board.itemId}`}
                className="font-medium hover:underline"
              >
                {displayText(board.boardName)}
              </a>
              <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-fg-dim">
                <span>{board.laneName ?? 'no lane'}</span>
                <DueDateDisplay value={board.dueAt} variant="compact" />
                {board.priority !== null ? <span>· P{board.priority}</span> : null}
              </span>
              {board.nextStep ? (
                <span className="text-xs text-muted-foreground">{displayText(board.nextStep)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </ConnectedWorkSection>
  );
}

function ConnectedApprovalList({
  approvals,
}: {
  approvals: ObjectDetail['connectedWork']['pendingApprovals'];
}) {
  return (
    <ConnectedWorkSection title="Pending approvals">
      {approvals.length === 0 ? (
        <p className="text-sm text-muted-foreground">No related approvals found.</p>
      ) : (
        <ul className="space-y-2">
          {approvals.map((approval) => (
            <li
              key={approval.itemId}
              className="grid gap-1 rounded-sm border border-signal/40 bg-signal-soft/20 px-3 py-2 text-sm"
            >
              <Link href="/app/approvals" className="font-medium hover:underline">
                {displayText(approval.title)}
              </Link>
              <span className="text-[11px] text-fg-dim">
                {approval.operation} · {approval.targetKind}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ConnectedWorkSection>
  );
}

function ConnectedDocumentList({
  documents,
}: {
  documents: ObjectDetail['connectedWork']['documents'];
}) {
  const timezone = useWorkspaceTimezone();
  return (
    <ConnectedWorkSection title="Documents">
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No related documents found.</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((document) => (
            <li
              key={document.id}
              className="grid gap-1 rounded-sm border border-border bg-surface px-3 py-2 text-sm"
            >
              <a
                href={`/app/documents/${document.id}`}
                title={document.name}
                className="font-medium hover:underline"
              >
                {displayText(truncateFilenameMiddle(document.name))}
              </a>
              <span className="text-[11px] text-fg-dim">
                {document.fileKind} · updated{' '}
                {formatDisplayDateTime(document.updatedAt, { timezone })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ConnectedWorkSection>
  );
}

function ConnectedLinkList({ links }: { links: ObjectDetail['connectedWork']['links'] }) {
  const timezone = useWorkspaceTimezone();
  return (
    <ConnectedWorkSection title="Links">
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No related links found.</p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="grid gap-1 rounded-sm border border-border bg-surface px-3 py-2 text-sm"
            >
              {link.canonicalUrl ? (
                <a
                  href={link.canonicalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                >
                  {displayText(link.displayUrl ?? link.canonicalName)}
                </a>
              ) : (
                <span className="font-medium">{displayText(link.canonicalName)}</span>
              )}
              <span className="text-[11px] text-fg-dim">
                {link.provider ?? link.domain ?? 'shared link'} · updated{' '}
                {formatDisplayDateTime(link.updatedAt, { timezone })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ConnectedWorkSection>
  );
}

function ConnectedCapturedFileList({
  files,
}: {
  files: ObjectDetail['connectedWork']['capturedFiles'];
}) {
  const timezone = useWorkspaceTimezone();
  return (
    <ConnectedWorkSection title="Files">
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No related files found.</p>
      ) : (
        <ul className="space-y-2">
          {files.map((file) => (
            <li
              key={file.id}
              className="grid gap-1 rounded-sm border border-border bg-surface px-3 py-2 text-sm"
            >
              <Link href="/app/documents/captured" className="font-medium hover:underline">
                {displayText(truncateFilenameMiddle(file.name))}
              </Link>
              <span className="text-[11px] text-fg-dim">
                {file.contentType ?? 'captured file'} · updated{' '}
                {formatDisplayDateTime(file.updatedAt, { timezone })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ConnectedWorkSection>
  );
}

function ObjectRelationshipsSection({
  sourceType,
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
  sourceType: objects.ObjectType;
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
  const projectFieldOwnsLink = sourceType === 'task' && selectedLink?.type === 'project';
  const availableKinds = projectFieldOwnsLink
    ? RELATIONSHIP_KINDS.filter((kind) => kind !== 'child')
    : RELATIONSHIP_KINDS;
  return (
    <ObjectPanel title="Related" eyebrow={String(relationships.length)}>
      <div className="mb-4 grid gap-2">
        <label>
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
            Link to object
          </span>
          <input
            value={linkQuery}
            onChange={(e) => {
              onLinkQueryChange(e.target.value);
            }}
            placeholder="Search objects"
            className="w-full rounded-md border bg-surface px-3 py-2 text-sm"
          />
        </label>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
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
              className="w-full rounded-md border bg-surface px-3 py-2 text-sm"
            >
              {availableKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !selectedLink || (projectFieldOwnsLink && linkKind === 'child')}
            onClick={onAddRelationship}
            className="rounded-md border border-signal/40 bg-signal-soft px-3 py-2 text-sm text-signal hover:bg-signal/25 disabled:opacity-50"
          >
            Link
          </button>
        </div>
      </div>
      {selectedLink ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Selected {displayText(selectedLink.canonicalName)} · {selectedLink.type}
          {projectFieldOwnsLink ? ' · use the Project field for primary membership' : ''}
        </p>
      ) : linkResults.length > 0 ? (
        <ul className="mb-3 grid gap-1">
          {linkResults.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                className="w-full rounded-sm border border-border px-3 py-2 text-left text-sm hover:bg-surface"
                onClick={() => {
                  onLinkQueryChange(result.canonicalName);
                  onSelectLink(result);
                }}
              >
                <span className="font-medium">{displayText(result.canonicalName)}</span>{' '}
                <span className="text-xs text-muted-foreground">{statusLabel(result.type)}</span>
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
              className="grid gap-1 rounded-sm border border-border bg-surface px-3 py-2 text-sm"
            >
              <a
                href={`/app/objects/${relationship.otherId}`}
                className="min-w-0 truncate font-medium hover:underline"
              >
                {displayText(relationship.otherName)}
              </a>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {relationship.kind === 'related'
                    ? relationship.kind
                    : relationship.direction === 'out'
                      ? relationship.kind
                      : `← ${relationship.kind}`}{' '}
                  · {relationship.otherType}
                </span>
                {(relationship.direction === 'out' || relationship.kind === 'related') &&
                !(
                  sourceType === 'task' &&
                  relationship.direction === 'out' &&
                  relationship.kind === 'child' &&
                  relationship.otherType === 'project'
                ) ? (
                  <ItemActionGroup
                    label={`Actions for relationship with ${displayText(relationship.otherName)}`}
                  >
                    <button
                      type="button"
                      disabled={pending || isOptimisticRelationship(relationship)}
                      onClick={() => {
                        onRemoveRelationship(relationship.id, relationship.otherId);
                      }}
                      className="text-xs text-destructive hover:underline"
                    >
                      Unlink
                    </button>
                  </ItemActionGroup>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </ObjectPanel>
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
    <ObjectPanel title="Recent changes" eyebrow={String(changes.length)}>
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
    </ObjectPanel>
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
  const timezone = useWorkspaceTimezone();
  const isSuggested = change.status === 'suggested';
  const isRejected = change.status === 'rejected';
  return (
    <li
      className={`min-w-0 rounded-sm border border-border bg-surface px-4 py-2 ${isSuggested ? 'border-signal/40 bg-signal-soft' : ''} ${isRejected ? 'opacity-60' : ''}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0 break-words font-medium">{changeFieldLabel(change.field)}</span>
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
          {statusLabel(change.actorKind)} · {statusLabel(change.status)}
        </span>
      </div>
      <div className="mt-1 break-words text-xs text-muted-foreground">
        {formatValue(change.previousValue, timezone, change.field)} →{' '}
        {formatValue(change.newValue, timezone, change.field)}
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{formatDisplayDateTime(change.changedAt, { timezone })}</span>
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
    <footer className="border border-border bg-bg p-4">
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
  if (field === 'aliases') {
    const left = normalizeAliases(a);
    const right = normalizeAliases(b);
    return left.length === right.length && left.every((alias, index) => alias === right[index]);
  }
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

function toLocalInputValue(value: unknown, timezone: string): string {
  const d = toDateOrNull(value);
  return d ? (presentDueDate(d, { timezone }).dateKey ?? '') : '';
}

function formatValue(v: unknown, timezone: string, field = ''): string {
  const category = formatTaskCategoryChangeValue(field, v);
  if (category !== null) return category;
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') return displayText(v, { timezone });
  if (Array.isArray(v)) return v.map((item) => formatValue(item, timezone, field)).join(', ');
  if (v instanceof Date) return formatDisplayDateTime(v, { timezone });
  if (typeof v === 'object') return summarizeObjectValue(v as Record<string, unknown>);
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return 'updated';
}

function changeFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    __merge__: 'Merge',
    __merged_from__: 'Merged from',
    canonicalName: 'Name',
    aliases: 'Aliases',
    dueAt: 'Due date',
    taskCategory: 'Category',
    ownerUserId: 'Owner',
    assigneeUserId: 'Assignee',
  };
  return labels[field] ?? field.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function parseAliases(value: string, canonicalName: string): string[] {
  const seen = new Set<string>();
  const canonical = canonicalName.trim().toLocaleLowerCase();
  return value
    .split(/[,\n]/)
    .map((alias) => alias.trim())
    .filter((alias) => {
      if (!alias || alias.toLocaleLowerCase() === canonical) return false;
      const key = alias.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeAliases(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []));
  }
  if (typeof value === 'string') return parseAliases(value, '');
  return [];
}

function summarizeObjectValue(value: Record<string, unknown>): string {
  const name = typeof value.canonicalName === 'string' ? value.canonicalName : null;
  const type = typeof value.type === 'string' ? value.type : null;
  if (name && type) return `${displayText(name)} (${displayText(type)})`;
  if (name) return displayText(name);
  const aliases = normalizeAliases(value.aliases);
  if (aliases.length > 0)
    return `aliases: ${aliases.map((alias) => displayText(alias)).join(', ')}`;
  const mergedIds = Array.isArray(value.merged_entity_ids) ? value.merged_entity_ids.length : 0;
  if (mergedIds > 0) return `${mergedIds} merged object${mergedIds === 1 ? '' : 's'}`;
  return 'updated details';
}
