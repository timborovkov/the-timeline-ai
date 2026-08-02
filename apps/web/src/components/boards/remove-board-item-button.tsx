'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { removeBoardItemAction } from '@/app/actions/boards';
import { useAppDialog } from '@/components/ui/app-dialog';
import { boardViewHref, type BoardLayout } from '@/lib/board-links';
import { displayText } from '@/lib/display-dates';
import { errorMessage } from '@/lib/utils';

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
  const [error, setError] = useState<string | null>(null);

  async function removeItem(): Promise<void> {
    const confirmed = await dialog.confirm({
      title: 'Remove from board?',
      description: `${displayText(objectName)} will leave this board. The object itself will stay.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await removeBoardItemAction({ id: itemId, boardId });
        if ('error' in result && result.error) {
          setError(result.error);
          return;
        }
        onRemoved?.();
        router.push(boardViewHref(boardId, view, null, filterParams));
        router.refresh();
      } catch (err) {
        setError(errorMessage(err, 'Unable to remove this item from the board. Try again.'));
      }
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
      {error ? (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      ) : null}
      {dialog.node}
    </span>
  );
}
