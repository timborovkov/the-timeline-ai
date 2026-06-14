'use client';

import { Boxes, ClipboardList, KanbanSquare, PackageOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useReducer, useTransition } from 'react';

import { createBoardAction } from '@/app/actions/boards';
import { BoardStageEditor, type EditableBoardStage } from '@/components/boards/board-stage-editor';
import { cn } from '@/lib/utils';

const PRESETS = [
  {
    kind: 'custom',
    label: 'Simple board',
    icon: Boxes,
    example: 'Anything your team wants to run',
    description: 'Start from a generic workflow and tune every stage.',
    placeholder: 'Team board',
    stages: [
      { name: 'Backlog', kind: 'active' },
      { name: 'In progress', kind: 'active' },
      { name: 'Review', kind: 'active' },
      { name: 'Done', kind: 'done' },
    ],
  },
  {
    kind: 'task_board',
    label: 'Task preset',
    icon: ClipboardList,
    example: 'Development, marketing, management',
    description: 'Start with task-oriented stages, then edit them.',
    placeholder: 'Development tasks',
    stages: [
      { name: 'Backlog', kind: 'active' },
      { name: 'Ready', kind: 'active' },
      { name: 'Doing', kind: 'active' },
      { name: 'Review', kind: 'active' },
      { name: 'Done', kind: 'done' },
    ],
  },
  {
    kind: 'pipeline',
    label: 'Pipeline preset',
    icon: KanbanSquare,
    example: 'Sales, partnerships, delivery',
    description: 'Start with staged progress, then edit the stages.',
    placeholder: 'Team pipeline',
    stages: [
      { name: 'New', kind: 'active' },
      { name: 'Qualified', kind: 'active' },
      { name: 'Scoping', kind: 'active' },
      { name: 'Proposal', kind: 'active' },
      { name: 'Committed', kind: 'done' },
    ],
  },
  {
    kind: 'catalog',
    label: 'Catalog preset',
    icon: PackageOpen,
    example: 'Products, services, vendors',
    description: 'Start with inventory stages, then edit them.',
    placeholder: 'Product catalog',
    stages: [
      { name: 'Idea', kind: 'active' },
      { name: 'Evaluating', kind: 'active' },
      { name: 'Active', kind: 'active' },
      { name: 'Deprecated', kind: 'terminal' },
    ],
  },
] as const;

type TemplateKind = (typeof PRESETS)[number]['kind'];

interface BoardFormState {
  error: string | null;
  name: string;
  templateKind: TemplateKind;
  purpose: string;
  stages: EditableBoardStage[];
}

type BoardFormAction =
  | { type: 'error'; error: string | null }
  | { type: 'name'; name: string }
  | { type: 'preset'; templateKind: TemplateKind; name: string; stages: EditableBoardStage[] }
  | { type: 'purpose'; purpose: string }
  | { type: 'stages'; stages: EditableBoardStage[] };

function reducer(state: BoardFormState, action: BoardFormAction): BoardFormState {
  switch (action.type) {
    case 'error':
      return { ...state, error: action.error };
    case 'name':
      return { ...state, name: action.name };
    case 'preset':
      return {
        ...state,
        templateKind: action.templateKind,
        name: state.name.trim() ? state.name : action.name,
        stages: action.stages,
      };
    case 'purpose':
      return { ...state, purpose: action.purpose };
    case 'stages':
      return { ...state, stages: action.stages };
  }
}

export function BoardCreateForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [{ error, name, templateKind, purpose, stages }, dispatch] = useReducer(reducer, {
    error: null,
    name: 'Team board',
    templateKind: 'custom',
    purpose: '',
    stages: [...PRESETS[0].stages],
  });

  function submit(): void {
    if (!name.trim()) return;
    const lanes = stages.map((stage) => ({ ...stage, name: stage.name.trim() }));
    if (lanes.some((stage) => !stage.name)) {
      dispatch({ type: 'error', error: 'Stage names are required' });
      return;
    }
    dispatch({ type: 'error', error: null });
    startTransition(async () => {
      const result = await createBoardAction({
        name: name.trim(),
        templateKind,
        purpose: purpose.trim() || undefined,
        lanes,
      });
      if ('error' in result && result.error) {
        dispatch({ type: 'error', error: result.error });
        return;
      }
      if ('id' in result && result.id) router.push(`/app/boards/${result.id}`);
    });
  }

  return (
    <div>
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
        New board
      </h2>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        {PRESETS.map((preset) => {
          const Icon = preset.icon;
          const active = preset.kind === templateKind;
          return (
            <button
              key={preset.kind}
              type="button"
              onClick={() => {
                dispatch({
                  type: 'preset',
                  templateKind: preset.kind,
                  name: preset.placeholder,
                  stages: [...preset.stages],
                });
              }}
              className={cn(
                'min-h-[9.5rem] rounded-sm border border-border bg-bg p-3 text-left transition-colors hover:border-border-strong',
                active && 'border-signal bg-signal-soft',
              )}
            >
              <Icon className="mb-3 size-4 text-fg" aria-hidden="true" />
              <span className="block text-sm font-medium text-fg">{preset.label}</span>
              <span className="mt-1 block text-xs text-fg-muted">{preset.description}</span>
              <span className="mt-3 block font-mono text-[10px] uppercase tracking-[0.1em] text-fg-dim">
                {preset.example}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            Name
          </span>
          <input
            value={name}
            onChange={(e) => {
              dispatch({ type: 'name', name: e.target.value });
            }}
            className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm focus:border-border-strong focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            Purpose
          </span>
          <input
            value={purpose}
            onChange={(e) => {
              dispatch({ type: 'purpose', purpose: e.target.value });
            }}
            placeholder="Optional instructions for teammates and Timeline"
            className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm focus:border-border-strong focus:outline-none"
          />
        </label>
      </div>
      <BoardStageEditor
        stages={stages}
        onChange={(nextStages) => {
          dispatch({ type: 'stages', stages: nextStages });
        }}
        disabled={pending}
        className="mt-4"
      />
      {error && (
        <p
          role="alert"
          className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-danger"
        >
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending || !name.trim()}
        className="mt-4 rounded-sm bg-signal px-3 py-1.5 text-sm font-medium text-signal-fg hover:opacity-90 disabled:opacity-40"
      >
        {pending ? 'Creating...' : 'Create board'}
      </button>
    </div>
  );
}
