'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { deleteBoardAction } from '@/app/actions/boards';

export function DeleteBoardButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm('Delete this board? Objects are not affected.')) return;
          setError(null);
          startTransition(async () => {
            const result = await deleteBoardAction({ id });
            if ('error' in result && result.error) {
              setError(result.error);
              return;
            }
            router.push('/app/boards');
            router.refresh();
          });
        }}
        className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
      >
        Delete board
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
