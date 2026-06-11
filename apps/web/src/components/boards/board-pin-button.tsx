'use client';

import { Pin, PinOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { pinBoardAction, unpinBoardAction } from '@/app/actions/boards';

export function BoardPinButton({ id, pinned }: { id: string; pinned: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const Icon = pinned ? PinOff : Pin;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        startTransition(async () => {
          if (pinned) await unpinBoardAction({ id });
          else await pinBoardAction({ id });
          router.refresh();
        });
      }}
      className="inline-flex size-8 items-center justify-center rounded-sm border border-border bg-bg text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-40"
      aria-label={pinned ? 'Unpin board' : 'Pin board'}
      title={pinned ? 'Unpin board' : 'Pin board'}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  );
}
