'use client';

import { presentDueDate } from '@timeline/shared/time';
import { ExternalLink, Save } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import type {
  BoardItemOptimisticPatch,
  BoardMemberOption,
} from '@/components/boards/board-detail-client';
import type { BoardLayout } from '@/lib/board-links';
import type * as boards from '@timeline/shared/boards';
import type * as objects from '@timeline/shared/objects/types';
import type { ReactNode } from 'react';

import { RemoveBoardItemButton } from '@/components/boards/remove-board-item-button';
import { ContextualAskLink } from '@/components/chat/contextual-ask-link';
import { DueDateDisplay } from '@/components/due-date-display';
import { ObjectRelatedContext } from '@/components/objects/object-related-context';
import { LiveTaskCategoryBadge } from '@/components/tasks/task-category-badge';
import { TaskCategorySelect } from '@/components/tasks/task-category-select';
import { TechnicalDetails } from '@/components/technical-details';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { boardViewHref } from '@/lib/board-links';
import { displayText, formatDisplayDate, formatDisplayDateTime } from '@/lib/display-dates';
import { isSchedulableObjectType } from '@/lib/due-dates';
import { notifyAction } from '@/lib/notify';
import { objectDetailHref } from '@/lib/object-links';
import { displayObjectTitle } from '@/lib/object-title';
import { statusLabel } from '@/lib/status-labels';
import { cn } from '@/lib/utils';

interface Props {
  teamId?: string;
  boardId: string;
  view: BoardLayout;
  item: boards.BoardItemRow | null;
  connectedWork?: objects.ObjectDetail['connectedWork'] | null;
  history: boards.BoardItemChangeRow[];
  lanes?: boards.BoardLaneRow[];
  members?: BoardMemberOption[];
  filterParams?: Record<string, string>;
  onUpdateItem?: (
    itemId: string,
    patch: BoardItemOptimisticPatch,
  ) => Promise<{ ok?: boolean; error?: string; id?: string }>;
  onItemRemoved?: (itemId: string, entityId: string) => void;
}

const EMPTY_LANES: boards.BoardLaneRow[] = [];
const EMPTY_MEMBERS: BoardMemberOption[] = [];
const EMPTY_FILTER_PARAMS: Record<string, string> = {};

interface DraftState {
  itemId: string | null;
  serverNextStep: string;
  serverNotes: string;
  nextStepDraft: string;
  noteDraft: string;
  editingNotes: boolean;
}

function draftStateForItem(item: boards.BoardItemRow | null): DraftState {
  const serverNextStep = item?.nextStep ?? '';
  const serverNotes = item?.notes ?? '';
  return {
    itemId: item?.id ?? null,
    serverNextStep,
    serverNotes,
    nextStepDraft: serverNextStep,
    noteDraft: serverNotes,
    editingNotes: false,
  };
}

function reconcileDraftState(state: DraftState, item: boards.BoardItemRow | null): DraftState {
  const itemId = item?.id ?? null;
  const serverNextStep = item?.nextStep ?? '';
  const serverNotes = item?.notes ?? '';
  if (state.itemId !== itemId) return draftStateForItem(item);
  if (state.serverNextStep === serverNextStep && state.serverNotes === serverNotes) return state;
  return {
    ...state,
    serverNextStep,
    serverNotes,
    nextStepDraft:
      state.nextStepDraft === state.serverNextStep ? serverNextStep : state.nextStepDraft,
    noteDraft: state.noteDraft === state.serverNotes ? serverNotes : state.noteDraft,
  };
}

