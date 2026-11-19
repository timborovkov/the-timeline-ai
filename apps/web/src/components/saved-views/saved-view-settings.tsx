'use client';

import Link from 'next/link';
import { useTransition } from 'react';

import { manageSavedWorkView } from '@/app/actions/saved-views';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { notifyAction } from '@/lib/notify';

export function SavedViewSettings({
  id,
  title,
  collection,
  href,
  notify,
}: {
  id: string;
  title: string;
  collection: string;
  href: string;
  notify: boolean;
}) {
  const [pending, startTransition] = useTransition();
  function manage(change: unknown) {
    startTransition(async () => {
      await notifyAction({
        id: `work:view:${id}`,
        loading: 'Updating view…',
        success: 'Saved view updated',
        error: 'Couldn’t update view',
        run: () => manageSavedWorkView(id, change),
      });
    });
  }
  return (
    <article className="flex flex-wrap items-start justify-between gap-4 p-4">
      <div>
        <h2 className="font-medium">
          <Link href={href} className="underline underline-offset-4">
            {title}
          </Link>
        </h2>
        <p className="text-sm capitalize text-fg-muted">{collection}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notify}
            disabled={pending}
            onChange={(event) => manage({ type: 'notify', enabled: event.currentTarget.checked })}
          />
          Include new matches in my digest
        </label>
        <details>
          <summary className="cursor-pointer text-sm">Manage view</summary>
          <form
            className="mt-2 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              manage({ type: 'rename', title: new FormData(event.currentTarget).get('title') });
            }}
          >
            <label className="block space-y-1 text-sm">
              View name <Input name="title" defaultValue={title} required maxLength={100} />
            </label>
            <Button size="sm" type="submit" disabled={pending}>
              Rename
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => manage({ type: 'delete' })}
            >
              Delete view
            </Button>
          </form>
        </details>
      </div>
    </article>
  );
}
