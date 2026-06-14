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
import { cn } from '@/lib/utils';

interface Props {
  boardId: string;
  view: BoardLayout;
  item: boards.BoardItemRow | null;
  history: boards.BoardItemChangeRow[];
  members?: BoardMemberOption[];
  onUpdateItem?: (
    itemId: string,
    patch: BoardItemOptimisticPatch,
  ) => Promise<{ ok?: boolean; error?: string; id?: string }>;
  onItemRemoved?: (itemId: string, entityId: string) => void;
}

const EMPTY_MEMBERS: BoardMemberOption[] = [];

export function BoardCardDetail({
  boardId,
  view,
  item,
  history,
  members = EMPTY_MEMBERS,
  onUpdateItem,
  onItemRemoved,
}: Props) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [noteDraft, setNoteDraft] = useState(item?.notes ?? '');
  const [pending, startTransition] = useTransition();
  if (!item) return null;
  const timelineHref = `/app/timeline?q=${encodeURIComponent(item.object.canonicalName)}`;
  const sourceEvents = history.filter((change) => change.sourceEventId);

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
    savePatch({ notes: noteDraft.trim() || null }, () => {
      setEditingNotes(false);
    });
  }

  return (
    <aside className="rounded-sm border border-border bg-bg" aria-label="Board card detail">
      <div className="border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-fg">
              {displayText(item.object.canonicalName)}
            </h2>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
              {item.object.type} · board item
            </p>
          </div>
          <Link
            href={boardViewHref(boardId, view, null)}
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted hover:text-fg"
          >
            Close
          </Link>
        </div>
        {item.nextStep ? (
          <p className="mt-3 border-l border-signal pl-3 text-sm text-fg-muted">
            {displayText(item.nextStep)}
          </p>
        ) : null}
      </div>

      <div className="grid gap-px border-b border-border bg-border sm:grid-cols-3">
        <FieldSelect
          label="Responsible"
          value={item.responsibleUserId ?? ''}
          disabled={pending || !onUpdateItem}
          onChange={(value) => {
            savePatch({ responsibleUserId: value || null });
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
          disabled={pending || !onUpdateItem}
          onChange={(value) => {
            savePatch({ dueAt: value ? new Date(`${value}T00:00:00.000Z`) : null });
          }}
        />
        <FieldSelect
          label="Priority"
          value={item.priority ? String(item.priority) : ''}
          disabled={pending || !onUpdateItem}
          onChange={(value) => {
            savePatch({ priority: value ? Number(value) : null });
          }}
        >
          <option value="">No priority</option>
          <option value="1">P1</option>
          <option value="2">P2</option>
          <option value="3">P3</option>
          <option value="4">P4</option>
        </FieldSelect>
      </div>

      <dl className="grid grid-cols-2 gap-px border-b border-border bg-border text-sm">
        <Detail label="Object status" value={item.object.status} />
        <Detail label="Object due" value={item.object.dueAt ? dateLabel(item.object.dueAt) : '-'} />
        <Detail
          label="Object priority"
          value={item.object.priority ? `P${item.object.priority}` : '-'}
        />
        <Detail label="Object stage" value={item.object.stage ?? '-'} />
      </dl>

      <section className="border-b border-border p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
            Board notes
          </h3>
          <button
            type="button"
            disabled={pending || !onUpdateItem}
            onClick={() => {
              if (editingNotes) {
                saveNotes();
              } else {
                setNoteDraft(item.notes ?? '');
                setEditingNotes(true);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2 py-1 text-xs font-medium hover:bg-surface disabled:opacity-40"
          >
            {editingNotes ? <Save className="size-3" aria-hidden="true" /> : null}
            {editingNotes ? 'Save' : item.notes ? 'Edit' : 'Add'}
          </button>
        </div>
        {editingNotes ? (
          <textarea
            aria-label="Board notes"
            value={noteDraft}
            onChange={(event) => {
              setNoteDraft(event.target.value);
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

      <div className="flex flex-wrap gap-2 border-b border-border p-4">
        <ObjectPreviewDialog item={item} />
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

      <section className="mt-5">
        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          History
        </h3>
        {history.length === 0 ? (
          <p className="text-sm text-fg-muted">No board history yet.</p>
        ) : (
          <ol className="space-y-2">
            {history.map((change) => (
              <li key={change.id} className="border-l border-border pl-3 text-xs text-fg-muted">
                <span className="font-mono uppercase tracking-[0.1em] text-fg-dim">
                  {change.field} · {change.status}
                </span>
                <span className="block">{formatDisplayDateTime(change.changedAt)}</span>
                {change.note ? (
                  <span className="block text-fg">{displayText(change.note)}</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}

function ObjectPreviewDialog({ item }: { item: boards.BoardItemRow }) {
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
            href={`/app/objects/${item.entityId}`}
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg p-2">
      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">{label}</dt>
      <dd className="mt-1 truncate text-sm text-fg">{value}</dd>
    </div>
  );
}

function dateInputValue(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

function dateLabel(value: Date): string {
  return new Date(value).toLocaleDateString('en-CA');
}