export function BoardCardDetail({
  teamId,
  boardId,
  view,
  item,
  connectedWork = null,
  history,
  lanes = EMPTY_LANES,
  members = EMPTY_MEMBERS,
  filterParams = EMPTY_FILTER_PARAMS,
  onUpdateItem,
  onItemRemoved,
}: Props) {
  const [draftState, setDraftState] = useState(() => draftStateForItem(item));
  const [pending, startTransition] = useTransition();
  const nextDraftState = reconcileDraftState(draftState, item);
  const currentDraftState = nextDraftState === draftState ? draftState : nextDraftState;
  if (nextDraftState !== draftState) setDraftState(nextDraftState);

  if (!item) return null;
  const provenanceChanges = history.filter(
    (change) => change.status === 'applied' && change.evidence.length > 0,
  );
  const lane = lanes.find((candidate) => candidate.id === item.laneId) ?? null;
  const blocked = lane?.kind === 'blocked';

  function savePatch(patch: BoardItemOptimisticPatch, onSuccess?: () => void): void {
    if (!item || !onUpdateItem) return;
    const previous = previousBoardItemPatch(item, patch);
    const label = boardItemPatchLabel(patch);
    startTransition(async () => {
      const result = await notifyAction({
        id: `board-item:${item.id}`,
        loading: `Updating ${label}…`,
        success: `${capitalizeLabel(label)} updated`,
        error: `Couldn’t update ${label}`,
        run: () => onUpdateItem(item.id, patch),
        undo: {
          run: () => onUpdateItem(item.id, previous),
        },
      });
      if (result.error) return;
      onSuccess?.();
    });
  }

  function saveNotes(): void {
    savePatch({ notes: currentDraftState.noteDraft.trim() || null }, () => {
      setDraftState((current) => ({ ...current, editingNotes: false }));
    });
  }

  function saveNextStep(): void {
    const trimmed = currentDraftState.nextStepDraft.trim();
    if ((item?.nextStep ?? '') !== trimmed) {
      savePatch({ nextStep: trimmed || null });
    }
  }

  return (
    <aside className="rounded-sm border border-border bg-bg" aria-label="Board card detail">
      <BoardCardHeader
        boardId={boardId}
        view={view}
        item={item}
        lane={lane}
        blocked={blocked}
        nextStepDraft={currentDraftState.nextStepDraft}
        filterParams={filterParams}
      />
      <BoardCommandFields
        item={item}
        lanes={lanes}
        members={members}
        disabled={pending || !onUpdateItem}
        onPatch={savePatch}
      />
      <NextStepSection
        value={currentDraftState.nextStepDraft}
        disabled={pending || !onUpdateItem}
        onChange={(value) => {
          setDraftState((current) => ({ ...current, nextStepDraft: value }));
        }}
        onBlur={saveNextStep}
      />
      <BoardObjectDetails item={item} lane={lane} blocked={blocked} />
      <ObjectRelatedContext connectedWork={connectedWork} compact />
      <BoardNotesSection
        item={item}
        editing={currentDraftState.editingNotes}
        value={currentDraftState.noteDraft}
        disabled={pending || !onUpdateItem}
        onChange={(value) => {
          setDraftState((current) => ({ ...current, noteDraft: value }));
        }}
        onEdit={() => {
          setDraftState((current) => ({
            ...current,
            noteDraft: current.serverNotes,
            editingNotes: true,
          }));
        }}
        onSave={saveNotes}
      />
      <BoardActions
        boardId={boardId}
        teamId={teamId}
        view={view}
        item={item}
        filterParams={filterParams}
        onItemRemoved={onItemRemoved}
      />
      <BoardEvidence changes={provenanceChanges} lanes={lanes} members={members} />
      <BoardActivity history={history} lanes={lanes} members={members} />
    </aside>
  );
}

function BoardCardHeader({
  boardId,
  view,
  item,
  lane,
  blocked,
  nextStepDraft,
  filterParams,
}: {
  boardId: string;
  view: BoardLayout;
  item: boards.BoardItemRow;
  lane: boards.BoardLaneRow | null;
  blocked: boolean;
  nextStepDraft: string;
  filterParams: Record<string, string>;
}) {
  const visibleNextStep = nextStepDraft.trim();
  const title = displayObjectTitle(item.object);
  return (
    <div className="border-b border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="whitespace-normal break-words text-lg font-semibold leading-snug text-fg">
            {displayText(title)}
          </h2>
          <p className="mt-1 text-xs text-fg-dim">{statusLabel(item.object.type)} · board item</p>
          {item.object.type === 'task' ? (
            <LiveTaskCategoryBadge
              taskId={item.object.id}
              category={item.object.taskCategory}
              status={item.object.taskCategoryStatus}
              updatedAt={item.object.taskCategoryUpdatedAt}
              className="mt-2"
            />
          ) : null}
        </div>
        <Link
          href={boardViewHref(boardId, view, null, filterParams)}
          className="shrink-0 text-xs text-fg-muted hover:text-fg"
        >
          Close
        </Link>
      </div>
      {blocked && lane ? (
        <p className="mt-3 inline-flex rounded-sm border border-danger/40 px-2 py-1 text-xs text-danger">
          Blocked · {displayText(lane.name)}
        </p>
      ) : null}
      {visibleNextStep ? (
        <p className="mt-3 border-l border-signal pl-3 text-sm text-fg-muted">
          {displayText(visibleNextStep)}
        </p>
      ) : null}
    </div>
  );
}

