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
import { ContextualAskLink } from '@/components/chat/contextual-ask-link';
import { CollectionStatus, priorityTone } from '@/components/collections/collection-status';
import { EditableMetadata } from '@/components/collections/editable-metadata';
import { MetadataDateEditor } from '@/components/collections/metadata-date-editor';
import { DueDateDisplay } from '@/components/due-date-display';
import { ObjectOrigin, ObjectProvenanceGroups } from '@/components/objects/object-origin';
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
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ItemActionGroup, ItemOverflowMenu } from '@/components/ui/item-actions';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { displayText, formatDisplayDateTime } from '@/lib/display-dates';
import { isInternalIdentifier } from '@/lib/display-labels';
import { isSchedulableObjectType } from '@/lib/due-dates';
import { formatTaskCategoryChangeValue } from '@/lib/object-change-format';
import { displayObjectTitle } from '@/lib/object-title';
import { readJson } from '@/lib/paginated-api';
import { queryKeys } from '@/lib/query-keys';
import { statusLabel } from '@/lib/status-labels';
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
type EditableField =
  | 'canonicalName'
  | 'aliases'
  | 'status'
  | 'stage'
  | 'priority'
  | 'dueAt'
  | 'assigneeUserId';
type EditableValue = string | number | Date | readonly string[] | null;
type DraftField = 'canonicalName' | 'aliases' | 'stage' | 'dueAt';

