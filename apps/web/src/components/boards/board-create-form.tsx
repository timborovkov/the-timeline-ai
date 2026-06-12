'use client';

import { Boxes, ClipboardList, KanbanSquare, PackageOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useReducer, useTransition } from 'react';

import { createBoardAction } from '@/app/actions/boards';
import { cn } from '@/lib/utils';

const TEMPLATES = [
  {
    kind: 'pipeline',
    label: 'Pipeline',
    icon: KanbanSquare,
    example: 'Pilot pipeline, sales, partnerships',
    description: 'Track companies, deals, or projects through relationship stages.',
    placeholder: 'Pilot pipeline',
  },
  {
    kind: 'task_board',
    label: 'Task board',
    icon: ClipboardList,
    example: 'Development, marketing, management',
    description: 'Track tasks and follow-ups through an operational workflow.',
    placeholder: 'Development tasks',
  },
  {
    kind: 'catalog',
    label: 'Catalog',
    icon: PackageOpen,
    example: 'Products, services, vendors',
    description: 'Track a curated inventory of reference objects.',
    placeholder: 'Product catalog',
  },
  {
    kind: 'custom',
    label: 'Custom',
    icon: Boxes,
    example: 'Anything your team wants to run',
    description: 'Start with simple lanes and tune the board as you go.',
    placeholder: 'Management review',
  },
] as const;

type TemplateKind = (typeof TEMPLATES)[number]['kind'];

interface BoardFormState {
  error: string | null;
  name: string;
  templateKind: TemplateKind;
  purpose: string;
}

type BoardFormAction =
  | { type: 'error'; error: string | null }
  | { type: 'name'; name: string }
  | { type: 'templateKind'; templateKind: TemplateKind; name: string }
  | { type: 'purpose'; purpose: string };

function reducer(state: BoardFormState, action: BoardFormAction): BoardFormState {
  switch (action.type) {
    case 'error':
      return { ...state, error: action.error };
    case 'name':
      return { ...state, name: action.name };
    case 'templateKind':
      return {
        ...state,
        templateKind: action.templateKind,
        name: state.name.trim() ? state.name : action.name,
      };
    case 'purpose':
      return { ...state, purpose: action.purpose };
  }
}

export function BoardCreateForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [{ error, name, templateKind, purpose }, dispatch] = useReducer(reducer, {
    error: null,
    name: 'Pilot pipeline',
    templateKind: 'pipeline',
    purpose: '',
  });

  function submit(): void {
    if (!name.trim()) return;
    dispatch({ type: 'error', error: null });
    startTransition(async () => {
      const result = await createBoardAction({
        name: name.trim(),
        templateKind,
        purpose: purpose.trim() || undefined,
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
        {TEMPLATES.map((template) => {
          const Icon = template.icon;
          const active = template.kind === templateKind;
          return (
            <button
              key={template.kind}
              type="button"
              onClick={() => {
                dispatch({
                  type: 'templateKind',
                  templateKind: template.kind,
                  name: template.placeholder,
                });
              }}
              className={cn(
                'min-h-[9.5rem] rounded-sm border border-border bg-bg p-3 text-left transition-colors hover:border-border-strong',
                active && 'border-signal bg-signal-soft',
              )}
            >
              <Icon className="mb-3 size-4 text-fg" aria-hidden="true" />
              <span className="block text-sm font-medium text-fg">{template.label}</span>
              <span className="mt-1 block text-xs text-fg-muted">{template.description}</span>
              <span className="mt-3 block font-mono text-[10px] uppercase tracking-[0.1em] text-fg-dim">
                {template.example}
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
