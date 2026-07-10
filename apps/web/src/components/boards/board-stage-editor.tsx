'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';

type BoardStageKind = 'active' | 'done' | 'terminal' | 'lost' | 'blocked';

export interface EditableBoardStage {
  id?: string;
  name: string;
  kind?: BoardStageKind | null;
}

interface Props {
  stages: EditableBoardStage[];
  onChange: (stages: EditableBoardStage[]) => void;
  disabled?: boolean;
  className?: string;
}

function normalizeStages(stages: EditableBoardStage[]): EditableBoardStage[] {
  return stages.length > 0 ? stages : [{ name: 'Backlog', kind: 'active' }];
}

function replaceAt(
  stages: EditableBoardStage[],
  index: number,
  stage: EditableBoardStage,
): EditableBoardStage[] {
  return stages.map((current, idx) => (idx === index ? stage : current));
}

function moveStage(
  stages: EditableBoardStage[],
  fromIndex: number,
  toIndex: number,
): EditableBoardStage[] {
  if (toIndex < 0 || toIndex >= stages.length) return stages;
  const next = [...stages];
  const [stage] = next.splice(fromIndex, 1);
  if (!stage) return stages;
  next.splice(toIndex, 0, stage);
  return next;
}

export function BoardStageEditor({ stages, onChange, disabled = false, className }: Props) {
  const rows = normalizeStages(stages);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
          Stages
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onChange([...rows, { name: 'New stage', kind: 'active' }]);
          }}
          className="inline-flex items-center gap-1 rounded-sm border border-border bg-bg px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-40"
        >
          <Plus className="size-3" aria-hidden="true" />
          Stage
        </button>
      </div>
      <ol className="space-y-1">
        {rows.map((stage, index) => (
          <li key={stage.id ?? `new-${index}`} className="flex items-center gap-1">
            <span className="w-6 text-center font-mono text-[10px] text-fg-dim">{index + 1}</span>
            <input
              value={stage.name}
              disabled={disabled}
              onChange={(event) => {
                onChange(replaceAt(rows, index, { ...stage, name: event.target.value }));
              }}
              aria-label={`Stage ${index + 1} name`}
              className="min-w-0 flex-1 rounded-sm border border-border bg-bg px-2 py-1.5 text-sm focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60"
            />
            <button
              type="button"
              disabled={disabled || index === 0}
              onClick={() => {
                onChange(moveStage(rows, index, index - 1));
              }}
              aria-label={`Move ${stage.name || `stage ${index + 1}`} up`}
              className="inline-flex size-8 items-center justify-center rounded-sm border border-border bg-bg text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-30"
            >
              <ArrowUp className="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={disabled || index === rows.length - 1}
              onClick={() => {
                onChange(moveStage(rows, index, index + 1));
              }}
              aria-label={`Move ${stage.name || `stage ${index + 1}`} down`}
              className="inline-flex size-8 items-center justify-center rounded-sm border border-border bg-bg text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-30"
            >
              <ArrowDown className="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={disabled || rows.length <= 1}
              onClick={() => {
                onChange(rows.filter((_, idx) => idx !== index));
              }}
              aria-label={`Remove ${stage.name || `stage ${index + 1}`}`}
              className="inline-flex size-8 items-center justify-center rounded-sm border border-border bg-bg text-fg-muted transition-colors hover:border-danger/60 hover:text-danger disabled:opacity-30"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