interface Props {
  detail: ObjectDetail;
  teamId?: string;
  userId: string;
  initialPinned?: boolean;
  suggestions: LocalSuggestion[];
  projects?: { id: string; label: string }[];
  members?: { id: string; label: string }[];
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
const EMPTY_MEMBER_OPTIONS: { id: string; label: string }[] = [];

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
    field === 'dueAt' ||
    field === 'assigneeUserId'
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
    assigneeUserId: undefined,
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
    assigneeUserId: 0,
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
        assigneeUserId: next.assigneeUserId,
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
    <div className="space-y-3">
      <ObjectDetailHeader
        detail={view.viewDetail}
        nameDraft={view.nameDraft}
        focusedDraftsRef={view.focusedDraftsRef}
        teamId={props.teamId}
        initialPinned={props.initialPinned ?? false}
        error={view.error}
        pending={view.pending}
        repairPending={view.repairPending}
        saveState={view.saveState}
        savingCount={view.savingCount}
        onNameDraftChange={(nameDraft) => {
          view.dispatchObjectUi({ nameDraft });
        }}
        onNameCommit={(value) => {
          view.patch('canonicalName', value);
        }}
        onRepairMemory={view.repairMemory}
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <main className="min-w-0 space-y-4">
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
                className: 'border-b border-border',
                summaryClassName: 'cursor-pointer list-none py-2',
                bodyClassName: 'border-t border-border py-3',
                titleClassName: 'text-sm font-semibold',
                countClassName: 'mt-0.5 text-xs text-fg-dim',
                openLabelClassName: 'text-xs text-fg-dim',
              }}
            />
          ) : null}

          <ObjectOrigin provenance={view.viewDetail.provenance} />
          <ObjectSummaryPanel detail={view.viewDetail} />
          <ObjectProvenanceGroups provenance={view.viewDetail.provenance} />
          <ObjectConnectedWorkSection connectedWork={view.detail.connectedWork} />

          <ObjectSectionFeed objectId={view.detail.id} section="events" title="Evidence" />
          <ObjectSectionFeed objectId={view.detail.id} section="facts" title="Facts" />

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

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4">
          <ObjectContactSection detail={view.viewDetail} />

          <ObjectEditableFields
            detail={view.localDetail}
            aliasesDraft={view.aliasesDraft}
            stageDraft={view.stageDraft}
            dueDraft={view.dueDraft}
            focusedDraftsRef={view.focusedDraftsRef}
            patch={view.patch}
            dispatchObjectUi={view.dispatchObjectUi}
            projects={props.projects}
            members={props.members}
            primaryProject={props.primaryProject}
            taskCategoriesEnabled={props.taskCategoriesEnabled}
          />

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
    <section>
      <h2 className="text-xs text-fg-dim">Contact</h2>
      <div className="mt-2 space-y-1.5">
        {contacts.map((facet) => {
          const href =
            facet.kind === 'email'
              ? `mailto:${facet.normalizedValue}`
              : `tel:${facet.normalizedValue}`;
          return (
            <a
              key={facet.id}
              href={href}
              className="flex min-w-0 items-center justify-between gap-3 text-sm hover:underline"
            >
              <span className="min-w-0 truncate">{facet.value}</span>
              <span className="shrink-0 text-xs text-fg-dim">{statusLabel(facet.kind)}</span>
            </a>
          );
        })}
      </div>
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

  if (!summary) return null;
  if (!generated && !canRequest && summary.status !== 'pending' && summary.status !== 'failed') {
    return null;
  }

  return (
    <section aria-label="Summary">
      {generated ? (
        <div className="space-y-2">
          <p className="max-w-4xl text-sm leading-5 text-fg">{generated.overview}</p>
          {generated.currentState.length > 0 ? (
            <ul className="space-y-1.5">
              {generated.currentState.map((item) => (
                <li key={`${item.label}:${item.text}`} className="text-sm leading-5 text-fg-muted">
                  <span className="font-medium text-fg">{item.label}:</span> {item.text}
                  <SourceChips refs={item.sourceRefs} />
                </li>
              ))}
            </ul>
          ) : null}
          {generated.conflicts.length > 0 || generated.openQuestions.length > 0 ? (
            <div className="space-y-1.5">
              {[...generated.conflicts, ...generated.openQuestions].map((item) => (
                <p key={`${item.label}:${item.text}`} className="text-sm leading-5 text-fg-muted">
                  <span className="font-medium text-fg">{item.label}:</span> {item.text}
                  <SourceChips refs={item.sourceRefs} />
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : summary.canGenerate ? (
        <p className="text-sm text-fg-muted">Summary is ready to generate.</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {summary.generatedAt ||
        summary.status === 'pending' ||
        (summary.status === 'missing' && summary.canGenerate) ||
        summary.lastErrorCode ? (
          <p className="text-xs text-fg-dim">
            {summary.generatedAt
              ? `Updated ${formatDisplayDateTime(summary.generatedAt, { timezone })} · ${
                  summary.sourceRefs.length
                } sources`
              : summary.status === 'pending'
                ? 'Generating'
                : summary.status === 'missing' && summary.canGenerate
                  ? 'Ready to generate'
                  : summary.lastErrorCode
                    ? 'Update failed'
                    : null}
          </p>
        ) : null}
        {canRequest ? (
          <button
            type="button"
            className="text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            onClick={requestSummary}
          >
            {pending ? 'Generating…' : actionLabel}
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </section>
  );
}

function SourceChips({ refs }: { refs: objects.ObjectSummarySourceRef[] }) {
  if (refs.length === 0) return null;
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
      {refs.slice(0, 3).map((ref) => {
        const artifactRef = summaryRefToArtifactRef(ref);
        const className =
          'border border-border bg-bg px-1.5 py-0.5 text-xs text-fg-dim hover:border-signal hover:text-signal';
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

function ObjectDetailHeader({
  detail,
  nameDraft,
  focusedDraftsRef,
  teamId,
  initialPinned,
  error,
  pending,
  repairPending,
  saveState,
  savingCount,
  onNameDraftChange,
  onNameCommit,
  onRepairMemory,
}: {
  detail: ObjectDetail;
  nameDraft: string;
  focusedDraftsRef: RefObject<Record<DraftField, boolean>>;
  teamId?: string;
  initialPinned: boolean;
  error: string | null;
  pending: boolean;
  repairPending: boolean;
  saveState: SaveState;
  savingCount: number;
  onNameDraftChange: (value: string) => void;
  onNameCommit: (value: string) => void;
  onRepairMemory: () => void;
}) {
  const pendingCount = detail.recentChanges.filter((c) => c.status === 'suggested').length;
  const visibleAliases = detail.aliases.filter((alias) => !isInternalIdentifier(alias));
  const hasAlerts =
    detail.newSinceLastVisit > 0 || pendingCount > 0 || error !== null || saveState !== 'idle';
  const addTaskHref =
    detail.type === 'project' && detail.archivedAt === null
      ? `/app/objects/new?project=${encodeURIComponent(detail.id)}&returnTo=${encodeURIComponent(`/app/objects/${detail.id}`)}`
      : null;
  return (
    <header>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-dim">
            <span>{statusLabel(detail.type)}</span>
            {detail.type === 'task' ? (
              <LiveTaskCategoryBadge
                taskId={detail.id}
                category={detail.taskCategory}
                status={detail.taskCategoryStatus}
                updatedAt={detail.taskCategoryUpdatedAt}
              />
            ) : null}
          </div>
          <h1 className="sr-only">{displayText(displayObjectTitle(detail))}</h1>
          <input
            aria-label="Name"
            value={nameDraft}
            onFocus={() => {
              focusedDraftsRef.current.canonicalName = true;
            }}
            onChange={(event) => {
              onNameDraftChange(event.target.value);
            }}
            onBlur={(event) => {
              focusedDraftsRef.current.canonicalName = false;
              const value = event.target.value.trim();
              if (value === '') {
                onNameDraftChange(editableObjectName(detail));
                return;
              }
              onNameDraftChange(value);
              if (value === editableObjectName(detail)) return;
              onNameCommit(value);
            }}
            className="mt-0.5 w-full bg-transparent text-xl font-semibold leading-snug tracking-tight text-fg outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
          />
          {visibleAliases.length > 0 ? (
            <p className="mt-1 text-xs text-fg-dim">
              aka {visibleAliases.map((alias) => displayText(alias)).join(' · ')}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center">
          <ObjectPinButton objectId={detail.id} initialPinned={initialPinned} icon />
          {teamId ? (
            <ContextualAskLink
              teamId={teamId}
              context={{
                pathname: `/app/objects/${detail.id}`,
                routeKind: 'object-detail',
                objectId: detail.id,
              }}
              pinnedEntityId={detail.id}
              pinnedEntityName={displayObjectTitle(detail)}
              label="Ask about object"
              icon
            />
          ) : null}
          <ItemOverflowMenu targetLabel={displayObjectTitle(detail)}>
            {addTaskHref ? (
              <DropdownMenuItem asChild>
                <Link href={addTaskHref}>Add task</Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              disabled={pending || repairPending || detail.archivedAt !== null}
              onSelect={onRepairMemory}
            >
              {detail.archivedAt
                ? 'Repair unavailable'
                : repairPending
                  ? 'Repairing…'
                  : 'Repair memory'}
            </DropdownMenuItem>
          </ItemOverflowMenu>
        </div>
      </div>
      {hasAlerts ? (
        <div className="mt-2 flex flex-col gap-1">
          {detail.newSinceLastVisit > 0 ? (
            <output className="text-xs text-signal">
              {detail.newSinceLastVisit} new change
              {detail.newSinceLastVisit === 1 ? '' : 's'} since your last visit
            </output>
          ) : null}
          {pendingCount > 0 ? (
            <output className="text-xs text-signal">
              {pendingCount} suggestion{pendingCount === 1 ? '' : 's'} awaiting review
            </output>
          ) : null}
          {error ? (
            <div role="alert" className="text-xs text-danger">
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
      <TechnicalDetails
        className="mt-2"
        items={[{ label: 'Object ID', value: detail.id, copyValue: detail.id }]}
      />
    </header>
  );
}

function ObjectEditableFields({
  detail,
  aliasesDraft,
  stageDraft,
  dueDraft,
  focusedDraftsRef,
  patch,
  dispatchObjectUi,
  projects = EMPTY_PROJECT_OPTIONS,
  members = EMPTY_MEMBER_OPTIONS,
  primaryProject = null,
  taskCategoriesEnabled = true,
}: {
  detail: ObjectDetail;
  aliasesDraft: string;
  stageDraft: string;
  dueDraft: string;
  focusedDraftsRef: RefObject<Record<DraftField, boolean>>;
  patch: (field: EditableField, value: EditableValue) => void;
  dispatchObjectUi: Dispatch<ObjectDetailUiAction>;
  projects?: { id: string; label: string }[];
  members?: { id: string; label: string }[];
  primaryProject?: objects.TaskPrimaryProjectRow | null;
  taskCategoriesEnabled?: boolean;
}) {
  const options = statusOptions(detail.type);
  const assignee = members.find((member) => member.id === detail.assigneeUserId);
  const title = displayObjectTitle(detail);
  return (
    <section aria-label="Properties" className="flex flex-col">
      <h2 className="px-2 text-xs text-fg-dim">Properties</h2>
      <EditableMetadata
        label={`Status for ${displayText(title)}`}
        value={() => <CollectionStatus value={detail.status} label={statusLabel(detail.status)} />}
        editor={() => (
          <select
            value={detail.status}
            onChange={(event) => {
              patch('status', event.target.value);
            }}
            className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
            aria-label="Status"
          >
            {options.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
            {options.includes(detail.status) ? null : (
              <option value={detail.status}>{statusLabel(detail.status)}</option>
            )}
          </select>
        )}
      />
      <EditableMetadata
        label={`Priority for ${displayText(title)}`}
        value={() => (
          <CollectionStatus
            value={detail.priority ? `p${detail.priority}` : 'none'}
            tone={priorityTone(detail.priority)}
            label={detail.priority ? `P${detail.priority}` : 'No priority'}
          />
        )}
        editor={() => (
          <select
            value={detail.priority ?? ''}
            onChange={(event) => {
              patch('priority', event.target.value === '' ? null : Number(event.target.value));
            }}
            className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
            aria-label="Priority"
          >
            <option value="">None</option>
            <option value="1">P1</option>
            <option value="2">P2</option>
            <option value="3">P3</option>
            <option value="4">P4</option>
          </select>
        )}
      />
      {detail.type === 'task' ? (
        <EditableMetadata
          label={`Assignee for ${displayText(title)}`}
          value={assignee?.label ?? (detail.assigneeUserId ? 'Assigned' : 'Unassigned')}
          editor={() => (
            <select
              value={detail.assigneeUserId ?? ''}
              onChange={(event) => {
                patch('assigneeUserId', event.target.value || null);
              }}
              className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
              aria-label="Assignee"
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.label}
                </option>
              ))}
            </select>
          )}
        />
      ) : null}
      {isSchedulableObjectType(detail.type) ? (
        <EditableMetadata
          label={`Due date for ${displayText(title)}`}
          value={() => <DueDateDisplay value={detail.dueAt} variant="field-hint" />}
          editor={() => (
            <MetadataDateEditor
              defaultValue={dueDraft}
              onApply={(value) => {
                focusedDraftsRef.current.dueAt = false;
                dispatchObjectUi({ dueDraft: value });
                patch('dueAt', value === '' ? null : new Date(`${value}T00:00:00.000Z`));
              }}
            />
          )}
        />
      ) : null}
      {detail.type === 'task' && detail.archivedAt ? (
        <p className="px-2 py-2 text-xs text-fg-muted">
          Unarchive this task to change its project or category.
        </p>
      ) : detail.type === 'task' ? (
        <>
          <div className="px-2 py-1">
            <TaskProjectSelect
              taskId={detail.id}
              projectId={primaryProject?.projectId ?? null}
              currentProjectLabel={primaryProject?.projectName}
              projectArchived={Boolean(primaryProject?.archivedAt)}
              projects={projects}
              quiet
            />
          </div>
          {taskCategoriesEnabled ? (
            <div className="px-2 py-1">
              <TaskCategorySelect
                taskId={detail.id}
                category={detail.taskCategory}
                mode={detail.taskCategoryMode}
                status={detail.taskCategoryStatus}
                updatedAt={detail.taskCategoryUpdatedAt}
                quiet
              />
            </div>
          ) : null}
        </>
      ) : null}
      <label className="flex min-h-9 items-center gap-3 px-2">
        <span className="w-16 shrink-0 text-xs text-fg-dim">Stage</span>
        <input
          aria-label="Stage"
          value={stageDraft}
          onFocus={() => {
            focusedDraftsRef.current.stage = true;
          }}
          onChange={(event) => {
            dispatchObjectUi({ stageDraft: event.target.value });
          }}
          onBlur={(event) => {
            focusedDraftsRef.current.stage = false;
            const value = event.target.value.trim();
            dispatchObjectUi({ stageDraft: value });
            patch('stage', value === '' ? null : value);
          }}
          className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
          placeholder="No stage"
        />
      </label>
      <label className="flex min-h-9 items-center gap-3 px-2">
        <span className="w-16 shrink-0 text-xs text-fg-dim">Aliases</span>
        <input
          aria-label="Aliases"
          value={aliasesDraft}
          onFocus={() => {
            focusedDraftsRef.current.aliases = true;
          }}
          onChange={(event) => {
            dispatchObjectUi({ aliasesDraft: event.target.value });
          }}
          onBlur={(event) => {
            focusedDraftsRef.current.aliases = false;
            const aliases = parseAliases(event.target.value, editableObjectName(detail));
            dispatchObjectUi({ aliasesDraft: aliases.join(', ') });
            patch('aliases', aliases);
          }}
          placeholder="No aliases"
          className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
        />
      </label>
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
      <h2 className="text-xs text-fg-dim">Notes</h2>
      <div className="mt-2 space-y-2">
        <textarea
          aria-label="New note"
          value={noteBody}
          onChange={(e) => {
            dispatchObjectUi({ noteBody: e.target.value });
          }}
          placeholder="Add a note"
          className="w-full border-0 border-b border-border bg-transparent px-0 py-2 text-sm outline-none focus-visible:border-signal"
          rows={2}
        />
        <button
          type="button"
          onClick={onAddNote}
          disabled={pending || !noteBody.trim()}
          className="text-xs font-medium text-signal hover:underline disabled:opacity-50"
        >
          Add note
        </button>
      </div>
      {notes.length > 0 ? (
        <ul className="mt-2 space-y-2">
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
      ) : null}
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
  const timezone = useWorkspaceTimezone();
  return (
    <li className="text-sm">
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            aria-label="Edit note"
            value={editingBody}
            onChange={(e) => {
              dispatchObjectUi({ editingBody: e.target.value });
            }}
            className="w-full border-0 border-b border-border bg-transparent px-0 py-1.5 text-sm outline-none focus-visible:border-signal"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || !editingBody.trim()}
              onClick={() => {
                onSaveNote(note.id, editingBody);
              }}
              className="text-xs font-medium text-signal hover:underline disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                dispatchObjectUi({ editingNoteId: null });
              }}
              className="text-xs text-fg-muted hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="whitespace-pre-wrap">{displayText(note.body, { timezone })}</div>
      )}
      <div className="mt-1 flex items-center justify-between text-xs text-fg-dim">
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
              className="text-danger hover:underline"
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
  if (!hasWork) return null;
  return (
    <section>
      <h2 className="text-xs text-fg-dim">Connected work</h2>
      <div className="mt-1.5 grid gap-3 lg:grid-cols-2">
        <ConnectedTaskList title="Open tasks" tasks={connectedWork.openTasks} />
        <ConnectedCalendarList events={connectedWork.calendarEvents} />
        <ConnectedObjectList objects={connectedWork.objects} />
        <ConnectedBoardList boards={connectedWork.boards} />
        <ConnectedApprovalList approvals={connectedWork.pendingApprovals} />
        <ConnectedTaskList title="Recent history" tasks={connectedWork.recentTasks} />
        <ConnectedLinkList links={connectedWork.links} />
        <ConnectedCapturedFileList files={connectedWork.capturedFiles} />
        <ConnectedDocumentList documents={connectedWork.documents} />
      </div>
    </section>
  );
}

function ConnectedWorkSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-1 text-xs text-fg-dim">{title}</h3>
      {children}
    </section>
  );
}

function ConnectedTaskList({
  title,
  tasks,
}: {
  title: string;
  tasks: ObjectDetail['connectedWork']['openTasks'];
}) {
  if (tasks.length === 0) return null;
  return (
    <ConnectedWorkSection title={title}>
      <ul className="space-y-1.5">
        {tasks.map((task) => (
          <li key={task.id} className="grid gap-0.5 text-sm">
            <a href={`/app/objects/${task.id}`} className="font-medium hover:underline">
              {displayText(displayObjectTitle(task))}
            </a>
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-fg-dim">
              <span>{statusLabel(task.status)}</span>
              <DueDateDisplay value={task.dueAt} variant="compact" />
            </span>
          </li>
        ))}
      </ul>
    </ConnectedWorkSection>
  );
}

function ConnectedCalendarList({
  events,
}: {
  events: ObjectDetail['connectedWork']['calendarEvents'];
}) {
  const timezone = useWorkspaceTimezone();
  if (events.length === 0) return null;
  return (
    <ConnectedWorkSection title="Calendar">
      <ul className="space-y-1.5">
        {events.map((event) => (
          <li key={event.id} className="grid gap-0.5 text-sm">
            <span className="font-medium">{displayText(event.title)}</span>
            <span className="text-xs text-fg-dim">
              {formatDisplayDateTime(event.startAt, { timezone })} · {statusLabel(event.showAs)}
            </span>
          </li>
        ))}
      </ul>
    </ConnectedWorkSection>
  );
}

function ConnectedObjectList({ objects }: { objects: ObjectDetail['connectedWork']['objects'] }) {
  if (objects.length === 0) return null;
  return (
    <ConnectedWorkSection title="People and objects">
      <ul className="space-y-1.5">
        {objects.map((object) => (
          <li key={object.id} className="grid gap-0.5 text-sm">
            <a href={`/app/objects/${object.id}`} className="font-medium hover:underline">
              {displayText(object.canonicalName)}
            </a>
            <span className="text-xs text-fg-dim">
              {statusLabel(object.type)} · {object.factCount} fact
              {object.factCount === 1 ? '' : 's'}
            </span>
          </li>
        ))}
      </ul>
    </ConnectedWorkSection>
  );
}

function ConnectedBoardList({ boards }: { boards: ObjectDetail['connectedWork']['boards'] }) {
  if (boards.length === 0) return null;
  return (
    <ConnectedWorkSection title="Boards">
      {boards.length === 0 ? (
        <p className="text-sm text-fg-dim">No board context found.</p>
      ) : (
        <ul className="space-y-2">
          {boards.map((board) => (
            <li key={board.itemId} className="grid gap-0.5 text-sm">
              <a
                href={`/app/boards/${board.boardId}?item=${board.itemId}`}
                className="font-medium hover:underline"
              >
                {displayText(board.boardName)}
              </a>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-fg-dim">
                <span>{board.laneName ?? 'no lane'}</span>
                <DueDateDisplay value={board.dueAt} variant="compact" />
                {board.priority !== null ? <span>· P{board.priority}</span> : null}
              </span>
              {board.nextStep ? (
                <span className="text-xs text-fg-dim">{displayText(board.nextStep)}</span>
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
  if (approvals.length === 0) return null;
  return (
    <ConnectedWorkSection title="Pending approvals">
      {approvals.length === 0 ? (
        <p className="text-sm text-fg-dim">No related approvals found.</p>
      ) : (
        <ul className="space-y-2">
          {approvals.map((approval) => (
            <li key={approval.itemId} className="grid gap-0.5 text-sm">
              <Link href="/app/approvals" className="font-medium hover:underline">
                {displayText(approval.title)}
              </Link>
              <span className="text-xs text-fg-dim">
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
  if (documents.length === 0) return null;
  return (
    <ConnectedWorkSection title="Documents">
      {documents.length === 0 ? (
        <p className="text-sm text-fg-dim">No related documents found.</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((document) => (
            <li key={document.id} className="grid gap-0.5 text-sm">
              <a
                href={`/app/documents/${document.id}`}
                title={document.name}
                className="font-medium hover:underline"
              >
                {displayText(truncateFilenameMiddle(document.name))}
              </a>
              <span className="text-xs text-fg-dim">
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
  if (links.length === 0) return null;
  return (
    <ConnectedWorkSection title="Links">
      {links.length === 0 ? (
        <p className="text-sm text-fg-dim">No related links found.</p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <li key={link.id} className="grid gap-0.5 text-sm">
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
              <span className="text-xs text-fg-dim">
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
  if (files.length === 0) return null;
  return (
    <ConnectedWorkSection title="Files">
      {files.length === 0 ? (
        <p className="text-sm text-fg-dim">No related files found.</p>
      ) : (
        <ul className="space-y-2">
          {files.map((file) => (
            <li key={file.id} className="grid gap-0.5 text-sm">
              <Link href="/app/documents/captured" className="font-medium hover:underline">
                {displayText(truncateFilenameMiddle(file.name))}
              </Link>
              <span className="text-xs text-fg-dim">
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
    <section>
      <h2 className="text-xs text-fg-dim">Related</h2>
      <div className="mt-2 grid gap-2">
        <label>
          <span className="sr-only">Link to object</span>
          <input
            value={linkQuery}
            onChange={(e) => {
              onLinkQueryChange(e.target.value);
            }}
            placeholder="Search objects"
            className="w-full border-0 border-b border-border bg-transparent px-0 py-1.5 text-sm outline-none focus-visible:border-signal"
          />
        </label>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <label>
            <span className="sr-only">Kind</span>
            <select
              value={linkKind}
              onChange={(e) => {
                dispatchObjectUi({
                  linkKind: e.target.value as (typeof RELATIONSHIP_KINDS)[number],
                });
              }}
              className="w-full border-0 border-b border-border bg-transparent py-1.5 text-sm outline-none"
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
            className="text-sm font-medium text-signal hover:underline disabled:opacity-50"
          >
            Link
          </button>
        </div>
      </div>
      {selectedLink ? (
        <p className="mb-3 text-xs text-fg-dim">
          Selected {displayText(selectedLink.canonicalName)} · {selectedLink.type}
          {projectFieldOwnsLink ? ' · use the Project field for primary membership' : ''}
        </p>
      ) : linkResults.length > 0 ? (
        <ul className="mb-3 grid gap-1">
          {linkResults.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                className="w-full px-0 py-1.5 text-left text-sm hover:underline"
                onClick={() => {
                  onLinkQueryChange(result.canonicalName);
                  onSelectLink(result);
                }}
              >
                <span className="font-medium">{displayText(result.canonicalName)}</span>{' '}
                <span className="text-xs text-fg-dim">{statusLabel(result.type)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {relationships.length === 0 ? null : (
        <ul className="space-y-2">
          {relationships.map((relationship) => (
            <li
              key={`${relationship.direction}-${relationship.id}`}
              className="grid gap-0.5 text-sm"
            >
              <a
                href={`/app/objects/${relationship.otherId}`}
                className="min-w-0 truncate font-medium hover:underline"
              >
                {displayText(relationship.otherName)}
              </a>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-fg-dim">
                  {relationship.kind === 'related'
                    ? statusLabel(relationship.kind)
                    : relationship.direction === 'out'
                      ? statusLabel(relationship.kind)
                      : `← ${statusLabel(relationship.kind)}`}{' '}
                  · {statusLabel(relationship.otherType)}
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
                      className="text-xs text-danger hover:underline"
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
  if (changes.length === 0) return null;
  return (
    <section>
      <h2 className="text-xs text-fg-dim">Recent changes</h2>
      <ul className="mt-2 space-y-2 text-sm">
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
  const timezone = useWorkspaceTimezone();
  const isSuggested = change.status === 'suggested';
  const isRejected = change.status === 'rejected';
  return (
    <li
      className={`min-w-0 py-1.5 ${isSuggested ? 'text-signal' : ''} ${isRejected ? 'opacity-60' : ''}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0 break-words font-medium">{changeFieldLabel(change.field)}</span>
        <span className="shrink-0 text-xs text-fg-dim">
          {statusLabel(change.actorKind)} · {statusLabel(change.status)}
        </span>
      </div>
      <div className="mt-1 break-words text-xs text-fg-dim">
        {formatValue(change.previousValue, timezone, change.field)} →{' '}
        {formatValue(change.newValue, timezone, change.field)}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-fg-dim">
        <span>{formatDisplayDateTime(change.changedAt, { timezone })}</span>
        {isSuggested ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                onAcceptChange(change.id);
              }}
              className="text-xs text-signal hover:underline disabled:opacity-50"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                onRejectChange(change.id);
              }}
              className="text-xs text-fg-muted hover:underline disabled:opacity-50"
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
    <footer>
      <button
        type="button"
        disabled={pending || archivedAt !== null}
        onClick={onArchiveObject}
        className="text-xs text-danger hover:underline disabled:opacity-50"
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
