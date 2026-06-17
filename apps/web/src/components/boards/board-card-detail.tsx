'use client';

import { ExternalLink, Save } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import type {
  BoardItemOptimisticPatch,
  BoardMemberOption,
} from '@/components/boards/board-detail-client';
import type { BoardLayout } from '@/lib/board-links';
import type * as boards from '@timeline/shared/boards';
import type { ReactNode } from 'react';

import { RemoveBoardItemButton } from '@/components/boards/remove-board-item-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { boardViewHref } from '@/lib/board-links';
import { displayText, formatDisplayDateTime } from '@/lib/display-dates';
import { objectDetailHref } from '@/lib/object-links';
import { cn } from '@/lib/utils';

interface Props {
  boardId: string;
  view: BoardLayout;
  item: boards.BoardItemRow | null;
  history: boards.BoardItemChangeRow[];
  lanes?: boards.BoardLaneRow[];
  members?: BoardMemberOption[];
  onUpdateItem?: (
    itemId: string,
    patch: BoardItemOptimisticPatch,
  ) => Promise<{ ok?: boolean; error?: string; id?: string }>;
  onItemRemoved?: (itemId: string, entityId: string) => void;
}

const EMPTY_LANES: boards.BoardLaneRow[] = [];
const EMPTY_MEMBERS: BoardMemberOption[] = [];

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
  boardId,
  view,
  item,
  history,
  lanes = EMPTY_LANES,
  members = EMPTY_MEMBERS,
  onUpdateItem,
  onItemRemoved,
}: Props) {
  const [draftState, setDraftState] = useState(() => draftStateForItem(item));
  const [pending, startTransition] = useTransition();
  const nextDraftState = reconcileDraftState(draftState, item);
  const currentDraftState = nextDraftState === draftState ? draftState : nextDraftState;
  if (nextDraftState !== draftState) setDraftState(nextDraftState);

  if (!item) return null;
  const sourceEvents = history.filter((change) => change.sourceEventId);
  const lane = lanes.find((candidate) => candidate.id === item.laneId) ?? null;
  const blocked = lane?.kind === 'blocked';

  function savePatch(patch: BoardItemOptimisticPatch, onSuccess?: () => void): void {
    if (!item || !onUpdateItem) return;
    startTransition(async () => {
      const result = await onUpdateItem(item.id, patch);
      if ('error' in result && result.error) {
        toast.error(result.error);
        return;
      }
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
      <BoardActions boardId={boardId} view={view} item={item} onItemRemoved={onItemRemoved} />
      <BoardEvidence sourceEvents={sourceEvents} />
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
}: {
  boardId: string;
  view: BoardLayout;
  item: boards.BoardItemRow;
  lane: boards.BoardLaneRow | null;
  blocked: boolean;
  nextStepDraft: string;
}) {
  const visibleNextStep = nextStepDraft.trim();
  return (
    <div className="border-b border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="whitespace-normal break-words text-lg font-semibold leading-snug text-fg">
            {displayText(item.object.canonicalName)}
          </h2>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            {item.object.type} · board item
          </p>
        </div>
        <Link
          href={boardViewHref(boardId, view, null)}
          className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted hover:text-fg"
        >
          Close
        </Link>
      </div>
      {blocked && lane ? (
        <p className="mt-3 inline-flex rounded-sm border border-danger/40 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-danger">
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
        value={item.dueAt ? dateInputValue(item.dueAt) : ''}
        placeholder="No due date"
        disabled={disabled}
        onChange={(value) => {
          onPatch({ dueAt: value ? new Date(`${value}T00:00:00.000Z`) : null });
        }}
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
        <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          Next step
        </span>
        <input
          aria-label="Next step"
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
          onBlur={onBlur}
          className="h-9 w-full rounded-sm border border-border bg-bg px-3 text-sm text-fg focus:border-border-strong focus:outline-none disabled:opacity-50"
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
  return (
    <dl className="grid grid-cols-2 gap-px border-b border-border bg-border text-sm">
      <Detail label="Board lane" value={lane?.name ?? 'Unset'} danger={blocked} />
      <Detail label="Object status" value={item.object.status} />
      <Detail label="Object due" value={item.object.dueAt ? dateLabel(item.object.dueAt) : '-'} />
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
  return (
    <section className="border-b border-border p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          Board notes
        </h3>
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
          className="w-full resize-none rounded-sm border border-border bg-bg px-3 py-2 text-sm focus:border-border-strong focus:outline-none"
        />
      ) : (
        <p
          className={cn(
            'whitespace-pre-wrap text-sm',
            item.notes ? 'text-fg-muted' : 'text-fg-dim',
          )}
        >
          {item.notes ? displayText(item.notes) : 'No notes yet.'}
        </p>
      )}
    </section>
  );
}

function BoardActions({
  boardId,
  view,
  item,
  onItemRemoved,
}: {
  boardId: string;
  view: BoardLayout;
  item: boards.BoardItemRow;
  onItemRemoved?: (itemId: string, entityId: string) => void;
}) {
  const timelineHref = `/app/timeline?q=${encodeURIComponent(item.object.canonicalName)}`;
  return (
    <div className="flex flex-wrap gap-2 border-b border-border p-4">
      <ObjectPreviewDialog item={item} view={view} />
      <Link
        href={`/app/chat?object=${item.entityId}`}
        className="rounded-sm border border-border px-2 py-1 text-xs font-medium hover:bg-surface"
      >
        Ask about object
      </Link>
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
        onRemoved={() => {
          onItemRemoved?.(item.id, item.entityId);
        }}
      />
    </div>
  );
}

function BoardEvidence({ sourceEvents }: { sourceEvents: boards.BoardItemChangeRow[] }) {
  return (
    <section className="p-4">
      <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
        Evidence
      </h3>
      {sourceEvents.length === 0 ? (
        <p className="text-sm text-fg-muted">No source evidence linked to board changes yet.</p>
      ) : (
        <ul className="space-y-1">
          {sourceEvents.slice(0, 5).map((change) => (
            <li key={change.id}>
              <Link
                href={`/app/timeline?event=${change.sourceEventId}#ev-${change.sourceEventId}`}
                className="text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
              >
                {change.field} source · {change.changedAt.toLocaleDateString('en-CA')}
              </Link>
            </li>
          ))}
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
  return (
    <section className="border-t border-border p-4">
      <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
        Activity
      </h3>
      {history.length === 0 ? (
        <p className="text-sm text-fg-muted">No board history yet.</p>
      ) : (
        <ol className="space-y-2">
          {history.map((change) => (
            <li key={change.id} className="rounded-sm border border-border p-3 text-xs">
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium text-fg">{fieldLabel(change.field)}</span>
                <span className="shrink-0 font-mono uppercase tracking-[0.1em] text-fg-dim">
                  {change.actorKind} · {change.status}
                </span>
              </div>
              <p className="mt-1 text-fg-muted">
                {formatChangeValue(change.field, change.previousValue, lanes, members)}
                <span className="px-1 text-fg-dim">→</span>
                {formatChangeValue(change.field, change.newValue, lanes, members)}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-fg-dim">
                <span>{formatDisplayDateTime(change.changedAt)}</span>
                {change.sourceEventId ? (
                  <Link
                    href={`/app/timeline?event=${change.sourceEventId}#ev-${change.sourceEventId}`}
                    className="underline-offset-2 hover:text-fg hover:underline"
                  >
                    Source event
                  </Link>
                ) : null}
              </div>
              {change.note ? <p className="mt-2 text-fg">{displayText(change.note)}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ObjectPreviewDialog({ item, view }: { item: boards.BoardItemRow; view: BoardLayout }) {
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
          <DialogTitle>{displayText(item.object.canonicalName)}</DialogTitle>
          <DialogDescription className="font-mono text-[11px] uppercase tracking-[0.12em]">
            {item.object.type} · object preview
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border text-sm">
          <Detail label="Status" value={item.object.status} />
          <Detail label="Stage" value={item.object.stage ?? '-'} />
          <Detail
            label="Priority"
            value={item.object.priority ? `P${item.object.priority}` : '-'}
          />
          <Detail label="Due" value={item.object.dueAt ? dateLabel(item.object.dueAt) : '-'} />
        </dl>
        {item.object.aliases.length > 0 ? (
          <section>
            <h3 className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
              Aliases
            </h3>
            <p className="text-sm text-fg-muted">
              {item.object.aliases.map(displayText).join(', ')}
            </p>
          </section>
        ) : null}
        <div className="flex justify-end">
          <Link
            href={objectDetailHref(item.entityId, boardViewHref(item.boardId, view, item.id))}
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
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
        {label}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-sm text-fg focus:border-border-strong focus:outline-none disabled:opacity-50"
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
}: {
  label: string;
  type: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block bg-bg p-3">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-sm text-fg focus:border-border-strong focus:outline-none disabled:opacity-50"
      />
    </label>
  );
}

function Detail({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="bg-bg p-2">
      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">{label}</dt>
      <dd className={cn('mt-1 truncate text-sm text-fg', danger && 'text-danger')}>{value}</dd>
    </div>
  );
}

function dateInputValue(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

function dateLabel(value: Date): string {
  return new Date(value).toLocaleDateString('en-CA');
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
): string {
  if (value === null || value === undefined || value === '') return 'empty';
  if (field === 'laneId' && typeof value === 'string') {
    return displayText(lanes.find((lane) => lane.id === value)?.name ?? 'Unknown lane');
  }
  if (field === 'responsibleUserId' && typeof value === 'string') {
    return displayText(members.find((member) => member.id === value)?.label ?? 'Assigned');
  }
  if (field === 'dueAt' && typeof value === 'string') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? dateLabel(date) : displayText(value);
  }
  if (field === 'priority' && typeof value === 'number') return `P${value}`;
  if (typeof value === 'string') return displayText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return displayText(JSON.stringify(value));
}
