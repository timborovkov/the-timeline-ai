'use client';

import { Lock, Send, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { createTextEventAction, type CreateEventState } from '@/app/actions/events';
import { AudioRecorder } from '@/components/audio-recorder';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

function CaptureSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="gap-2">
      {pending ? (
        'Posting…'
      ) : (
        <>
          <Send className="h-3.5 w-3.5" />
          Post
        </>
      )}
    </Button>
  );
}

export function CaptureForm() {
  const [state, action] = useFormState<CreateEventState, FormData>(createTextEventAction, {});
  const [isPrivate, setIsPrivate] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setIsPrivate(false);
    }
  }, [state.ok, state.at]);

  return (
    <form ref={formRef} action={action} className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Capture</p>
        <p className="mt-1 text-sm text-muted-foreground">
          A quick note — a meeting takeaway, a decision, a follow-up.
        </p>
      </div>
      <Textarea
        name="text"
        placeholder="What happened?"
        rows={4}
        required
        className="resize-none rounded-md border-0 bg-transparent p-0 text-[15px] leading-7 shadow-none ring-0 ring-offset-0 transition-colors focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:[outline:none]"
      />
      <AudioRecorder />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <input type="hidden" name="visibility" value={isPrivate ? 'private' : 'team'} />
        <button
          type="button"
          onClick={() => {
            setIsPrivate((v) => !v);
          }}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors',
            isPrivate
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border bg-transparent text-muted-foreground hover:text-foreground',
          )}
          aria-pressed={isPrivate}
        >
          {isPrivate ? <Lock className="h-3 w-3" /> : <Users className="h-3 w-3" />}
          {isPrivate ? 'Private (only me)' : 'Visible to team'}
        </button>
        <div className="flex items-center gap-3">
          {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
          <CaptureSubmit />
        </div>
      </div>
    </form>
  );
}
