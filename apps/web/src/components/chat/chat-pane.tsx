'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Send } from 'lucide-react';
import { useState } from 'react';

import { CitationText } from './citation';
import { ToolStep } from './tool-step';

import { cn } from '@/lib/utils';

interface Props {
  teamName: string;
}

const SUGGESTIONS = [
  'What did the team work on yesterday?',
  'What was discussed with our biggest customer last week?',
  "What's outstanding right now?",
] as const;

export function ChatPane({ teamName }: Props) {
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const [input, setInput] = useState('');

  const isStreaming = status === 'streaming' || status === 'submitted';

  function submit(text: string) {
    const t = text.trim();
    if (!t || isStreaming) return;
    setInput('');
    void sendMessage({ text: t });
  }

  return (
    <div className="flex flex-col gap-8">
      {messages.length === 0 ? (
        <div className="flex flex-col gap-6 py-8">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Try asking</p>
            <h2 className="mt-2 text-xl font-medium tracking-tight">
              Ask anything about {teamName}'s timeline
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  submit(s);
                }}
                className="rounded-full border bg-card px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent/40 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol className="flex flex-col gap-6">
          {messages.map((m: UIMessage) => {
            const isUser = m.role === 'user';
            return (
              <li
                key={m.id}
                className={cn('flex flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}
              >
                <span className="px-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {isUser ? 'You' : teamName}
                </span>
                <div
                  className={cn(
                    'max-w-[90%] rounded-2xl text-sm',
                    isUser
                      ? 'rounded-br-md bg-secondary px-4 py-3 text-secondary-foreground'
                      : 'border-l-2 border-primary/60 bg-transparent py-1 pl-4 pr-1',
                  )}
                >
                  <div className="space-y-2">
                    {m.parts.map((part, idx) => {
                      const key = `${m.id}-${String(idx)}`;
                      if (part.type === 'text') {
                        return <CitationText key={key} text={part.text} />;
                      }
                      if (part.type.startsWith('tool-')) {
                        const toolPart = part as unknown as {
                          type: string;
                          toolCallId: string;
                          state: string;
                          input?: unknown;
                          output?: unknown;
                        };
                        return (
                          <ToolStep
                            key={key}
                            name={toolPart.type.slice('tool-'.length)}
                            state={toolPart.state}
                            input={toolPart.input}
                            output={toolPart.output}
                          />
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
              </li>
            );
          })}
          {isStreaming && (
            <li className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              Thinking…
            </li>
          )}
        </ol>
      )}

      {error && (
        <p className="text-sm text-destructive">
          {error.message || 'Chat failed. Make sure OPENROUTER_API_KEY is configured.'}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="sticky bottom-6 z-10"
      >
        <div className="relative rounded-xl border bg-card shadow-sm">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
            }}
            placeholder="Ask anything about your team's timeline…"
            disabled={isStreaming}
            className="h-14 w-full rounded-xl bg-transparent pl-5 pr-14 text-sm focus:outline-none"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            aria-label="Send"
            className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
