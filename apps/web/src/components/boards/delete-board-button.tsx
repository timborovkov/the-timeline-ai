'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { deleteBoardAction } from '@/app/actions/boards';

export function DeleteBoardButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm('Delete this board? Objects are not affected.')) return;
        startTransition(async () => {
          await deleteBoardAction({ id });
          router.push('/app/boards');
          router.refresh();
        });
      }}
      className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
    >
      Delete board
    </button>
  );
}
