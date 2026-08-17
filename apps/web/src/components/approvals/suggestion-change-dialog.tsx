'use client';

import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { reviseSuggestionItemAction } from '@/app/actions/suggestions';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { notifyAction } from '@/lib/notify';

export function SuggestionChangeDialog({
  itemId,
  title,
  disabled = false,
  compact = false,
  onRevised,
}: {
  itemId: string;
  title: string;
  disabled?: boolean;
  compact?: boolean;
  onRevised?: (item: {
    id: string;
    status: string;
    title: string;
    description: string | null;
    proposedPayload: Record<string, unknown>;
  }) => void;
}) {
  const router = useRouter();
  const feedbackId = useId();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setDialogOpen(nextOpen: boolean) {
    if (pending) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setFeedback('');
      setError(null);
    }
  }

  function submit() {
    const trimmed = feedback.trim();
    if (!trimmed) {
      setError('Tell Timeline what should change.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await notifyAction({
        id: `suggestion:${itemId}`,
        loading: 'Updating proposal…',
        success: 'Proposal updated',
        error: 'Couldn’t update proposal',
        run: () => reviseSuggestionItemAction({ itemId, feedback: trimmed }),
      });
      if (result.error) return;
      if ('revisedItem' in result && result.revisedItem) onRevised?.(result.revisedItem);
      setOpen(false);
      setFeedback('');
      setError(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <button
            type="button"
            disabled={disabled}
            className="rounded-sm border border-border px-2 py-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            aria-label={`Change ${title}`}
          >
            <Pencil className="size-3.5" />
          </button>
        ) : (
          <Button type="button" size="sm" variant="ghost" disabled={disabled}>
            <Pencil className="size-4" />
            Change
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="border-border bg-bg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change “{title}”</DialogTitle>
          <DialogDescription>
            Explain what is wrong. Timeline will rewrite this proposal, but nothing will be applied
            yet and its source evidence will stay attached.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={feedbackId}>What should change?</Label>
          <Textarea
            id={feedbackId}
            value={feedback}
            onChange={(event) => {
              setFeedback(event.target.value);
            }}
            placeholder="For example: Miku made this promise, not Tim. Keep the date and other details unchanged."
            rows={5}
            maxLength={2000}
            disabled={pending}
            autoFocus
          />
          <div className="flex items-start justify-between gap-3">
            {error ? (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            ) : (
              <p className="text-xs text-fg-dim">The original source record is never edited.</p>
            )}
            <span className="shrink-0 font-mono text-[10px] text-fg-dim">
              {feedback.length}/2000
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setDialogOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button type="button" disabled={pending || !feedback.trim()} onClick={submit}>
            {pending ? 'Updating…' : 'Update proposal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
