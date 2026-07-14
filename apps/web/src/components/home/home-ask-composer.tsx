'use client';

import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  CHAT_HANDOFF_MAX_PROMPT_LENGTH,
  storeChatHandoff,
  validateChatHandoffPrompt,
} from '@/lib/chat-handoff';

const SUGGESTIONS = ['What changed today?', 'What is blocked?', 'What needs attention?'] as const;

export function HomeAskComposer({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(value = prompt) {
    const validationError = validateChatHandoffPrompt(value);
    if (validationError) {
      setError(validationError);
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
    <section
      aria-labelledby="home-ask-title"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="home-ask-title" className="text-base font-semibold text-fg">
          Ask the timeline
        </h2>
        <span className="font-mono text-xs text-fg-dim">{prompt.length}/4,000</span>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="home-ask-prompt" className="sr-only">
            Question for Ask
          </label>
          <Textarea
            id="home-ask-prompt"
            value={prompt}
            maxLength={CHAT_HANDOFF_MAX_PROMPT_LENGTH}
            rows={2}
            className="min-h-20 resize-none bg-bg"
            placeholder="Ask what changed, what is blocked, or what needs attention…"
            aria-describedby={error ? 'home-ask-error' : undefined}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setPrompt(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit();
            }}
          />
        </div>
        <Button
          type="button"
          className="shrink-0"
          onClick={() => {
            submit();
          }}
          disabled={!prompt.trim()}
        >
          Ask
          <ArrowRight aria-hidden="true" />
        </Button>
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
            className="rounded-sm border border-border bg-bg px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              setPrompt(suggestion);
              setError(null);
            }}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </section>
  );
}