function BoardCommandFields({
  item,
  lanes,
  members,
  disabled,
  onPatch,
}: {
  item: boards.BoardItemRow;
  lanes: boards.BoardLaneRow[];
  members: BoardMemberOption[];
  disabled: boolean;
  onPatch: (patch: BoardItemOptimisticPatch) => void;
}) {
  const timezone = useWorkspaceTimezone();
  return (
    <div className="grid gap-px border-b border-border bg-border sm:grid-cols-2">
      <FieldSelect
        label="Lane"
        value={item.laneId ?? ''}
        disabled={disabled}
        onChange={(value) => {
          onPatch({ laneId: value || null });
        }}
      >
        <option value="">Unset</option>
        {lanes.map((boardLane) => (
          <option key={boardLane.id} value={boardLane.id}>
            {boardLane.name}
            {boardLane.kind === 'blocked' ? ' (blocked)' : ''}
          </option>
        ))}
      </FieldSelect>
      <FieldSelect
        label="Responsible"
        value={item.responsibleUserId ?? ''}
        disabled={disabled}
        onChange={(value) => {
          onPatch({ responsibleUserId: value || null });
        }}
      >
        <option value="">Unassigned</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.label}
          </option>
        ))}
      </FieldSelect>
      <FieldInput
        label="Due"
        type="date"
        value={item.dueAt ? dateInputValue(item.dueAt, timezone) : ''}
        placeholder="No due date"
        disabled={disabled}
        onChange={(value) => {
          onPatch({ dueAt: value ? new Date(`${value}T00:00:00.000Z`) : null });
        }}
        hint={<DueDateDisplay value={item.dueAt} variant="field-hint" />}
      />
      <FieldSelect
        label="Priority"
        value={item.priority ? String(item.priority) : ''}
        disabled={disabled}
        onChange={(value) => {
          onPatch({ priority: value ? Number(value) : null });
        }}
      >
        <option value="">No priority</option>
        <option value="1">P1</option>
        <option value="2">P2</option>
        <option value="3">P3</option>
        <option value="4">P4</option>
      </FieldSelect>
    </div>
  );
}

function NextStepSection({
  value,
  disabled,
  onChange,
  onBlur,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <section className="border-b border-border p-4">
      <label>
        <span className="mb-2 block text-xs text-fg-dim">Next step</span>
        <input
          aria-label="Next step"
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
          onBlur={onBlur}
          className="h-9 w-full rounded-sm border border-border bg-bg px-3 text-sm text-fg focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
          placeholder="Add the next concrete action"
        />
      </label>
    </section>
  );
}

function BoardObjectDetails({
  item,
  lane,
  blocked,
}: {
  item: boards.BoardItemRow;
  lane: boards.BoardLaneRow | null;
  blocked: boolean;
}) {
  const timezone = useWorkspaceTimezone();
  return (
    <dl className="grid grid-cols-2 gap-px border-b border-border bg-border text-sm">
      <Detail label="Board lane" value={lane?.name ?? 'Unset'} danger={blocked} />
      <Detail label="Object status" value={statusLabel(item.object.status)} />
      {isSchedulableObjectType(item.object.type) ? (
        <Detail
          label="Object due"
          value={<DueDateDisplay value={item.object.dueAt} timezone={timezone} variant="inline" />}
        />
      ) : null}
      <Detail
        label="Object priority"
        value={item.object.priority ? `P${item.object.priority}` : '-'}
      />
      <Detail label="Object stage" value={item.object.stage ?? '-'} />
    </dl>
  );
}

