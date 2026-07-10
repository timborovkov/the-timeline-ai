'use client';

import { MoreHorizontal, Pencil, Pin, PinOff, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useReducer, useState, useTransition } from 'react';
import { toast } from 'sonner';

import type * as boards from '@timeline/shared/boards';

import {
  deleteBoardAction,
  pinBoardAction,
  unpinBoardAction,
  updateBoardSettingsAction,
} from '@/app/actions/boards';
import { BoardStageEditor, type EditableBoardStage } from '@/components/boards/board-stage-editor';
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
  const PinIcon = pinned ? PinOff : Pin;

  function togglePin(): void {
    startTransition(async () => {
      const result = pinned ? await unpinBoardAction({ id }) : await pinBoardAction({ id });
      if ('error' in result && result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  async function deleteBoard(): Promise<void> {
    const confirmed = await dialog.confirm({
      title: 'Delete board?',
      description: 'Objects are not affected.',
      confirmLabel: 'Delete board',
      destructive: true,
    });
    if (!confirmed) return;
    startTransition(async () => {
      const result = await deleteBoardAction({ id });
      if ('error' in result && result.error) {
        toast.error(result.error);
        return;
      }
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
          <DropdownMenuItem
            onSelect={() => {
              togglePin();
            }}
            disabled={pending}
          >
            <PinIcon className="size-3.5 text-fg-dim" aria-hidden="true" />
            {pinned ? 'Unpin board' : 'Pin board'}
          </DropdownMenuItem>
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
  const [draft, dispatchDraft] = useReducer(settingsDraftReducer, {
    name: initialName,
    purpose: initialPurpose,
    stages: initialLanes.map((lane) => ({ id: lane.id, name: lane.name, kind: lane.kind })),
  });

  function saveSettings(): void {
    const stages = draft.stages.map((stage) => ({ ...stage, name: stage.name.trim() }));
    if (!draft.name.trim()) {
      toast.error('Board name is required');
      return;
    }
    if (stages.some((stage) => !stage.name)) {
      toast.error('Stage names are required');
      return;
    }
    startTransition(async () => {
      const result = await updateBoardSettingsAction({
        id,
        name: draft.name.trim(),
        purpose: draft.purpose.trim(),
        lanes: stages,
      });
      if ('error' in result && result.error) {
        toast.error(result.error);
        return;
      }
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
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
              Name
            </span>
            <input
              value={draft.name}
              disabled={pending}
              onChange={(event) => {
                dispatchDraft({ type: 'name', name: event.target.value });
              }}
              className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
              Description
            </span>
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
            }}
            disabled={pending}
          />
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
