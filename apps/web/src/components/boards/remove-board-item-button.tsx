'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { removeBoardItemAction } from '@/app/actions/boards';
import { boardViewHref, type BoardLayout } from '@/lib/board-links';

export function RemoveBoardItemButton({
  boardId,
  itemId,
  objectName,
  view,
  onRemoved,
}: {
  boardId: string;
  itemId: string;
  objectName: string;
  view: BoardLayout;
  onRemoved?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Remove ${objectName} from this board? The object itself will stay.`)) {
            return;
          }
          setError(null);
          startTransition(async () => {
            const result = await removeBoardItemAction({ id: itemId, boardId });
            if ('error' in result && result.error) {
              setError(result.error);
              return;
            }
            onRemoved?.();
            router.push(boardViewHref(boardId, view, null));
            router.refresh();
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-sm border border-danger/40 px-2 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        {pending ? 'Removing...' : 'Remove from board'}
      </button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}
