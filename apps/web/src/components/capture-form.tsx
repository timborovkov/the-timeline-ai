'use client';

import { useEffect, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { createTextEventAction, type CreateEventState } from '@/app/actions/events';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

function CaptureSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Posting…' : 'Post'}
    </Button>
  );
}

export function CaptureForm() {
  const [state, action] = useFormState<CreateEventState, FormData>(createTextEventAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Depend on the action timestamp, not just `ok`. useFormState replaces state
  // on every action call, but if two successful submits both return `{ ok: true }`
  // React sees no change and skips the reset. The timestamp changes every time.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok, state.at]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <Textarea
        name="text"
        placeholder="What happened? Drop a quick note — a meeting takeaway, a decision, a follow-up."
        rows={4}
        required
      />
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {/* Hidden default + checkbox: FormData.getAll('visibility') picks the
              last entry, which is 'private' when checked, otherwise 'team'. */}
          <input type="hidden" name="visibility" value="team" />
          <input type="checkbox" name="visibility" value="private" className="h-3.5 w-3.5" />
          Private (only me)
        </label>
        <div className="flex items-center gap-3">
          {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
          <CaptureSubmit />
        </div>
      </div>
    </form>
  );
}
