'use client';

import { MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import {
  deleteBoardAction,
  pinBoardAction,
  renameBoardAction,
  unpinBoardAction,
} from '@/app/actions/boards';
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
  pinned,
}: {
  id: string;
  name: string;
  pinned: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const PinIcon = pinned ? PinOff : Pin;

  function renameBoard(): void {
    const nextName = window.prompt('Board name', name);
    if (!nextName?.trim() || nextName.trim() === name) return;
    startTransition(async () => {
      const result = await renameBoardAction({ id, name: nextName.trim() });
      if ('error' in result && result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

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

  function deleteBoard(): void {
    if (!window.confirm('Delete this board? Objects are not affected.')) return;
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
            renameBoard();
          }}
          disabled={pending}
        >
          <Pencil className="size-3.5 text-fg-dim" aria-hidden="true" />
          Rename board
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
            deleteBoard();
          }}
          disabled={pending}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Delete board
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
