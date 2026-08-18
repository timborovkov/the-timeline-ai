'use client';

import { MoreHorizontal, Pencil, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useReducer, useState, useTransition } from 'react';

import type * as boards from '@timeline/shared/boards';

import { deleteBoardAction, updateBoardSettingsAction } from '@/app/actions/boards';
import { BoardStageEditor, type EditableBoardStage } from '@/components/boards/board-stage-editor';
import { PinMenuItem } from '@/components/pins/pin-menu-item';
import { useAppDialog } from '@/components/ui/app-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { notifyAction } from '@/lib/notify';

export function BoardActionsMenu({
  id,
  name,
  purpose,
  pinned,
  lanes,
}: {
  id: string;
  name: string;
  purpose: string;
  pinned: boolean;
  lanes: boards.BoardLaneRow[];
}) {
  const router = useRouter();
  const dialog = useAppDialog();
  const [pending, startTransition] = useTransition();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const activeLanes = useMemo(() => lanes.filter((lane) => !lane.archivedAt), [lanes]);
  async function deleteBoard(): Promise<void> {
    const confirmed = await dialog.confirm({
      title: 'Delete board?',
      description: 'Objects are not affected.',
      confirmLabel: 'Delete board',
      destructive: true,
    });
    if (!confirmed) return;
    startTransition(async () => {
      const result = await notifyAction({
        id: `board:${id}:delete`,
        loading: 'Deleting board…',
        success: 'Board deleted',
        error: 'Couldn’t delete board',
        run: async () => {
          const deleted = await deleteBoardAction({ id });
          return deleted.error ? { error: deleted.error } : {};
        },
      });
      if (result.error) return;
      router.push('/app/boards');
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={pending}
            className="inline-flex size-8 items-center justify-center rounded-sm border border-border bg-bg text-fg-muted transition-colors hover:border-border-strong hover:bg-surface hover:text-fg disabled:opacity-40"
            aria-label="Board actions"
            title="Board actions"
          >
            <MoreHorizontal className="size-3.5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem
            onSelect={() => {
              setSettingsOpen(true);
            }}
            disabled={pending}
          >
            <Pencil className="size-3.5 text-fg-dim" aria-hidden="true" />
            Board settings
          </DropdownMenuItem>
          <PinMenuItem target={{ kind: 'board', key: id }} title={name} initialPinned={pinned} />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              void deleteBoard();
            }}
            disabled={pending}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete board
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <BoardSettingsDialog
        key={`${id}:${settingsOpen ? 'open' : 'closed'}`}
        id={id}
        initialName={name}
        initialPurpose={purpose}
        initialLanes={activeLanes}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
      {dialog.node}
    </>
  );
}

function BoardSettingsDialog({
  id,
  initialName,
  initialPurpose,
  initialLanes,
  open,
  onOpenChange,
}: {
  id: string;
  initialName: string;
  initialPurpose: string;
  initialLanes: boards.BoardLaneRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fieldError, setFieldError] = useState<'name' | 'stages' | null>(null);
  const [draft, dispatchDraft] = useReducer(settingsDraftReducer, {
    name: initialName,
    purpose: initialPurpose,
    stages: initialLanes.map((lane) => ({ id: lane.id, name: lane.name, kind: lane.kind })),
  });

  function saveSettings(): void {
    const stages = draft.stages.map((stage) => ({ ...stage, name: stage.name.trim() }));
    if (!draft.name.trim()) {
      setFieldError('name');
      return;
    }
    if (stages.some((stage) => !stage.name)) {
      setFieldError('stages');
      return;
    }
    setFieldError(null);
    startTransition(async () => {
      const result = await notifyAction({
        id: `board:${id}:settings`,
        loading: 'Saving board settings…',
        success: 'Board settings saved',
        error: 'Couldn’t save board settings',
        run: async () => {
          const saved = await updateBoardSettingsAction({
            id,
            name: draft.name.trim(),
            purpose: draft.purpose.trim(),
            lanes: stages,
          });
          return saved.error ? { error: saved.error } : {};
        },
        undo: {
          run: async () => {
            const restored = await updateBoardSettingsAction({
              id,
              name: initialName,
              purpose: initialPurpose,
              lanes: initialLanes.map((lane) => ({
                id: lane.id,
                name: lane.name,
                kind: lane.kind,
              })),
            });
            if (!restored.error) router.refresh();
            return restored.error ? { error: restored.error } : {};
          },
        },
      });
      if (result.error) return;
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] overflow-y-auto border-border bg-bg sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Board settings</DialogTitle>
          <DialogDescription className="sr-only">Board settings form</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs text-fg-dim">Name</span>
            <input
              value={draft.name}
              disabled={pending}
              onChange={(event) => {
                dispatchDraft({ type: 'name', name: event.target.value });
                if (fieldError === 'name') setFieldError(null);
              }}
              aria-invalid={fieldError === 'name' ? true : undefined}
              className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60"
            />
            {fieldError === 'name' ? (
              <p role="alert" className="mt-1 text-xs text-danger">
                Board name is required
              </p>
            ) : null}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-fg-dim">Description</span>
            <textarea
              value={draft.purpose}
              disabled={pending}
              onChange={(event) => {
                dispatchDraft({ type: 'purpose', purpose: event.target.value });
              }}
              rows={3}
              placeholder="What this board is for"
              className="w-full resize-none rounded-sm border border-border bg-bg px-3 py-2 text-sm focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60"
            />
          </label>
          <BoardStageEditor
            stages={draft.stages}
            onChange={(stages) => {
              dispatchDraft({ type: 'stages', stages });
              if (fieldError === 'stages') setFieldError(null);
            }}
            disabled={pending}
          />
          {fieldError === 'stages' ? (
            <p role="alert" className="text-xs text-danger">
              Stage names are required
            </p>
          ) : null}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={pending}
              onClick={saveSettings}
              className="inline-flex items-center gap-2 rounded-sm bg-signal px-3 py-1.5 text-sm font-medium text-signal-fg hover:opacity-90 disabled:opacity-40"
            >
              <Save className="size-3.5" aria-hidden="true" />
              {pending ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SettingsDraft {
  name: string;
  purpose: string;
  stages: EditableBoardStage[];
}

type SettingsDraftAction =
  | { type: 'name'; name: string }
  | { type: 'purpose'; purpose: string }
  | { type: 'stages'; stages: EditableBoardStage[] };

function settingsDraftReducer(state: SettingsDraft, action: SettingsDraftAction): SettingsDraft {
  switch (action.type) {
    case 'name':
      return { ...state, name: action.name };
    case 'purpose':
      return { ...state, purpose: action.purpose };
    case 'stages':
      return { ...state, stages: action.stages };
  }
}
