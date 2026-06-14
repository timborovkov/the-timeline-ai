'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { deleteBoardAction } from '@/app/actions/boards';
import { useAppDialog } from '@/components/ui/app-dialog';

export function DeleteBoardButton({ id }: { id: string }) {
  const router = useRouter();
  const dialog = useAppDialog();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function deleteBoard(): Promise<void> {
    const confirmed = await dialog.confirm({
      title: 'Delete board?',
      description: 'Objects are not affected.',
      confirmLabel: 'Delete board',
      destructive: true,
    });
    if (!confirmed) return;
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
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          void deleteBoard();
        }}
        className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
      >
        Delete board
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
      {dialog.node}
    </div>
  );
}
