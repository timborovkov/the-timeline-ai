'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import type { BoardItemOptimisticPatch } from '@/components/boards/board-detail-client';
import type * as boards from '@timeline/shared/boards';

import { boardViewHref, type BoardLayout } from '@/lib/board-links';

export interface BoardMemberOption {
  id: string;
  label: string;
}

const EMPTY_LANES: boards.BoardLaneRow[] = [];
const EMPTY_MEMBERS: BoardMemberOption[] = [];

export function CuratedBoardTable({
  boardId,
  view,
  lanes = EMPTY_LANES,
  items,
  members = EMPTY_MEMBERS,
  onUpdateItem,
}: {
  boardId: string;
  view: BoardLayout;
  lanes?: boards.BoardLaneRow[];
  items: boards.BoardItemRow[];
  members?: BoardMemberOption[];
  onUpdateItem?: (
    itemId: string,
    patch: BoardItemOptimisticPatch,
  ) => Promise<{ ok?: boolean; error?: string; id?: string }>;
}) {
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (items.length === 0) return <EmptyBoardItems />;

  function updateItem(id: string, patch: BoardItemOptimisticPatch): void {
    if (!onUpdateItem) return;
    const field = Object.keys(patch)[0] ?? 'field';
    setSaving((current) => ({ ...current, [id]: field }));
    setErrors((current) => {
      const { [id]: _cleared, ...rest } = current;
      return rest;
    });
    startTransition(async () => {
      const result = await onUpdateItem(id, patch);
      if ('error' in result && result.error) {
        setErrors((current) => ({ ...current, [id]: result.error ?? 'Save failed' }));
      }
      setSaving((current) => {
        const { [id]: _done, ...rest } = current;
        return rest;
      });
    });
  }

  return (
    <div className="overflow-x-auto rounded-sm border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-bg text-left font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
          <tr>
            <th className="px-3 py-2 font-normal">Name</th>
            <th className="px-3 py-2 font-normal">Type</th>
            <th className="px-3 py-2 font-normal">Responsible</th>
            <th className="px-3 py-2 font-normal">Due</th>
            <th className="px-3 py-2 font-normal">Priority</th>
            <th className="px-3 py-2 font-normal">Lane</th>
            <th className="px-3 py-2 font-normal">Next step</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const optimistic = isOptimisticItem(item);
            return (
              <tr key={item.id} className="border-t border-border transition-colors hover:bg-bg">
                <td className="px-3 py-2">
                  {optimistic ? (
                    <span className="font-medium text-fg">{item.object.canonicalName}</span>
                  ) : (
                    <Link
                      href={boardViewHref(boardId, view, item.id)}
                      className="font-medium hover:underline"
                    >
                      {item.object.canonicalName}
                    </Link>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-fg-muted">{item.object.type}</td>
                <td className="min-w-40 px-3 py-2">
                  <select
                    value={item.responsibleUserId ?? ''}
                    disabled={optimistic || !onUpdateItem}
                    onChange={(event) => {
                      updateItem(item.id, { responsibleUserId: event.target.value || null });
                    }}
                    className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
                    aria-label={`Responsible person for ${item.object.canonicalName}`}
                  >
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="min-w-36 px-3 py-2">
                  <input
                    type="date"
                    value={item.dueAt ? new Date(item.dueAt).toISOString().slice(0, 10) : ''}
                    disabled={optimistic || !onUpdateItem}
                    onChange={(event) => {
                      updateItem(item.id, {
                        dueAt: event.target.value
                          ? new Date(`${event.target.value}T09:00:00.000Z`)
                          : null,
                      });
                    }}
                    className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
                    aria-label={`Due date for ${item.object.canonicalName}`}
                  />
                </td>
                <td className="min-w-28 px-3 py-2">
                  <select
                    value={item.priority ?? ''}
                    disabled={optimistic || !onUpdateItem}
                    onChange={(event) => {
                      updateItem(item.id, {
                        priority: event.target.value ? Number(event.target.value) : null,
                      });
                    }}
                    className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
                    aria-label={`Priority for ${item.object.canonicalName}`}
                  >
                    <option value="">None</option>
                    {[1, 2, 3, 4].map((priority) => (
                      <option key={priority} value={priority}>
                        P{priority}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="min-w-36 px-3 py-2">
                  <select
                    value={item.laneId ?? ''}
                    disabled={optimistic || !onUpdateItem}
                    onChange={(event) => {
                      updateItem(item.id, { laneId: event.target.value || null });
                    }}
                    className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
                    aria-label={`Lane for ${item.object.canonicalName}`}
                  >
                    <option value="">Unset</option>
                    {lanes.map((lane) => (
                      <option key={lane.id} value={lane.id}>
                        {lane.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="min-w-64 px-3 py-2">
                  <BoardNextStepInput
                    key={`${item.id}:${item.nextStep ?? ''}`}
                    objectName={item.object.canonicalName}
                    nextStep={item.nextStep}
                    disabled={optimistic || !onUpdateItem}
                    onSave={(nextStep) => {
                      updateItem(item.id, { nextStep });
                    }}
                  />
                  {saving[item.id] ? (
                    <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-fg-dim">
                      Saving {saving[item.id]}...
                    </span>
                  ) : null}
                  {errors[item.id] ? (
                    <span className="mt-1 block text-xs text-danger">{errors[item.id]}</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BoardNextStepInput({
  objectName,
  nextStep,
  disabled,
  onSave,
}: {
  objectName: string;
  nextStep: string | null;
  disabled: boolean;
  onSave: (nextStep: string | null) => void;
}) {
  const [draft, setDraft] = useState(nextStep ?? '');

  return (
    <input
      value={draft}
      disabled={disabled}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
      }}
      onBlur={() => {
        const trimmed = draft.trim();
        if ((nextStep ?? '') !== trimmed) {
          onSave(trimmed || null);
        }
      }}
      className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
      aria-label={`Next step for ${objectName}`}
      placeholder="Next step"
    />
  );
}

export function CuratedBoardList({
  boardId,
  view,
  items,
}: {
  boardId: string;
  view: BoardLayout;
  items: boards.BoardItemRow[];
}) {
  if (items.length === 0) return <EmptyBoardItems />;
  return (
    <ul className="divide-y divide-border border border-border bg-surface">
      {items.map((item) => {
        const content = (
          <>
            <span className="min-w-0 flex-1 truncate font-medium text-fg">
              {item.object.canonicalName}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
              {item.object.type}
              {item.dueAt ? ` · ${new Date(item.dueAt).toLocaleDateString('en-CA')}` : ''}
            </span>
          </>
        );
        return (
          <li key={item.id}>
            {isOptimisticItem(item) ? (
              <span className="flex items-center justify-between gap-3 px-3 py-2 text-sm opacity-80">
                {content}
              </span>
            ) : (
              <Link
                href={boardViewHref(boardId, view, item.id)}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-bg"
              >
                {content}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function isOptimisticItem(item: boards.BoardItemRow): boolean {
  return item.id.startsWith('optimistic-');
}

function EmptyBoardItems() {
  return (
    <p className="py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
      NO BOARD ITEMS YET
    </p>
  );
}
