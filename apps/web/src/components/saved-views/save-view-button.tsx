'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { createSavedWorkView } from '@/app/actions/saved-views';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { notifyAction } from '@/lib/notify';

export function SaveViewButton({
  collection,
  targetId = null,
  filters,
}: {
  collection: 'tasks' | 'objects' | 'boards' | 'approvals';
  targetId?: string | null;
  filters: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" type="button">
          Save view
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save view</DialogTitle>
          <DialogDescription>Save the current filters as a personal view.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          action={(form) => {
            const title = form.get('title');
            startTransition(async () => {
              const result = await notifyAction({
                id: 'work:save-view',
                loading: 'Saving view…',
                success: 'View saved',
                error: 'Couldn’t save view',
                run: () => createSavedWorkView({ title, collection, targetId, filters }),
              });
              if (!result.error) setOpen(false);
            });
          }}
        >
          <label className="block space-y-1 text-sm">
            View name
            <Input name="title" required maxLength={100} />
          </label>
          <DialogFooter className="gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/app/work/views">Open saved views</Link>
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              Save view
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
