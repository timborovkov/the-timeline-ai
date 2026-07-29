'use client';

import { Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';

import {
  CHAT_HANDOFF_MAX_PROMPT_LENGTH,
  storeChatHandoff,
  validateChatHandoffPrompt,
} from '@/lib/chat-handoff';

const SUGGESTIONS = ['What changed today?', 'What is blocked?', 'What needs attention?'] as const;

export function HomeAskComposer({ teamId, actions }: { teamId: string; actions?: ReactNode }) {
  const router = useRouter();
  const promptRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(value = prompt) {
    const validationError = validateChatHandoffPrompt(value);
    if (validationError) {
      setError(validationError);
      promptRef.current?.focus();
      return;
    }
    try {
      storeChatHandoff(window.sessionStorage, teamId, value);
    } catch {
      setError('Ask could not open because temporary browser storage is unavailable. Try again.');
      return;
    }
    setError(null);
    router.push('/app/chat');
  }

  return (
    <section aria-labelledby="home-ask-title" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="home-ask-title" className="text-base font-semibold text-fg">
            Ask the timeline
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Ask what changed, what is blocked, or what needs attention.
          </p>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div>
        <div className="relative rounded-sm border border-border bg-surface focus-within:border-border-strong focus-within:ring-2 focus-within:ring-signal/40 focus-within:ring-offset-2 focus-within:ring-offset-bg">
          <label htmlFor="home-ask-prompt" className="sr-only">
            Question for Ask
          </label>
          <input
            ref={promptRef}
            id="home-ask-prompt"
            type="text"
            value={prompt}
            maxLength={CHAT_HANDOFF_MAX_PROMPT_LENGTH}
            className="h-10 w-full truncate rounded-sm bg-transparent pl-3 pr-12 text-base focus:outline-none sm:text-sm"
            placeholder="Ask the timeline…"
            aria-describedby={error ? 'home-ask-error' : undefined}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setPrompt(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
          <button
            type="button"
            aria-label="Send"
            onClick={() => {
              submit();
            }}
            className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-sm bg-signal text-signal-fg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2"
          >
            <Send aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
      {error ? (
        <p id="home-ask-error" role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="rounded-sm border border-border bg-surface px-3 py-1.5 text-left text-sm text-fg-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              submit(suggestion);
            }}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </section>
  );
}
