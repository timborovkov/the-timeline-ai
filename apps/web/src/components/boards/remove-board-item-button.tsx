'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { removeBoardItemAction } from '@/app/actions/boards';
import { useAppDialog } from '@/components/ui/app-dialog';
import { boardViewHref, type BoardLayout } from '@/lib/board-links';
import { displayText } from '@/lib/display-dates';
import { notifyAction } from '@/lib/notify';

const EMPTY_FILTER_PARAMS: Record<string, string> = {};

export function RemoveBoardItemButton({
  boardId,
  itemId,
  objectName,
  view,
  filterParams = EMPTY_FILTER_PARAMS,
  onRemoved,
}: {
  boardId: string;
  itemId: string;
  objectName: string;
  view: BoardLayout;
  filterParams?: Record<string, string>;
  onRemoved?: () => void;
}) {
  const router = useRouter();
  const dialog = useAppDialog();
  const [pending, startTransition] = useTransition();

  async function removeItem(): Promise<void> {
    const confirmed = await dialog.confirm({
      title: 'Remove from board?',
      description: `${displayText(objectName)} will leave this board. The object itself will stay.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!confirmed) return;
    startTransition(async () => {
      const result = await notifyAction({
        id: `board:${boardId}:remove:${itemId}`,
        loading: 'Removing from board…',
        success: 'Removed from board',
        error: 'Couldn’t remove from board',
        run: () => removeBoardItemAction({ id: itemId, boardId }),
      });
      if (result.error) return;
      onRemoved?.();
      router.push(boardViewHref(boardId, view, null, filterParams));
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          void removeItem();
        }}
        className="inline-flex items-center gap-1.5 rounded-sm border border-danger/40 px-2 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        {pending ? 'Removing…' : 'Remove from board'}
      </button>
      {dialog.node}
    </span>
  );
}