function BoardNotesSection({
  item,
  editing,
  value,
  disabled,
  onChange,
  onEdit,
  onSave,
}: {
  item: boards.BoardItemRow;
  editing: boolean;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
}) {
  const timezone = useWorkspaceTimezone();
  return (
    <section className="border-b border-border p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-xs text-fg-dim">Board notes</h3>
        <button
          type="button"
          disabled={disabled}
          onClick={editing ? onSave : onEdit}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2 py-1 text-xs font-medium hover:bg-surface disabled:opacity-40"
        >
          {editing ? <Save className="size-3" aria-hidden="true" /> : null}
          {editing ? 'Save' : item.notes ? 'Edit' : 'Add'}
        </button>
      </div>
      {editing ? (
        <textarea
          aria-label="Board notes"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          rows={4}
          className="w-full resize-none rounded-sm border border-border bg-bg px-3 py-2 text-sm focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        />
      ) : (
        <p
          className={cn(
            'whitespace-pre-wrap text-sm',
            item.notes ? 'text-fg-muted' : 'text-fg-dim',
          )}
        >
          {item.notes ? displayText(item.notes, { timezone }) : 'No notes yet.'}
        </p>
      )}
    </section>
  );
}

function BoardActions({
  boardId,
  teamId,
  view,
  item,
  filterParams,
  onItemRemoved,
}: {
  boardId: string;
  teamId?: string;
  view: BoardLayout;
  item: boards.BoardItemRow;
  filterParams: Record<string, string>;
  onItemRemoved?: (itemId: string, entityId: string) => void;
}) {
  const timelineHref = `/app/timeline?q=${encodeURIComponent(item.object.canonicalName)}`;
  return (
    <div className="flex flex-wrap gap-2 border-b border-border p-4">
      <ObjectPreviewDialog item={item} view={view} filterParams={filterParams} />
      {teamId ? (
        <ContextualAskLink
          teamId={teamId}
          context={{
            pathname: `/app/boards/${boardId}`,
            routeKind: 'board-item',
            boardId,
            boardItemId: item.id,
            objectId: item.entityId,
          }}
          pinnedEntityId={item.entityId}
          pinnedEntityName={item.object.canonicalName}
          label="Ask about object"
          className="h-7 px-2 text-xs"
        />
      ) : null}
      <Link
        href={timelineHref}
        className="rounded-sm border border-border px-2 py-1 text-xs font-medium hover:bg-bg"
      >
        Timeline events
      </Link>
      <RemoveBoardItemButton
        boardId={boardId}
        itemId={item.id}
        objectName={item.object.canonicalName}
        view={view}
        filterParams={filterParams}
        onRemoved={() => {
          onItemRemoved?.(item.id, item.entityId);
        }}
      />
    </div>
  );
}

function BoardEvidence({
  changes,
  lanes,
  members,
}: {
  changes: boards.BoardItemChangeRow[];
  lanes: boards.BoardLaneRow[];
  members: BoardMemberOption[];
}) {
  const timezone = useWorkspaceTimezone();
  return (
    <section className="p-4">
      <h3 className="mb-2 text-xs text-fg-dim">Board provenance</h3>
      {changes.length === 0 ? (
        <p className="text-sm text-fg-muted">No source evidence linked to board changes yet.</p>
      ) : (
        <ul className="space-y-3">
          {changes.slice(0, 5).map((change) => {
            return (
              <li key={change.id} className="rounded-sm border border-border bg-surface p-3">
                <p className="text-xs font-medium text-fg">
                  {fieldLabel(change.field)} ·{' '}
                  {formatProvenanceChangeValue(change, lanes, members, timezone)}
                </p>
                {change.note ? (
                  <p className="mt-1 line-clamp-2 text-xs text-fg-muted">
                    {displayText(change.note, { timezone })}
                  </p>
                ) : null}
                <div className="mt-2 space-y-1">
                  {change.evidence.slice(0, 3).map((source) => (
                    <Link
                      key={source.rawEventId}
                      href={`/app/timeline?event=${source.rawEventId}#ev-${source.rawEventId}`}
                      className="block text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                    >
                      {displayText(source.source, { timezone })} ·{' '}
                      {formatDisplayDateTime(source.occurredAt, { timezone })}
                    </Link>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function BoardActivity({
  history,
  lanes,
  members,
}: {
  history: boards.BoardItemChangeRow[];
  lanes: boards.BoardLaneRow[];
  members: BoardMemberOption[];
}) {
  const timezone = useWorkspaceTimezone();
  return (
    <section className="border-t border-border p-4">
      <h3 className="mb-2 text-xs text-fg-dim">Activity</h3>
      {history.length === 0 ? (
        <p className="text-sm text-fg-muted">No board history yet.</p>
      ) : (
        <ol className="space-y-2">
          {history.map((change) => (
            <li key={change.id} className="rounded-sm border border-border p-3 text-xs">
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium text-fg">{fieldLabel(change.field)}</span>
                <span className="shrink-0 text-fg-dim">
                  {statusLabel(change.actorKind)} · {statusLabel(change.status)}
                </span>
              </div>
              <p className="mt-1 text-fg-muted">
                {formatChangeValue(change.field, change.previousValue, lanes, members, timezone)}
                <span className="px-1 text-fg-dim">→</span>
                {formatChangeValue(change.field, change.newValue, lanes, members, timezone)}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-fg-dim">
                <span>{formatDisplayDateTime(change.changedAt, { timezone })}</span>
              </div>
              {change.note ? (
                <p className="mt-2 text-fg">{displayText(change.note, { timezone })}</p>
              ) : null}
              {change.field === 'customFields' ||
              change.field === '__add__' ||
              change.field === '__remove__' ? (
                <TechnicalDetails
                  className="mt-3"
                  items={[
                    {
                      label:
                        change.field === 'customFields'
                          ? 'Previous custom fields'
                          : 'Previous board payload',
                      ...technicalJsonValue(change.previousValue),
                    },
                    {
                      label:
                        change.field === 'customFields' ? 'New custom fields' : 'New board payload',
                      ...technicalJsonValue(change.newValue),
                    },
                  ]}
                />
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ObjectPreviewDialog({
  item,
  view,
  filterParams,
}: {
  item: boards.BoardItemRow;
  view: BoardLayout;
  filterParams: Record<string, string>;
}) {
  const timezone = useWorkspaceTimezone();
  const title = displayObjectTitle(item.object);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded-sm border border-border px-2 py-1 text-xs font-medium hover:bg-surface"
        >
          Open object
        </button>
      </DialogTrigger>
      <DialogContent className="border-border bg-bg sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{displayText(title)}</DialogTitle>
          <DialogDescription className="text-xs">
            {statusLabel(item.object.type)} · object preview
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border text-sm">
          <Detail label="Status" value={statusLabel(item.object.status)} />
          <Detail label="Stage" value={item.object.stage ?? '-'} />
          <Detail
            label="Priority"
            value={item.object.priority ? `P${item.object.priority}` : '-'}
          />
          {isSchedulableObjectType(item.object.type) ? (
            <Detail
              label="Due"
              value={
                <DueDateDisplay value={item.object.dueAt} timezone={timezone} variant="inline" />
              }
            />
          ) : null}
        </dl>
        {item.object.type === 'task' ? (
          <section>
            <h3 className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
              Category
            </h3>
            <TaskCategorySelect
              taskId={item.object.id}
              category={item.object.taskCategory}
              mode={item.object.taskCategoryMode}
              status={item.object.taskCategoryStatus}
              updatedAt={item.object.taskCategoryUpdatedAt}
            />
          </section>
        ) : null}
        {item.object.aliases.length > 0 ? (
          <section>
            <h3 className="mb-1 text-xs text-fg-dim">Aliases</h3>
            <p className="text-sm text-fg-muted">
              {item.object.aliases.map((alias) => displayText(alias)).join(', ')}
            </p>
          </section>
        ) : null}
        <div className="flex justify-end">
          <Link
            href={objectDetailHref(
              item.entityId,
              boardViewHref(item.boardId, view, item.id, filterParams),
            )}
            className="inline-flex items-center gap-2 rounded-sm border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            Go to object page
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldSelect({
  label,
  value,
  disabled,
  onChange,
  children,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="block bg-bg p-3">
      <span className="mb-1 block text-[11px] text-fg-dim">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-sm text-fg focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
      >
        {children}
      </select>
    </label>
  );
}

function FieldInput({
  label,
  type,
  value,
  placeholder,
  disabled,
  onChange,
  hint,
}: {
  label: string;
  type: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
  hint?: ReactNode;
}) {
  return (
    <label className="block bg-bg p-3">
      <span className="mb-1 block text-[11px] text-fg-dim">{label}</span>
      <input
        aria-label={label}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-sm text-fg focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
      />
      {hint ? <span className="mt-1 block">{hint}</span> : null}
    </label>
  );
}

function Detail({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="bg-bg p-2">
      <dt className="text-[11px] text-fg-dim">{label}</dt>
      <dd className={cn('mt-1 truncate text-sm text-fg', danger && 'text-danger')}>{value}</dd>
    </div>
  );
}

function previousBoardItemPatch(
  item: boards.BoardItemRow,
  patch: BoardItemOptimisticPatch,
): BoardItemOptimisticPatch {
  const previous: BoardItemOptimisticPatch = {};
  if (patch.laneId !== undefined) previous.laneId = item.laneId;
  if (patch.responsibleUserId !== undefined) previous.responsibleUserId = item.responsibleUserId;
  if (patch.dueAt !== undefined) previous.dueAt = item.dueAt;
  if (patch.priority !== undefined) previous.priority = item.priority;
  if (patch.nextStep !== undefined) previous.nextStep = item.nextStep;
  if (patch.notes !== undefined) previous.notes = item.notes;
  return previous;
}

function boardItemPatchLabel(patch: BoardItemOptimisticPatch): string {
  if (patch.laneId !== undefined) return 'lane';
  if (patch.responsibleUserId !== undefined) return 'responsible';
  if (patch.dueAt !== undefined) return 'due date';
  if (patch.priority !== undefined) return 'priority';
  if (patch.nextStep !== undefined) return 'next step';
  if (patch.notes !== undefined) return 'notes';
  return 'card';
}

function capitalizeLabel(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function dateInputValue(value: Date, timezone: string): string {
  return presentDueDate(value, { timezone }).dateKey ?? '';
}

function dateLabel(value: Date, timezone: string): string {
  return formatDisplayDate(value, { timezone });
}

function fieldLabel(field: boards.BoardItemField): string {
  switch (field) {
    case '__add__':
      return 'Added to board';
    case '__remove__':
      return 'Removed from board';
    case 'laneId':
      return 'Lane';
    case 'position':
      return 'Position';
    case 'responsibleUserId':
      return 'Responsible';
    case 'dueAt':
      return 'Due date';
    case 'priority':
      return 'Priority';
    case 'nextStep':
      return 'Next step';
    case 'notes':
      return 'Notes';
    case 'customFields':
      return 'Custom fields';
  }
}

function formatChangeValue(
  field: boards.BoardItemField,
  value: unknown,
  lanes: boards.BoardLaneRow[],
  members: BoardMemberOption[],
  timezone: string,
): string {
  if (field === '__add__' || field === '__remove__') {
    if (value === null || value === undefined || value === '') return 'Not on board';
    if (typeof value !== 'object' || Array.isArray(value)) return 'Board membership';
    const laneId = 'laneId' in value && typeof value.laneId === 'string' ? value.laneId : null;
    return laneId
      ? displayText(lanes.find((lane) => lane.id === laneId)?.name ?? 'Board membership')
      : 'Board membership';
  }
  if (value === null || value === undefined || value === '') return 'empty';
  if (field === 'customFields') return customFieldsSummary(value);
  if (field === 'laneId' && typeof value === 'string') {
    return displayText(lanes.find((lane) => lane.id === value)?.name ?? 'Unknown lane');
  }
  if (field === 'responsibleUserId' && typeof value === 'string') {
    return displayText(members.find((member) => member.id === value)?.label ?? 'Assigned');
  }
  if (field === 'dueAt' && typeof value === 'string') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? dateLabel(date, timezone) : displayText(value);
  }
  if (field === 'priority' && typeof value === 'number') return `P${value}`;
  if (typeof value === 'string') return displayText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return displayText(JSON.stringify(value));
}

function customFieldsSummary(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'No custom fields';
  const count = Object.keys(value).length;
  return count === 0
    ? 'No custom fields'
    : `${String(count)} custom field${count === 1 ? '' : 's'}`;
}

function technicalJsonValue(value: unknown): { value: string; copyValue: string } {
  const serialized = JSON.stringify(value ?? null, null, 2);
  return { value: serialized.slice(0, 2_000), copyValue: serialized };
}

function formatProvenanceChangeValue(
  change: boards.BoardItemChangeRow,
  lanes: boards.BoardLaneRow[],
  members: BoardMemberOption[],
  timezone: string,
): string {
  if (change.field === '__add__' || change.field === '__remove__') {
    const value = change.field === '__remove__' ? change.previousValue : change.newValue;
    const laneId =
      typeof value === 'object' &&
      value !== null &&
      'laneId' in value &&
      typeof value.laneId === 'string'
        ? value.laneId
        : null;
    return laneId
      ? displayText(lanes.find((lane) => lane.id === laneId)?.name ?? 'Board membership')
      : 'Board membership';
  }
  return formatChangeValue(change.field, change.newValue, lanes, members, timezone);
}
